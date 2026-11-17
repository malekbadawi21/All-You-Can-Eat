import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/search/route";
import type { SearchResponse, SearchError } from "@/lib/searchResult";

// These are integration tests: unlike everything under lib/, they run the real
// route against a real (in-memory, freshly seeded) database. The route is what
// the UI talks to.
//
// THIS FILE IS THE API CONTRACT. If a change here is needed to make a change
// elsewhere pass, the public shape is changing — update lib/searchResult.ts and
// the "search API contract" notes in CLAUDE.md in the same commit.

async function search(params: Record<string, string> | string = {}) {
  const url = new URL("http://localhost:3000/api/search");
  const entries = typeof params === "string" ? { q: params } : params;
  for (const [key, value] of Object.entries(entries)) url.searchParams.set(key, value);
  const response = await GET(new NextRequest(url));
  return { status: response.status, body: await response.json() };
}

const ok = async (params: Record<string, string> | string) => {
  const { status, body } = await search(params);
  expect(status, JSON.stringify(body)).toBe(200);
  return body as SearchResponse;
};

const FIXED = "high protein chick-fil-a";
const BUILD = "high protein chipotle";

describe("GET /api/search — input validation", () => {
  it("rejects a missing query", async () => {
    const { status, body } = await search();
    expect(status).toBe(400);
    expect((body as SearchError).code).toBe("missing_query");
  });

  it("rejects a blank query", async () => {
    const { status, body } = await search("   ");
    expect(status).toBe(400);
    expect((body as SearchError).code).toBe("missing_query");
  });

  it("rejects an absurdly long query rather than searching on it", async () => {
    const { status, body } = await search("high protein ".repeat(50));
    expect(status).toBe(400);
    expect((body as SearchError).code).toBe("query_too_long");
  });

  it("tells the caller what restaurants exist when none was named", async () => {
    const { status, body } = await search("high protein food");
    expect(status).toBe(400);
    expect((body as SearchError).code).toBe("no_restaurant");
    expect((body as SearchError).available).toContain("Chipotle");
  });

  // The defect: this used to answer no_restaurant. A restaurant *was* named —
  // we just don't carry it — and the UI needs to tell those apart.
  it("says unknown_restaurant, not no_restaurant, for a chain we don't have", async () => {
    const { status, body } = await search("high protein wendys");
    const error = body as SearchError;

    expect(status).toBe(404);
    expect(error.code).toBe("unknown_restaurant");
    expect(error.requested).toMatchObject({ name: "Wendy's", slug: "wendys" });
    expect(typeof error.requested!.can_ingest).toBe("boolean");
    expect(error.available).toContain("Chipotle");
  });

  it("says unknown_restaurant for a name it has never heard of", async () => {
    const { status, body } = await search("high protein at zorblatt grill");
    expect(status).toBe(404);
    expect((body as SearchError).code).toBe("unknown_restaurant");
    expect((body as SearchError).requested?.name).toBe("Zorblatt Grill");
  });

  it("does not mistake a craving for a restaurant", async () => {
    const { body } = await search("spicy nuggets");
    expect((body as SearchError).code).toBe("no_restaurant");
  });
});

