import type { Client } from "@libsql/client";
import { SEED_DOCUMENTS } from "@/db/seed";
import type { MealRole, Daypart } from "@/lib/mealGrammar";
import type { StorefrontIdentity } from "@/lib/restaurants";
import { getConnection } from "./client";
import { isMigrated, runMigrations } from "./migrate";
import { writeMenuDocument } from "./write";

// ── Reading the database ─────────────────────────────────────────────────────
//
// Everything the app knows about restaurants comes through this file. Callers
// get plain objects; nothing outside lib/db/ writes SQL.
//
// Every function here is async. That is the visible cost of moving off
// better-sqlite3, whose calls were synchronous: a hosted database is on the
// other end of a network request, and no amount of wishing makes that
// synchronous.

// ── Public types ─────────────────────────────────────────────────────────────

export interface RestaurantInfo {
  id: number;
  name: string;
  slug: string;
  type: "fixed" | "build-your-own";
  /** Lower-case spellings the query parser recognises. */
  aliases: string[];
  /** Hand-authored storefront, or null to have one generated from the slug. */
  identity: StorefrontIdentity | null;
  origin: "seed" | "import" | "ingested";
  /** Street order — lowest stands nearest the camera. */
  position: number;
}

export interface MenuItem {
  id: number;
  name: string;
  /** Display grouping only. Meal structure is judged from the three below. */
  category: string;
  role: MealRole;
  daypart: Daypart;
  portion_weight: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number;
  /** USD, approximate. Null means unknown — never free. */
  price: number | null;
  /** True when the price is an interpolation rather than a sourced figure. */
  price_estimated?: boolean;
}

export interface ComponentOption {
  id: number;
  name: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number;
  // For the base slot this is the full meal starting price.
  // For all other slots this is the extra charge on top of that base.
  price: number | null;
  price_estimated?: boolean;
  // When set, picking this option fixes how many items one or more other
  // slots must pick — keyed by slot_name (e.g. Panda's "Bowl" option sets
  // { entree: 1 }; Cane's "Caniac Combo" sets { side: 3 }).
  pick_counts?: Record<string, number>;
}

export interface Slot {
  slot_name: string;
  required: boolean;
  pick: string;
  options: ComponentOption[];
  // Name of another slot in the same restaurant whose selected option's
  // pick_counts[this slot's name] dictates exactly how many items this slot
  // must pick.
  count_from?: string;
}

/** Where a set of figures came from. Shown to the user, never hidden. */
export interface SourceInfo {
  kind: "nutrition" | "price";
  name: string;
  url: string | null;
  market: string;
  /** ISO date the figures were read from the source. */
  fetched_at: string;
  method: string;
  notes: string | null;
}

/** A restaurant and everything on its menu, with provenance. */
export interface Menu {
  restaurant: RestaurantInfo;
  /** Fixed menus. Empty for build-your-own restaurants. */
  items: MenuItem[];
  /** Build-your-own restaurants. Empty for fixed menus. */
  slots: Slot[];
  sources: {
    nutrition: SourceInfo | null;
    /** Null when the restaurant has no price data at all. */
    price: SourceInfo | null;
  };
}

// ── Readiness ────────────────────────────────────────────────────────────────
//
// A local or in-memory database sets itself up: migrate, then seed if empty.
// That keeps `git clone && npm install && npm run dev` a complete setup.
//
// A hosted database is deliberately *not* touched automatically. Schema changes
// to production should be something a person ran (`npm run db:setup`), not a
// side effect of the first request after a deploy — two cold starts racing to
// migrate the same database is not a failure mode worth having.

const globalForReady = globalThis as unknown as {
  __ayceReady?: Promise<void>;
  __ayceCache?: Map<string, { at: number; value: unknown }>;
};

export async function seedIfEmpty(client: Client): Promise<number> {
  const { rows } = await client.execute("SELECT COUNT(*) AS count FROM restaurants");
  if (Number(rows[0].count) > 0) return 0;

  for (const [position, doc] of SEED_DOCUMENTS.entries()) {
    await writeMenuDocument(client, doc, { origin: "seed", position });
  }
  return SEED_DOCUMENTS.length;
}

async function prepare(): Promise<void> {
  const { client, target } = getConnection();

  if (target.mode === "hosted") {
    if (!(await isMigrated(client))) {
      throw new Error(
        "The hosted database has no schema yet. Run `npm run db:setup` once with " +
          "TURSO_DATABASE_URL and TURSO_AUTH_TOKEN set (see README)."
      );
    }
    return;
  }

  if (target.mode === "file") {
    // libSQL creates the file but not the folder it lives in.
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(target.url.replace(/^file:/, "")), { recursive: true });
  }

  await runMigrations(client);
  await seedIfEmpty(client);
}

/** Resolves once the database can be queried. Safe to call on every request. */
export function ensureReady(): Promise<void> {
  if (!globalForReady.__ayceReady) {
    globalForReady.__ayceReady = prepare().catch((error) => {
      // Don't cache a failure: the next request should get to try again.
      globalForReady.__ayceReady = undefined;
      throw error;
    });
  }
  return globalForReady.__ayceReady;
}

async function db(): Promise<Client> {
  await ensureReady();
  return getConnection().client;
}

// ── A small read cache ───────────────────────────────────────────────────────
//
// Menus change when someone runs an import, which is rare; searches happen
// constantly. Against a hosted database each uncached search would be three or
// four network round trips before any optimizing starts. Holding results for a
// minute removes nearly all of them, and anything that writes calls
// invalidateCache() so a newly ingested restaurant shows up immediately on the
// instance that ingested it.

