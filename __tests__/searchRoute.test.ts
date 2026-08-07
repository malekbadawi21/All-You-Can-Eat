import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/search/route";
import type { SearchResponse, SearchError } from "@/lib/searchResult";

// These are integration tests: unlike everything under lib/, they run the real
// route against the real seeded database. That's the point — the route is what
// the UI talks to, and until now the only thing with no tests at all.

async function search(q?: string) {
  const url = new URL("http://localhost:3000/api/search");
  if (q !== undefined) url.searchParams.set("q", q);
  const response = await GET(new NextRequest(url));
  return { status: response.status, body: await response.json() };
}

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

  it("tells the caller what restaurants exist when none was recognised", async () => {
    const { status, body } = await search("high protein food");
    expect(status).toBe(400);
    expect((body as SearchError).code).toBe("no_restaurant");
    expect((body as SearchError).available).toContain("Chipotle");
  });
});

describe("GET /api/search — one shape for every restaurant", () => {
  // The contract the UI is built against. If a fixed menu and a build-your-own
  // restaurant answer with different keys, every consumer needs two code paths.
  it("answers with identical top-level keys regardless of restaurant type", async () => {
    const fixed = await search(FIXED);
    const build = await search(BUILD);

    expect(fixed.status).toBe(200);
    expect(build.status).toBe(200);
    expect(Object.keys(fixed.body).sort()).toEqual(Object.keys(build.body).sort());
  });

  it("answers with identical result keys regardless of restaurant type", async () => {
    const fixed = (await search(FIXED)).body as SearchResponse;
    const build = (await search(BUILD)).body as SearchResponse;

    expect(Object.keys(fixed.results[0]).sort()).toEqual(
      Object.keys(build.results[0]).sort()
    );
  });

  it("reports calorie_target as null rather than omitting it", async () => {
    const body = (await search(FIXED)).body as SearchResponse;
    expect(body).toHaveProperty("calorie_target");
    expect(body.calorie_target).toBeNull();
  });

  it("echoes the parsed goals and restaurant back to the caller", async () => {
    const body = (await search(FIXED)).body as SearchResponse;
    expect(body.restaurant.slug).toBe("chick-fil-a");
    expect(body.restaurant.type).toBe("fixed");
    expect(body.goals).toEqual([{ nutrient: "protein_g", direction: "high" }]);
  });
});

describe("GET /api/search — results", () => {
  // The regression that motivated unifying the contract: without a calorie
  // number, fixed menus used to return ten loose menu items with no labels,
  // so none of the meal grammar applied. The homepage searches this way.
  it("returns labelled meals for a fixed menu even with no calorie target", async () => {
    const body = (await search(FIXED)).body as SearchResponse;

    expect(body.results.length).toBeGreaterThan(0);
    for (const result of body.results) {
      expect(result.kind).toBe("meal");
      expect(result.label, JSON.stringify(result.items.map((i) => i.name))).toBeTruthy();
    }
  });

  it("spans more than one kind of order", async () => {
    const body = (await search(FIXED)).body as SearchResponse;
    const labels = new Set(body.results.map((r) => r.label));
    expect(
      labels.size,
      `all results were "${[...labels][0]}"`
    ).toBeGreaterThan(1);
  });

  it("tags build-your-own picks with the slot they came from", async () => {
    const body = (await search(BUILD)).body as SearchResponse;

    for (const result of body.results) {
      expect(result.kind).toBe("build");
      for (const item of result.items) {
        expect(item.group, `${item.name} has no slot`).toBeTruthy();
      }
    }
  });

  it("leaves fixed-menu items ungrouped", async () => {
    const body = (await search(FIXED)).body as SearchResponse;
    for (const item of body.results.flatMap((r) => r.items)) {
      expect(item.group).toBeUndefined();
    }
  });

  // Totals are what the UI displays. If they disagree with the items listed
  // beside them, the user sees an order that doesn't add up.
  it("reports totals that match the items listed", async () => {
    for (const q of [FIXED, BUILD, "high protein chick-fil-a around 800 calories"]) {
      const body = (await search(q)).body as SearchResponse;
      for (const result of body.results) {
        const calories = result.items.reduce((s, i) => s + i.calories, 0);
        const price = +result.items.reduce((s, i) => s + i.price, 0).toFixed(2);
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
      const body = (await search(q)).body as SearchResponse;
      expect(body.calorie_target).toBe(target);
      for (const result of body.results) {
        expect(result.total_calories, `${q} — ${result.label}`).toBeLessThanOrEqual(
          target * 1.25
        );
      }
    }
  });

  it("returns results for every seeded restaurant", async () => {
    for (const name of [
      "chick-fil-a", "mcdonalds", "chipotle", "taco bell",
      "panda express", "raising canes", "whataburger",
    ]) {
      const body = (await search(`high protein ${name}`)).body as SearchResponse;
      expect(body.results.length, `${name} returned nothing`).toBeGreaterThan(0);
    }
  });
});