describe("GET /api/search — one shape for every restaurant", () => {
  // The contract the UI is built against. If a fixed menu and a build-your-own
  // restaurant answer with different keys, every consumer needs two code paths.
  it("answers with identical top-level keys regardless of restaurant type", async () => {
    const fixed = await ok(FIXED);
    const build = await ok(BUILD);

    expect(Object.keys(fixed).sort()).toEqual(
      ["criteria", "data", "notices", "query", "restaurant", "results"]
    );
    expect(Object.keys(build).sort()).toEqual(Object.keys(fixed).sort());
  });

  it("answers with identical result keys regardless of restaurant type", async () => {
    const fixed = await ok(FIXED);
    const build = await ok(BUILD);

    expect(Object.keys(fixed.results[0]).sort()).toEqual([
      "id",
      "items",
      "kind",
      "label",
      "price_estimated",
      "shape",
      "total_calories",
      "total_carbs_g",
      "total_fat_g",
      "total_price",
      "total_protein_g",
      "total_sodium_mg",
    ]);
    expect(Object.keys(build.results[0]).sort()).toEqual(Object.keys(fixed.results[0]).sort());
  });

  it("reports every criterion, with null rather than absence for the unset ones", async () => {
    const { criteria } = await ok(FIXED);

    expect(Object.keys(criteria).sort()).toEqual([
      "budget_priority",
      "calories",
      "canonical",
      "chips",
      "daypart",
      "exclude",
      "goals",
      "include",
      "limits",
      "price_max",
      "summary",
      "variety",
    ]);
    expect(criteria.calories).toEqual({ target: null, min: null, max: null });
    expect(criteria.price_max).toBeNull();
  });

  it("echoes the restaurant and what it understood", async () => {
    const body = await ok("high protein chick-fil-a around 800 calories under $15");

    expect(body.restaurant).toEqual({ name: "Chick-fil-A", slug: "chick-fil-a", type: "fixed" });
    expect(body.query).toBe("high protein chick-fil-a around 800 calories under $15");
    expect(body.criteria.goals).toEqual([{ nutrient: "protein_g", direction: "high" }]);
    expect(body.criteria.calories.target).toBe(800);
    expect(body.criteria.price_max).toBe(15);
    expect(body.criteria.canonical).toBe("high protein, around 800 cal, under $15");
    expect(body.criteria.chips.map((c) => c.label)).toEqual(["High protein", "Around 800 cal", "Under $15"]);
  });

  it("never exposes a score", async () => {
    const body = await ok(FIXED);
    const keys = JSON.stringify(body);
    for (const word of ["score", "merit", "goalScore"]) expect(keys).not.toContain(`"${word}"`);
  });

  it("says where the numbers came from", async () => {
    const { data } = await ok(FIXED);
    expect(Object.keys(data.nutrition!).sort()).toEqual(
      ["age_days", "fetched_at", "market", "notes", "source", "stale", "url"]
    );
    expect(data.price!.market).toBe("US national average");
  });
});

