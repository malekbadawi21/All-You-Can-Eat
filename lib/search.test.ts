import { describe, it, expect } from "vitest";
import { ask, converse, describeAll, describeOrder, namesIn } from "./__fixtures__/ask";
import { CATALOG, SEED_MENUS, menuFromDocument, menuOf } from "./__fixtures__/seedMenus";
import type { MenuDocument } from "./menuDocument";
import { parseQuery } from "./parseQuery";
import { inferRestaurant, searchMenu } from "./search";

// The layer between the parser and the engine: matching words to a menu,
// carrying a conversation, and saying what couldn't be done.

describe("a conversation at one restaurant", () => {
  it("keeps what was said before", () => {
    const response = converse("chipotle", "high protein", "around 800 calories", "under $12");
    expect(response.criteria.canonical).toBe("high protein, around 800 cal, under $12");

    for (const result of response.results) {
      expect(result.total_price, describeOrder(result)).toBeLessThanOrEqual(12);
      expect(result.total_calories, describeOrder(result)).toBeGreaterThanOrEqual(680);
    }
  });

  it("makes each turn change the answer the way it was asked to", () => {
    const first = ask("chipotle", "high protein");
    const noBeans = ask("chipotle", "no beans", first.criteria.canonical);

    expect(noBeans.criteria.exclude).toEqual(["beans"]);
    expect(noBeans.criteria.goals).toEqual(first.criteria.goals);
    for (const result of noBeans.results) {
      expect(namesIn(result).filter((n) => /Beans/.test(n)), describeOrder(result)).toEqual([]);
    }
  });

  it("gets lighter when asked for lighter", () => {
    const first = ask("chick-fil-a", "high protein around 800 calories");
    const lighter = ask("chick-fil-a", "lighter", first.criteria.canonical);
    expect(lighter.criteria.calories.target).toBe(650);
    expect(lighter.results[0].total_calories).toBeLessThan(first.results[0].total_calories);
  });

  it("treats a new protein as a change of mind, not a second requirement", () => {
    const response = converse("chipotle", "with steak", "actually chicken");
    expect(response.criteria.include).toEqual(["chicken"]);
    expect(response.notices).toEqual([]);
    for (const result of response.results) {
      expect(namesIn(result).some((n) => n.startsWith("Chicken")), describeOrder(result)).toBe(true);
    }
  });

  it("drops a chip by searching for the text without it", () => {
    const response = converse("chipotle", "high protein", "under 700 calories", "no rice");
    const chip = response.criteria.chips.find((c) => c.id === "calories")!;
    const without = ask("chipotle", chip.without);

    expect(without.criteria.canonical).toBe("high protein, no rice");
    expect(without.criteria.calories.max).toBeNull();
  });

  it("starts fresh on request", () => {
    const response = converse("chipotle", "high protein under 600 calories", "start over, low carb");
    expect(response.criteria.canonical).toBe("low carb");
  });

  // A link is canonical text in a URL. Opening it must restore the search.
  it("restores the same results from the canonical text alone", () => {
    const original = converse("mcdonalds", "high protein", "under 800 calories", "no fries", "cheap");
    const restored = ask("mcdonalds", original.criteria.canonical);

    expect(restored.criteria.canonical).toBe(original.criteria.canonical);
    expect(restored.results.map((r) => r.id)).toEqual(original.results.map((r) => r.id));
  });
});