const CACHE_TTL_MS = 60_000;

function cache(): Map<string, { at: number; value: unknown }> {
  return (globalForReady.__ayceCache ??= new Map());
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache().get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  cache().set(key, { at: Date.now(), value });
  return value;
}

export function invalidateCache(): void {
  cache().clear();
}

// ── Queries ──────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function toRestaurant(row: Row): RestaurantInfo {
  return {
    id: Number(row.id),
    name: String(row.name),
    slug: String(row.slug),
    type: row.type as RestaurantInfo["type"],
    aliases: JSON.parse(String(row.aliases ?? "[]")),
    identity: row.identity ? JSON.parse(String(row.identity)) : null,
    origin: row.origin as RestaurantInfo["origin"],
    position: Number(row.position),
  };
}

const price = (value: unknown): number | null => (value == null ? null : Number(value));

/** Every restaurant, in street order. */
export function getAllRestaurants(): Promise<RestaurantInfo[]> {
  return cached("restaurants", async () => {
    const result = await (await db()).execute("SELECT * FROM restaurants ORDER BY position, id");
    return result.rows.map((row) => toRestaurant(row as Row));
  });
}

export async function getRestaurant(slug: string): Promise<RestaurantInfo | undefined> {
  return (await getAllRestaurants()).find((r) => r.slug === slug);
}

async function loadSource(client: Client, id: unknown): Promise<SourceInfo | null> {
  if (id == null) return null;
  const { rows } = await client.execute({ sql: "SELECT * FROM sources WHERE id = ?", args: [Number(id)] });
  const row = rows[0] as Row | undefined;
  if (!row) return null;
  return {
    kind: row.kind as SourceInfo["kind"],
    name: String(row.name),
    url: row.url == null ? null : String(row.url),
    market: String(row.market),
    fetched_at: String(row.fetched_at),
    method: String(row.method),
    notes: row.notes == null ? null : String(row.notes),
  };
}

/** The full menu for a restaurant, or undefined if we don't have it. */
export async function getMenu(slug: string): Promise<Menu | undefined> {
  const restaurant = await getRestaurant(slug);
  if (!restaurant) return undefined;

  return cached(`menu:${slug}`, async () => {
    const client = await db();
    let items: MenuItem[] = [];
    let slots: Slot[] = [];
    let nutritionSourceId: unknown = null;
    let priceSourceId: unknown = null;

    if (restaurant.type === "fixed") {
      const result = await client.execute({
        sql: "SELECT * FROM menu_items WHERE restaurant_id = ? ORDER BY position, id",
        args: [restaurant.id],
      });
      items = result.rows.map((row) => ({
        id: Number(row.id),
        name: String(row.name),
        category: String(row.category),
        role: row.role as MealRole,
        daypart: row.daypart as Daypart,
        portion_weight: Number(row.portion_weight),
        calories: Number(row.calories),
        protein_g: Number(row.protein_g),
        fat_g: Number(row.fat_g),
        carbs_g: Number(row.carbs_g),
        sodium_mg: Number(row.sodium_mg),
        price: price(row.price),
        ...(Number(row.price_estimated) === 1 ? { price_estimated: true } : {}),
      }));
      nutritionSourceId = result.rows[0]?.nutrition_source_id;
      priceSourceId = result.rows.find((r) => r.price_source_id != null)?.price_source_id;
    } else {
      // Two queries, not one per slot: slots, then every component for the
      // restaurant, joined up here.
      const [slotRows, componentRows] = await Promise.all([
        client.execute({
          sql: "SELECT * FROM component_slots WHERE restaurant_id = ? ORDER BY position, id",
          args: [restaurant.id],
        }),
        client.execute({
          sql: `SELECT c.* FROM components c
                JOIN component_slots s ON s.id = c.slot_id
                WHERE s.restaurant_id = ? ORDER BY c.position, c.id`,
          args: [restaurant.id],
        }),
      ]);

      slots = slotRows.rows.map((slot) => ({
        slot_name: String(slot.slot_name),
        required: Number(slot.required) === 1,
        pick: String(slot.pick),
        ...(slot.count_from ? { count_from: String(slot.count_from) } : {}),
        options: componentRows.rows
          .filter((c) => Number(c.slot_id) === Number(slot.id))
          .map((c) => ({
            id: Number(c.id),
            name: String(c.name),
            calories: Number(c.calories),
            protein_g: Number(c.protein_g),
            fat_g: Number(c.fat_g),
            carbs_g: Number(c.carbs_g),
            sodium_mg: Number(c.sodium_mg),
            price: price(c.price),
            ...(Number(c.price_estimated) === 1 ? { price_estimated: true } : {}),
            ...(c.pick_counts ? { pick_counts: JSON.parse(String(c.pick_counts)) } : {}),
          })),
      }));
      nutritionSourceId = componentRows.rows[0]?.nutrition_source_id;
      priceSourceId = componentRows.rows.find((r) => r.price_source_id != null)?.price_source_id;
    }

    const [nutrition, priceSource] = await Promise.all([
      loadSource(client, nutritionSourceId),
      loadSource(client, priceSourceId),
    ]);

    return { restaurant, items, slots, sources: { nutrition, price: priceSource } };
  });
}

export { getConnection, resolveTarget } from "./client";
export { runMigrations } from "./migrate";
export { writeMenuDocument, recordIngestionRun } from "./write";