describe("GET /api/search — results", () => {
  it("returns labelled orders for every seeded restaurant, with or without criteria", async () => {
    for (const name of [
      "chick-fil-a", "mcdonalds", "chipotle", "taco bell",
      "panda express", "raising canes", "whataburger",
    ]) {
      for (const q of [name, `high protein ${name}`]) {
        const body = await ok(q);
        expect(body.results.length, `"${q}" returned nothing`).toBeGreaterThanOrEqual(3);
        expect(body.results[0].label).toBe("Best match");
        const labels = body.results.map((r) => r.label);
        expect(new Set(labels).size, `"${q}": ${labels.join(", ")}`).toBe(labels.length);
      }
    }
  });

  it("marks fixed-menu results as meals and build-your-own results as builds", async () => {
    for (const result of (await ok(FIXED)).results) {
      expect(result.kind).toBe("meal");
      expect(["classic", "single", "stack"]).toContain(result.shape);
    }
    for (const result of (await ok(BUILD)).results) {
      expect(result.kind).toBe("build");
      expect(result.shape).toBe("build");
    }
  });

  it("tags build-your-own picks with the slot they came from", async () => {
    for (const result of (await ok(BUILD)).results) {
      for (const item of result.items) {
        expect(item.group, `${item.name} has no slot`).toBeTruthy();
        expect(item.role).toBeUndefined();
      }
    }
  });

  it("gives fixed-menu items a role and no slot", async () => {
    for (const item of (await ok(FIXED)).results.flatMap((r) => r.items)) {
      expect(item.group).toBeUndefined();
      expect(["main", "side", "dessert"]).toContain(item.role);
    }
  });

  // Totals are what the UI displays. If they disagree with the items listed
  // beside them, the user sees an order that doesn't add up.
  it("reports totals that match the items listed, quantities included", async () => {
    for (const q of [FIXED, BUILD, "low carb taco bell", "high protein chick-fil-a around 800 calories"]) {
      for (const result of (await ok(q)).results) {
        const calories = result.items.reduce((s, i) => s + i.calories * i.quantity, 0);
        const price = +result.items.reduce((s, i) => s + i.price! * i.quantity, 0).toFixed(2);
        expect(result.total_calories, `${q} — ${result.label}`).toBe(calories);
        expect(result.total_price, `${q} — ${result.label}`).toBeCloseTo(price, 2);
      }
    }
  });

  it("respects a stated calorie target", async () => {
    for (const [q, target] of [
      ["high protein chick-fil-a around 800 calories", 800],
      ["high protein chipotle around 800 calories", 800],
      ["low fat whataburger around 700 calories", 700],
    ] as const) {
      const body = await ok(q);
      expect(body.criteria.calories.target).toBe(target);
      for (const result of body.results) {
        expect(result.total_calories, `${q} — ${result.label}`).toBeLessThanOrEqual(target * 1.15);
        expect(result.total_calories, `${q} — ${result.label}`).toBeGreaterThanOrEqual(target * 0.85);
      }
    }
  });

  it("reports what it could not do", async () => {
    const body = await ok("raising canes around 600 calories");
    expect(body.notices.map((n) => n.code)).toEqual(["calorie_target_unreachable"]);
    expect(body.notices[0].message).toMatch(/830/);
  });
});

describe("GET /api/search — at a storefront", () => {
  it("needs no restaurant in the text when one is given as a parameter", async () => {
    const body = await ok({ q: "high protein under 700 calories", restaurant: "chipotle" });
    expect(body.restaurant.slug).toBe("chipotle");
    expect(body.criteria.canonical).toBe("high protein, under 700 cal");
  });

  it("accepts an empty message when standing at a restaurant", async () => {
    const body = await ok({ q: "", restaurant: "mcdonalds" });
    expect(body.restaurant.slug).toBe("mcdonalds");
    expect(body.criteria.canonical).toBe("");
    expect(body.results.length).toBeGreaterThanOrEqual(3);
  });

  it("continues a conversation from the previous response's criteria", async () => {
    const first = await ok({ q: "high protein", restaurant: "chipotle" });
    const second = await ok({ q: "under $11", restaurant: "chipotle", context: first.criteria.canonical });
    const third = await ok({ q: "no rice", restaurant: "chipotle", context: second.criteria.canonical });

    expect(third.criteria.canonical).toBe("high protein, under $11, no rice");
    for (const result of third.results) {
      expect(result.total_price).toBeLessThanOrEqual(11);
      expect(result.items.filter((i) => i.group === "rice")).toEqual([]);
    }
  });

  it("goes to another restaurant when the message names one, leaving the old criteria behind", async () => {
    const body = await ok({
      q: "what about taco bell",
      restaurant: "chipotle",
      context: "high protein, no rice",
    });
    expect(body.restaurant.slug).toBe("taco-bell");
    expect(body.criteria.canonical).toBe("");
  });

  it("works out the restaurant from a menu item", async () => {
    const body = await ok("big mac under 700 calories");
    expect(body.restaurant.slug).toBe("mcdonalds");
    expect(body.criteria.include).toEqual(["big mac"]);
    for (const result of body.results) {
      expect(result.items.map((i) => i.name)).toContain("Big Mac");
    }
  });

  it("ignores a restaurant parameter it does not recognise", async () => {
    const { status, body } = await search({ q: "high protein", restaurant: "nowhere" });
    expect(status).toBe(400);
    expect((body as SearchError).code).toBe("no_restaurant");
  });
});