describe("menu words", () => {
  it("requires what was asked for", () => {
    const response = ask("mcdonalds", "high protein with nuggets");
    expect(response.criteria.include).toEqual(["nuggets"]);
    for (const result of response.results) {
      expect(namesIn(result).some((n) => /McNuggets/.test(n)), describeOrder(result)).toBe(true);
    }
  });

  it("removes what was ruled out", () => {
    const response = ask("mcdonalds", "no fries");
    for (const result of response.results) {
      expect(namesIn(result).filter((n) => /Fries/.test(n)), describeOrder(result)).toEqual([]);
    }
  });

  it("matches whole words, so removing cream leaves the Icedream", () => {
    const response = ask("chick-fil-a", "no cone");
    expect(response.criteria.exclude).toEqual(["cone"]);

    const none = ask("chick-fil-a", "no cream");
    expect(none.criteria.exclude).toEqual([]);
  });

  it("keeps a multi-word item together", () => {
    const response = ask("panda-express", "orange chicken and fried rice");
    expect(response.criteria.include).toEqual(["orange chicken", "fried rice"]);
    for (const result of response.results) {
      expect(namesIn(result), describeOrder(result)).toContain("Orange Chicken");
      expect(namesIn(result), describeOrder(result)).toContain("Fried Rice");
    }
  });

  it("removes a whole slot by its name", () => {
    for (const result of ask("chipotle", "no rice").results) {
      expect(result.items.filter((i) => i.group === "rice"), describeOrder(result)).toEqual([]);
    }
  });

  it("says so when a word matches nothing on this menu", () => {
    const response = ask("chipotle", "high protein pizza");
    const notice = response.notices.find((n) => n.code === "unrecognized_terms");
    expect(notice?.message).toContain("pizza");
    // …and still answers the part it understood.
    expect(response.criteria.canonical).toBe("high protein");
    expect(response.results.length).toBeGreaterThan(0);
  });

  it("says so when asked about something there is no data for", () => {
    const response = ask("chipotle", "low sugar vegan");
    const notice = response.notices.find((n) => n.code === "unsupported_terms");
    expect(notice?.message).toMatch(/sugar/);
    expect(notice?.message).toMatch(/vegan/);
  });
});

describe("being honest about what can't be done", () => {
  it("explains a calorie ceiling nothing fits under", () => {
    const response = ask("raising-canes", "under 500 calories");
    const notice = response.notices.find((n) => n.code === "calorie_max_unreachable");

    expect(notice?.message, JSON.stringify(response.notices)).toContain("830");
    expect(response.results[0].label).toBe("Closest match");
    expect(response.results.length).toBeGreaterThan(0);
  });

  it("explains a price nothing fits under", () => {
    const response = ask("chipotle", "under $5");
    const notice = response.notices.find((n) => n.code === "price_max_unreachable");
    expect(notice?.message, JSON.stringify(response.notices)).toContain("$9.79");
    expect(response.results[0].label).toBe("Closest match");
  });

  it("explains a protein floor nothing reaches", () => {
    const response = ask("taco-bell", "at least 150g protein");
    expect(response.notices.map((n) => n.code)).toContain("nutrient_limit_unreachable");
  });

  it("says when requirements only fail in combination", () => {
    const response = ask("mcdonalds", "at least 60g protein under 400 calories");
    expect(response.notices.map((n) => n.code), describeAll(response)).toContain("constraints_conflict");
    expect(response.results.length).toBeGreaterThan(0);
  });

  it("stays silent when everything asked for was delivered", () => {
    for (const q of ["high protein", "under 800 calories", "around 700 calories under $12", "no fries"]) {
      expect(ask("mcdonalds", q).notices, q).toEqual([]);
    }
  });
});

describe("a restaurant with no prices", () => {
  // What a restaurant ingested from a nutrition-only source looks like.
  const doc: MenuDocument = {
    restaurant: { slug: "no-prices", name: "No Prices Grill", type: "fixed" },
    sources: {
      nutrition: { name: "Test sheet", market: "US", fetched_at: "2026-11-01", method: "file-import" },
    },
    items: [
      { name: "House Burger", calories: 520, protein_g: 28, fat_g: 26, carbs_g: 42, sodium_mg: 900 },
      { name: "Grilled Chicken Sandwich", calories: 380, protein_g: 34, fat_g: 9, carbs_g: 40, sodium_mg: 820 },
      { name: "Fries", calories: 320, protein_g: 4, fat_g: 15, carbs_g: 42, sodium_mg: 260 },
      { name: "Side Salad", calories: 60, protein_g: 3, fat_g: 3, carbs_g: 6, sodium_mg: 90 },
      { name: "Egg Breakfast Sandwich", calories: 300, protein_g: 17, fat_g: 13, carbs_g: 30, sodium_mg: 740 },
    ],
  };
  const menu = menuFromDocument(doc, 99);
  const search = (q: string) => searchMenu(menu, { parsed: parseQuery(q, CATALOG), query: q });

  it("still recommends orders, with the price left unknown rather than zero", () => {
    const response = search("high protein");
    expect(response.results.length).toBeGreaterThan(0);
    for (const result of response.results) {
      expect(result.total_price).toBeNull();
      expect(result.items.every((i) => i.price === null)).toBe(true);
    }
    expect(response.data.price).toBeNull();
    expect(response.data.nutrition?.source).toBe("Test sheet");
  });

  it("says price was ignored, instead of pretending to honour a budget", () => {
    const response = search("cheap under $6");
    expect(response.notices.map((n) => n.code)).toContain("price_unavailable");
    expect(response.results.length).toBeGreaterThan(0);
  });

  it("never offers a budget pick", () => {
    expect(search("").results.map((r) => r.label)).not.toContain("Budget pick");
  });
});

