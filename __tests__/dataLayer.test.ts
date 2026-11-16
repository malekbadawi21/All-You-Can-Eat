import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { SEED_DOCUMENTS } from "@/db/seed";
import { MIGRATIONS } from "@/db/migrations";
import { runMigrations } from "@/lib/db/migrate";
import { writeMenuDocument } from "@/lib/db/write";
import { getAllRestaurants, getMenu } from "@/lib/db";
import { validateMenuDocument, type MenuDocument } from "@/lib/menuDocument";
import { freshnessOf } from "@/lib/freshness";

// The data layer's promises, tested against a real (in-memory) database rather
// than mocks: the SQL, the CHECK constraints and the migration bookkeeping are
// exactly the parts a mock would have to guess at.

const freshDb = async () => {
  const client = createClient({ url: ":memory:" });
  await runMigrations(client);
  return client;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("seed documents", () => {
  it("are all valid", () => {
    for (const doc of SEED_DOCUMENTS) {
      const { errors } = validateMenuDocument(doc);
      expect(errors, `${doc.restaurant.slug}:\n${errors.join("\n")}`).toEqual([]);
    }
  });

  it("each say where their nutrition and their prices came from", () => {
    for (const doc of SEED_DOCUMENTS) {
      for (const kind of ["nutrition", "price"] as const) {
        const source = doc.sources[kind];
        expect(source, `${doc.restaurant.slug} has no ${kind} source`).toBeTruthy();
        expect(source!.market, `${doc.restaurant.slug} ${kind} market`).toBeTruthy();
        expect(Date.parse(source!.fetched_at), `${doc.restaurant.slug} ${kind} fetched_at`).not.toBeNaN();
      }
    }
  });

  it("have unique slugs and no alias claimed by two restaurants", () => {
    const slugs = SEED_DOCUMENTS.map((d) => d.restaurant.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    const owners = new Map<string, string>();
    for (const doc of SEED_DOCUMENTS) {
      for (const alias of doc.restaurant.aliases ?? []) {
        expect(owners.get(alias), `"${alias}" is claimed twice`).toBeUndefined();
        owners.set(alias, doc.restaurant.slug);
      }
    }
  });
});

describe("migrations", () => {
  it("apply once and are a no-op the second time", async () => {
    const client = createClient({ url: ":memory:" });
    const first = await runMigrations(client);
    const second = await runMigrations(client);

    expect(first.applied).toEqual(MIGRATIONS.map((m) => m.id));
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(MIGRATIONS.map((m) => m.id));
  });
});

describe("the app's own database", () => {
  it("seeds every restaurant, in street order", async () => {
    const restaurants = await getAllRestaurants();
    expect(restaurants.map((r) => r.slug)).toEqual(SEED_DOCUMENTS.map((d) => d.restaurant.slug));
  });

  it("returns every row of a menu with its sources attached", async () => {
    for (const doc of SEED_DOCUMENTS) {
      const menu = (await getMenu(doc.restaurant.slug))!;
      const expected =
        doc.restaurant.type === "fixed"
          ? doc.items!.length
          : doc.slots!.reduce((n, s) => n + s.options.length, 0);
      const actual =
        menu.items.length + menu.slots.reduce((n, s) => n + s.options.length, 0);

      expect(actual, doc.restaurant.slug).toBe(expected);
      expect(menu.sources.nutrition?.name, doc.restaurant.slug).toBe(doc.sources.nutrition.name);
      expect(menu.sources.price?.market, doc.restaurant.slug).toBe(doc.sources.price!.market);
    }
  });

  it("keeps the estimate flag on the one price nobody publishes", async () => {
    const canes = (await getMenu("raising-canes"))!;
    const combo = canes.slots[0].options.find((o) => o.name === "Sandwich Combo")!;
    expect(combo.price_estimated).toBe(true);
    expect(canes.slots[0].options.filter((o) => o.price_estimated).length).toBe(1);
  });
});

describe("writing a menu", () => {
  const tiny = (): MenuDocument => ({
    restaurant: { slug: "test-kitchen", name: "Test Kitchen", type: "fixed" },
    sources: {
      nutrition: {
        name: "Test Kitchen nutrition sheet",
        url: "https://example.com/nutrition",
        market: "US",
        fetched_at: "2026-11-01",
        method: "file-import",
      },
    },
    items: [
      { name: "House Burger", calories: 500, protein_g: 25, fat_g: 24, carbs_g: 44, sodium_mg: 900 },
      { name: "Side Salad", calories: 60, protein_g: 3, fat_g: 3, carbs_g: 6, sodium_mg: 90 },
    ],
  });

  it("classifies items that arrive without a role", async () => {
    const client = await freshDb();
    await writeMenuDocument(client, tiny());
    const { rows } = await client.execute("SELECT name, role, category FROM menu_items ORDER BY position");

    expect(rows.map((r) => `${r.name}:${r.role}`)).toEqual(["House Burger:main", "Side Salad:side"]);
  });

  it("stores no price when the document has none, rather than zero", async () => {
    const client = await freshDb();
    await writeMenuDocument(client, tiny());
    const { rows } = await client.execute("SELECT price, price_source_id FROM menu_items");

    for (const row of rows) {
      expect(row.price).toBeNull();
      expect(row.price_source_id).toBeNull();
    }
  });

  it("refuses prices that come with no source", () => {
    const doc = tiny();
    doc.items![0].price = 7.49;
    const { errors } = validateMenuDocument(doc);
    expect(errors.join("\n")).toMatch(/sources\.price/);
  });

  // The CHECK constraint is the last line of defence: even code that bypassed
  // the validator could not store a price with nowhere to point.
  it("cannot store a sourceless price even by writing SQL directly", async () => {
    const client = await freshDb();
    await writeMenuDocument(client, tiny());
    await expect(
      client.execute("UPDATE menu_items SET price = 5.00 WHERE name = 'House Burger'")
    ).rejects.toThrow();
  });

  it("refuses a document with no nutrition source", () => {
    const doc = clone(tiny()) as unknown as { sources: Record<string, unknown> };
    delete doc.sources.nutrition;
    const { errors } = validateMenuDocument(doc as unknown as MenuDocument);
    expect(errors.join("\n")).toMatch(/sources\.nutrition/);
  });

  it("replaces a restaurant's menu instead of duplicating it", async () => {
    const client = await freshDb();
    await writeMenuDocument(client, tiny());

    const next = tiny();
    next.items = [next.items![0]];
    next.sources.nutrition.fetched_at = "2026-11-15";
    const report = await writeMenuDocument(client, next);

    const items = await client.execute("SELECT name FROM menu_items");
    const sources = await client.execute("SELECT fetched_at FROM sources");
    const restaurants = await client.execute("SELECT slug FROM restaurants");

    expect(report.replaced).toBe(true);
    expect(items.rows.length).toBe(1);
    // The old source row goes with the rows that cited it.
    expect(sources.rows.map((r) => r.fetched_at)).toEqual(["2026-11-15"]);
    expect(restaurants.rows.length).toBe(1);
  });

  it("rolls the whole load back if any row is bad", async () => {
    const client = await freshDb();
    const doc = tiny();
    // Past the validator's ceiling — rejected before anything is written.
    doc.items![1].calories = 99999;

    await expect(writeMenuDocument(client, doc)).rejects.toThrow(/implausibly large/);
    const { rows } = await client.execute("SELECT COUNT(*) AS n FROM restaurants");
    expect(Number(rows[0].n)).toBe(0);
  });

  it("flags nutrition that doesn't add up, without rejecting it", () => {
    const doc = tiny();
    doc.items![0] = { name: "Suspicious Burger", calories: 900, protein_g: 10, fat_g: 5, carbs_g: 20, sodium_mg: 400 };
    const { errors, warnings } = validateMenuDocument(doc);
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toMatch(/Suspicious Burger/);
  });
});

describe("freshness", () => {
  const now = new Date("2026-11-16T12:00:00Z");

  it("holds prices to a shorter shelf life than nutrition", () => {
    const sevenMonthsAgo = "2026-04-10";
    expect(freshnessOf({ kind: "nutrition", fetched_at: sevenMonthsAgo }, now).stale).toBe(false);
    expect(freshnessOf({ kind: "price", fetched_at: sevenMonthsAgo }, now).stale).toBe(true);
  });

  it("treats an unreadable date as stale, not fresh", () => {
    expect(freshnessOf({ kind: "nutrition", fetched_at: "last tuesday" }, now).stale).toBe(true);
  });
});
