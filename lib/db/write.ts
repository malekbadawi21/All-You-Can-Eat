import type { Client, InStatement, Transaction } from "@libsql/client";
import { classifyItem } from "@/lib/mealGrammar";
import {
  assertValidMenuDocument,
  type MenuDocument,
  type SourceInput,
} from "@/lib/menuDocument";

// ── Writing a restaurant ─────────────────────────────────────────────────────
//
// The only code path that puts a menu into the database. The seed uses it, the
// file importer uses it, and the USDA adapter uses it — so there is exactly one
// place where validation, classification and provenance are enforced.
//
// Loading is replace-not-merge: a restaurant's whole menu is swapped in one
// transaction. Merging row by row would need a notion of "the same item" that
// survives a rename, and it would leave a half-updated menu visible if anything
// failed in the middle. Replacing keeps a reader always looking at one coherent
// snapshot from one fetch date, which is also what makes the provenance honest:
// every row of a restaurant shares the sources recorded with that load.

export interface WriteOptions {
  /** How the restaurant got here. Defaults to "import". */
  origin?: "seed" | "import" | "ingested";
  /** Street order. Defaults to after everything already present. */
  position?: number;
}

export interface WriteReport {
  slug: string;
  restaurantId: number;
  replaced: boolean;
  rows: number;
  warnings: string[];
}