describe("no breakfast on record", () => {
  it("says so and shows the all-day menu", () => {
    const doc: MenuDocument = {
      restaurant: { slug: "lunch-only", name: "Lunch Only", type: "fixed" },
      sources: { nutrition: { name: "Sheet", market: "US", fetched_at: "2026-11-01", method: "file-import" } },
      items: [
        { name: "House Burger", calories: 520, protein_g: 28, fat_g: 26, carbs_g: 42, sodium_mg: 900 },
        { name: "Fries", calories: 320, protein_g: 4, fat_g: 15, carbs_g: 42, sodium_mg: 260 },
      ],
    };
    const response = searchMenu(menuFromDocument(doc, 98), {
      parsed: parseQuery("breakfast", CATALOG),
      query: "breakfast",
    });
    expect(response.notices.map((n) => n.code)).toEqual(["no_breakfast"]);
    expect(response.results.length).toBeGreaterThan(0);
  });
});

describe("where the numbers came from", () => {
  it("travels with every response", () => {
    const { data } = ask("chick-fil-a", "high protein");
    expect(data.nutrition?.source).toMatch(/Chick-fil-A/);
    expect(data.nutrition?.fetched_at).toBe("2026-07-29");
    expect(data.price?.market).toBe("US national average");
    expect(data.price?.age_days).toBe(101);
    expect(data.price?.stale).toBe(false);
  });

  it("carries the estimate flag through to the order", () => {
    const response = ask("raising-canes", "with sandwich");
    const combo = response.results[0].items.find((i) => i.name === "Sandwich Combo")!;
    expect(combo.price_estimated).toBe(true);
    expect(response.results[0].price_estimated).toBe(true);
  });
});

describe("working out the restaurant from the food", () => {
  const infer = (q: string) => inferRestaurant(parseQuery(q, CATALOG).leftover, SEED_MENUS);

  it("knows where a signature item is from", () => {
    expect(infer("big mac under 600")).toBe("mcdonalds");
    expect(infer("orange chicken")).toBe("panda-express");
    expect(infer("crunchwrap")).toBe("taco-bell");
    expect(infer("carnitas bowl")).toBe("chipotle");
  });

  it("declines to guess when the food is sold everywhere", () => {
    // Chipotle and Taco Bell both sell a chicken bowl, and both have a double.
    expect(infer("double chicken bowl")).toBeNull();
    expect(infer("chicken")).toBeNull();
    expect(infer("a burger and fries")).toBeNull();
    expect(infer("high protein")).toBeNull();
  });
});

describe("order lines", () => {
  it("folds repeats into a quantity", () => {
    const response = ask("taco-bell", "low carb");
    const tacos = response.results[0].items.find((i) => i.quantity > 1);
    expect(tacos, describeAll(response)).toBeDefined();
    expect(response.results[0].items.filter((i) => i.name === tacos!.name).length).toBe(1);
  });

  it("lists mains before sides before desserts", () => {
    const order = { main: 0, side: 1, dessert: 2 };
    for (const result of ask("mcdonalds", "around 900 calories").results) {
      const roles = result.items.map((i) => order[i.role!]);
      expect(roles, describeOrder(result)).toEqual([...roles].sort((a, b) => a - b));
    }
  });

  it("keeps build picks in the order they are said at the counter", () => {
    const slots = menuOf("chipotle").slots.map((s) => s.slot_name);
    for (const result of ask("chipotle", "").results) {
      const positions = result.items.map((i) => slots.indexOf(i.group!));
      expect(positions, describeOrder(result)).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});
