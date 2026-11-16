import { describe, it, expect } from "vitest";
import { ALL, ask, describeAll, describeOrder, namesIn, density } from "./__fixtures__/ask";
import { menuOf } from "./__fixtures__/seedMenus";

// ── One test per defect ──────────────────────────────────────────────────────
//
// Every row of the defect table in the handoff, plus two found while
// reproducing it. Each was observed in the real API's output first — that
// output is preserved in docs/defects-before.md — then captured here, then
// fixed. The assertion messages print the offending orders, because "expected
// false to be true" tells you nothing about a recommendation engine.

const roleOf = (slug: string, name: string) =>
  menuOf(slug).items.find((i) => i.name === name)?.role;

describe("lean mcdonalds ~500 cal", () => {
  // Was: "Hamburger + Soft Serve Cone + Side Salad" labelled "Double up",
  // because Side Salad was stored under category `salad` and so counted as a
  // second main course.
  const response = ask("mcdonalds", "lean mcdonalds ~500 cal");

  it("does not count a side salad as a main", () => {
    expect(roleOf("mcdonalds", "Side Salad")).toBe("side");
    expect(roleOf("chick-fil-a", "Side Salad")).toBe("side");
  });

  it("only calls an order a double-up when it has two mains", () => {
    for (const result of response.results.filter((r) => r.label === "Double up")) {
      const mains = result.items.filter((i) => i.role === "main").reduce((n, i) => n + i.quantity, 0);
      expect(mains, describeOrder(result)).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("whataburger under 800 calories", () => {
  const response = ask("whataburger", "whataburger under 800 calories");

  // Was: "under" read as "around", so an 810 calorie order came back.
  it("treats 'under' as a ceiling, not a target", () => {
    expect(response.criteria.calories).toEqual({ target: null, min: null, max: 800 });
    for (const result of response.results) {
      expect(result.total_calories, describeOrder(result)).toBeLessThanOrEqual(800);
    }
  });

  // Was: three orders of Hash Brown Sticks as a meal, because category
  // `breakfast` made every breakfast item a main.
  it("never builds a meal out of sides alone", () => {
    expect(roleOf("whataburger", "Hash Brown Sticks (6 ct)")).toBe("side");
    for (const result of response.results) {
      expect(
        result.items.some((i) => i.role === "main"),
        describeOrder(result)
      ).toBe(true);
    }
  });

  // Was: "Cinnamon Roll + fries" as the Classic meal.
  it("does not build a meal around a cinnamon roll", () => {
    expect(roleOf("whataburger", "Cinnamon Roll")).toBe("dessert");
    for (const q of ["whataburger", "whataburger under 800 calories", "whataburger breakfast"]) {
      for (const result of ask("whataburger", q).results) {
        const mains = result.items.filter((i) => i.role === "main").map((i) => i.name);
        expect(mains, describeOrder(result)).not.toContain("Cinnamon Roll");
      }
    }
  });
});

describe("low carb taco bell", () => {
  const response = ask("taco-bell", "low carb taco bell");

  // Was: the "one of each shape" pass forced Cinnabon Delights into a low-carb
  // order to manufacture a Classic meal.
  it("does not add a dessert to a low-carb order", () => {
    for (const result of response.results) {
      expect(
        result.items.filter((i) => i.role === "dessert").map((i) => i.name),
        describeOrder(result)
      ).toEqual([]);
    }
  });

  it("does not add a carb-heavy side either", () => {
    for (const result of response.results) {
      expect(namesIn(result), describeOrder(result)).not.toContain("Chips & Nacho Cheese Sauce");
    }
  });

  // Was: "Breakfast Soft Taco x2 + Cinnabon" labelled "Double up".
  it("stays on the all-day menu unless breakfast is asked for", () => {
    const breakfast = new Set(
      menuOf("taco-bell").items.filter((i) => i.daypart === "breakfast").map((i) => i.name)
    );
    for (const result of response.results) {
      expect(namesIn(result).filter((n) => breakfast.has(n)), describeOrder(result)).toEqual([]);
    }
  });

  it("weighs a breakfast taco like a taco", () => {
    const taco = menuOf("taco-bell").items.find((i) => i.name === "Breakfast Soft Taco (Egg)")!;
    expect(taco.portion_weight).toBeLessThan(0.5);
  });
});

describe("cheapest high protein chipotle", () => {
  // Was: a 1,310 calorie burrito with double rice and double beans (180g of
  // carbs). Totals-based scoring rewarded size — everything has some protein.
  const response = ask("chipotle", "cheapest high protein chipotle");
  const best = response.results[0];

  it("answers with a meal, not the biggest thing on the menu", () => {
    expect(best.total_calories, describeOrder(best)).toBeLessThanOrEqual(900);
    expect(best.total_carbs_g, describeOrder(best)).toBeLessThan(100);
  });

  it("does not pad the order with double rice", () => {
    for (const result of response.results) {
      expect(namesIn(result).filter((n) => /Rice \(Double\)/.test(n)), describeOrder(result)).toEqual([]);
    }
  });

  it("leads with a cheap order when asked for the cheapest", () => {
    const cheapest = Math.min(...response.results.map((r) => r.total_price!));
    expect(best.total_price, describeAll(response)).toBe(cheapest);
  });
});

describe("chipotle, with nothing else said", () => {
  // Was: "Balanced" came back as a 1,145 calorie sofritas burrito. With no
  // goals the old score collapsed to price alone.
  const response = ask("chipotle", "chipotle");

  it("returns ordinary-sized meals", () => {
    for (const result of response.results) {
      expect(result.total_calories, describeOrder(result)).toBeGreaterThanOrEqual(350);
      expect(result.total_calories, describeOrder(result)).toBeLessThanOrEqual(1050);
    }
  });

  it("does not double a portion just because doubling is free", () => {
    const best = response.results[0];
    expect(namesIn(best).filter((n) => n.includes("(Double)")), describeOrder(best)).toEqual([]);
  });
});

describe("high protein panda express", () => {
  // Was: "Most variety" had 31g of protein against 114g for "Best match".
  const response = ask("panda-express", "high protein panda express");

  it("keeps every alternative within reach of the best match on protein", () => {
    const best = response.results[0];
    for (const result of response.results.slice(1)) {
      expect(
        density(result, "total_protein_g"),
        `${describeOrder(result)}\n  vs best: ${describeOrder(best)}`
      ).toBeGreaterThanOrEqual(density(best, "total_protein_g") * 0.55);
    }
  });

  it("still offers a varied order", () => {
    expect(response.results.map((r) => r.label), describeAll(response)).toContain("Most variety");
  });
});

describe("cheap meal at mcdonalds under $8", () => {
  // Was: the price was not parsed at all.
  const response = ask("mcdonalds", "cheap meal at mcdonalds under $8");

  it("reads the price as a cap", () => {
    expect(response.criteria.price_max).toBe(8);
    expect(response.criteria.budget_priority).toBe(true);
  });

  it("keeps every result under it", () => {
    expect(response.results.length).toBeGreaterThan(0);
    for (const result of response.results) {
      expect(result.total_price, describeOrder(result)).toBeLessThanOrEqual(8);
    }
  });

  // Was: "Hamburger + Apple Slices + Apple Slices".
  it("does not order the same side twice", () => {
    for (const result of response.results) {
      for (const item of result.items.filter((i) => i.role !== "main")) {
        expect(item.quantity, describeOrder(result)).toBe(1);
      }
    }
  });

  it("holds a tighter cap too", () => {
    for (const result of ask("mcdonalds", "mcdonalds under $4").results) {
      expect(result.total_price, describeOrder(result)).toBeLessThanOrEqual(4);
    }
  });
});

describe("raising canes around 600 calories", () => {
  // Was: an 830 calorie order with nothing to say the target was unreachable.
  const response = ask("raising-canes", "raising canes around 600 calories");

  it("still answers with the nearest orders", () => {
    expect(response.results.length).toBeGreaterThan(0);
    for (const result of response.results) {
      expect(result.total_calories, describeOrder(result)).toBeLessThanOrEqual(1000);
    }
  });

  it("says the target could not be met, and what the closest is", () => {
    const notice = response.notices.find((n) => n.code === "calorie_target_unreachable");
    expect(notice, JSON.stringify(response.notices)).toBeDefined();
    expect(notice!.message).toContain("600");
    expect(notice!.message).toContain("830");
  });

  it("stays quiet when the target is reachable", () => {
    expect(ask("raising-canes", "raising canes around 900 calories").notices).toEqual([]);
  });
});

describe("any query: consistent results across restaurant types", () => {
  // Was: fixed menus returned five results with repeated labels, build-your-own
  // returned three, and the UI showed the first three of either.
  const queries = ["", "high protein", "low carb", "around 800 calories", "cheap", "low fat under 700 calories"];

  it("never repeats a label", () => {
    for (const slug of ALL) {
      for (const q of queries) {
        const response = ask(slug, q);
        const labels = response.results.map((r) => r.label);
        expect(new Set(labels).size, `${slug} "${q}": ${labels.join(", ")}`).toBe(labels.length);
      }
    }
  });

  it("leads with the best match — or says plainly that it is only the closest", () => {
    for (const slug of ALL) {
      for (const q of queries) {
        const response = ask(slug, q);
        const first = response.results[0]?.label;

        // "Closest match" is only ever shown alongside the reason: Raising
        // Cane's has nothing under 700 calories, and says so.
        if (first === "Closest match") {
          expect(response.notices.length, `${slug} "${q}" gave no reason`).toBeGreaterThan(0);
        } else {
          expect(first, `${slug} "${q}"`).toBe("Best match");
        }
      }
    }
  });

  it("returns between three and five orders, whatever the restaurant", () => {
    for (const slug of ALL) {
      for (const q of ["", "high protein", "cheap"]) {
        const response = ask(slug, q);
        expect(response.results.length, `${slug} "${q}":\n${describeAll(response)}`).toBeGreaterThanOrEqual(3);
        expect(response.results.length, `${slug} "${q}"`).toBeLessThanOrEqual(5);
      }
    }
  });

  it("never returns the same order twice", () => {
    for (const slug of ALL) {
      for (const q of queries) {
        const ids = ask(slug, q).results.map((r) => r.id);
        expect(new Set(ids).size, `${slug} "${q}"`).toBe(ids.length);
      }
    }
  });
});

describe("found while reproducing the table", () => {
  // Was: a lone 15 calorie Side Salad returned as "Just the main".
  it("low calorie mcdonalds: a meal, not a garnish", () => {
    const response = ask("mcdonalds", "low calorie mcdonalds");
    for (const result of response.results) {
      expect(result.items.some((i) => i.role === "main"), describeOrder(result)).toBe(true);
      expect(result.total_calories, describeOrder(result)).toBeGreaterThanOrEqual(200);
      expect(result.total_calories, describeOrder(result)).toBeLessThanOrEqual(600);
      // A dessert is not how anyone reaches a low-calorie target.
      expect(result.items.filter((i) => i.role === "dessert"), describeOrder(result)).toEqual([]);
    }
  });

  // Was: "burger" ignored — Sausage Biscuit and Hash Browns came back.
  it("cheapest burger under 500 calories: every result is a burger", () => {
    const response = ask("mcdonalds", "cheapest burger under 500 calories McDonald's");
    const burgers = new Set(
      menuOf("mcdonalds").items.filter((i) => i.category === "burger").map((i) => i.name)
    );
    expect(response.criteria.include).toEqual(["burger"]);
    for (const result of response.results) {
      expect(namesIn(result).some((n) => burgers.has(n)), describeOrder(result)).toBe(true);
      expect(result.total_calories, describeOrder(result)).toBeLessThanOrEqual(500);
    }
    expect(response.results[0].items.map((i) => i.name)).toEqual(["Hamburger"]);
  });
});