async function insertSource(
  tx: Transaction,
  kind: "nutrition" | "price",
  source: SourceInput
): Promise<number> {
  const result = await tx.execute({
    sql: `INSERT INTO sources (kind, name, url, market, fetched_at, method, license, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      kind,
      source.name,
      source.url ?? null,
      source.market,
      source.fetched_at,
      source.method,
      source.license ?? null,
      source.notes ?? null,
    ],
  });
  return Number(result.lastInsertRowid);
}

export async function writeMenuDocument(
  client: Client,
  doc: MenuDocument,
  options: WriteOptions = {}
): Promise<WriteReport> {
  // Validate before opening the transaction: a bad document should cost
  // nothing, and its error should list every problem at once.
  const warnings = assertValidMenuDocument(doc);

  const { restaurant, sources } = doc;
  const now = new Date().toISOString();
  const tx = await client.transaction("write");

  try {
    const existing = await tx.execute({
      sql: "SELECT id, position, created_at FROM restaurants WHERE slug = ?",
      args: [restaurant.slug],
    });
    const previous = existing.rows[0];

    let restaurantId: number;
    if (previous) {
      restaurantId = Number(previous.id);

      // Collect the old sources before the rows pointing at them go, then
      // remove them once nothing references them any more.
      const oldSources = await tx.execute({
        sql: `SELECT nutrition_source_id AS id FROM menu_items WHERE restaurant_id = ?1
              UNION SELECT price_source_id FROM menu_items WHERE restaurant_id = ?1
              UNION SELECT c.nutrition_source_id FROM components c
                    JOIN component_slots s ON s.id = c.slot_id WHERE s.restaurant_id = ?1
              UNION SELECT c.price_source_id FROM components c
                    JOIN component_slots s ON s.id = c.slot_id WHERE s.restaurant_id = ?1`,
        args: [restaurantId],
      });

      await tx.execute({
        sql: `DELETE FROM components WHERE slot_id IN
              (SELECT id FROM component_slots WHERE restaurant_id = ?)`,
        args: [restaurantId],
      });
      await tx.execute({ sql: "DELETE FROM component_slots WHERE restaurant_id = ?", args: [restaurantId] });
      await tx.execute({ sql: "DELETE FROM menu_items WHERE restaurant_id = ?", args: [restaurantId] });

      const sourceIds = oldSources.rows.map((r) => r.id).filter((id) => id != null);
      if (sourceIds.length > 0) {
        await tx.execute({
          sql: `DELETE FROM sources WHERE id IN (${sourceIds.map(() => "?").join(",")})`,
          args: sourceIds as number[],
        });
      }

      await tx.execute({
        sql: `UPDATE restaurants
              SET name = ?, type = ?, aliases = ?, identity = ?, origin = ?, updated_at = ?
              WHERE id = ?`,
        args: [
          restaurant.name,
          restaurant.type,
          JSON.stringify(restaurant.aliases ?? []),
          restaurant.identity ? JSON.stringify(restaurant.identity) : null,
          options.origin ?? "import",
          now,
          restaurantId,
        ],
      });
    } else {
      const position =
        options.position ??
        Number(
          (await tx.execute("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM restaurants"))
            .rows[0].next
        );

      const inserted = await tx.execute({
        sql: `INSERT INTO restaurants (slug, name, type, aliases, identity, origin, position, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          restaurant.slug,
          restaurant.name,
          restaurant.type,
          JSON.stringify(restaurant.aliases ?? []),
          restaurant.identity ? JSON.stringify(restaurant.identity) : null,
          options.origin ?? "import",
          position,
          now,
          now,
        ],
      });
      restaurantId = Number(inserted.lastInsertRowid);
    }

    const nutritionSourceId = await insertSource(tx, "nutrition", sources.nutrition);
    const priceSourceId = sources.price ? await insertSource(tx, "price", sources.price) : null;

    // A price is stored only alongside the id of the source it came from. The
    // table's CHECK constraint would reject anything else; doing it here too
    // means the two columns are visibly decided together.
    const priced = (price: number | null | undefined) =>
      price != null && priceSourceId != null
        ? ([price, priceSourceId] as const)
        : ([null, null] as const);

    let rows = 0;

    if (restaurant.type === "fixed") {
      const statements: InStatement[] = (doc.items ?? []).map((item, position) => {
        // Stated facts win; anything left out is proposed by the classifier
        // and then stored, so it can be corrected like any other column.
        const guess = classifyItem(item.name, item.category);
        const [price, priceSource] = priced(item.price);
        return {
          sql: `INSERT INTO menu_items
                  (restaurant_id, position, name, category, role, daypart, portion_weight,
                   calories, protein_g, fat_g, carbs_g, sodium_mg,
                   price, price_estimated, nutrition_source_id, price_source_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            restaurantId,
            position,
            item.name,
            item.category ?? guess.category,
            item.role ?? guess.role,
            item.daypart ?? guess.daypart,
            item.portion_weight ?? guess.weight,
            Math.round(item.calories),
            item.protein_g,
            item.fat_g,
            item.carbs_g,
            Math.round(item.sodium_mg),
            price,
            item.price_estimated ? 1 : 0,
            nutritionSourceId,
            priceSource,
          ],
        };
      });
      // One round trip for the whole menu — on a hosted database every
      // statement is a network call, and a menu is forty of them.
      if (statements.length > 0) await tx.batch(statements);
      rows = statements.length;
    } else {
      for (const [slotPosition, slot] of (doc.slots ?? []).entries()) {
        const insertedSlot = await tx.execute({
          sql: `INSERT INTO component_slots (restaurant_id, position, slot_name, required, pick, count_from)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            restaurantId,
            slotPosition,
            slot.name,
            slot.required ? 1 : 0,
            slot.pick,
            slot.count_from ?? null,
          ],
        });
        const slotId = Number(insertedSlot.lastInsertRowid);

        const statements: InStatement[] = slot.options.map((option, position) => {
          const [price, priceSource] = priced(option.price);
          return {
            sql: `INSERT INTO components
                    (slot_id, position, name, calories, protein_g, fat_g, carbs_g, sodium_mg,
                     price, price_estimated, pick_counts, nutrition_source_id, price_source_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              slotId,
              position,
              option.name,
              Math.round(option.calories),
              option.protein_g,
              option.fat_g,
              option.carbs_g,
              Math.round(option.sodium_mg),
              price,
              option.price_estimated ? 1 : 0,
              option.pick_counts ? JSON.stringify(option.pick_counts) : null,
              nutritionSourceId,
              priceSource,
            ],
          };
        });
        await tx.batch(statements);
        rows += statements.length;
      }
    }

    await tx.commit();
    return { slug: restaurant.slug, restaurantId, replaced: Boolean(previous), rows, warnings };
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export interface IngestionRunRecord {
  requestedName: string;
  slug: string | null;
  adapter: string;
  status: "ok" | "not_found" | "rejected" | "error";
  message: string | null;
  itemsAdded: number;
  startedAt: string;
}

/** Every ingestion attempt is logged, including the ones that found nothing. */
export async function recordIngestionRun(client: Client, run: IngestionRunRecord): Promise<void> {
  await client.execute({
    sql: `INSERT INTO ingestion_runs
            (requested_name, slug, adapter, status, message, items_added, started_at, finished_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      run.requestedName,
      run.slug,
      run.adapter,
      run.status,
      run.message,
      run.itemsAdded,
      run.startedAt,
      new Date().toISOString(),
    ],
  });
}
