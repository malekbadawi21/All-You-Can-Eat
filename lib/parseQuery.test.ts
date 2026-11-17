import { describe, it, expect } from "vitest";
import { parseQuery, squash, type CatalogEntry } from "./parseQuery";
import { applyPatch, canonicalText, chipsFor, emptyCriteria, type Criteria } from "./criteria";
import { SEED_DOCUMENTS } from "@/db/seed";

// The catalog the parser sees in production comes from the database. Building
// it from the seed documents keeps these tests free of any database at all.
const CATALOG: CatalogEntry[] = SEED_DOCUMENTS.map((d) => ({
  slug: d.restaurant.slug,
  name: d.restaurant.name,
  aliases: d.restaurant.aliases ?? [],
}));

const parse = (q: string) => parseQuery(q, CATALOG);
const criteria = (q: string, base: Criteria = emptyCriteria()) => applyPatch(base, parse(q).patch);
const goalsOf = (q: string) =>
  criteria(q)
    .goals.map((g) => `${g.direction} ${g.nutrient}`)
    .sort();

describe("restaurant recognition", () => {
  it.each([
    ["high protein chick-fil-a", "chick-fil-a"],
    ["Chick Fil A grilled nuggets", "chick-fil-a"],
    ["chickfila", "chick-fil-a"],
    ["cfa under 600", "chick-fil-a"],
    ["McDonald's", "mcdonalds"],
    ["McDonald’s big mac", "mcdonalds"],
    ["mcdonalds", "mcdonalds"],
    ["mickey d's", "mcdonalds"],
    ["taco bell", "taco-bell"],
    ["Raising Cane's around 900", "raising-canes"],
    ["canes", "raising-canes"],
    ["panda", "panda-express"],
    ["PANDA EXPRESS!!", "panda-express"],
    ["whataburger", "whataburger"],
  ])("%s → %s", (q, slug) => {
    expect(parse(q).restaurant).toBe(slug);
  });

  it.each([
    ["chipolte", "chipotle"],
    ["chipoltle bowl", "chipotle"],
    ["mcdonlds", "mcdonalds"],
    ["macdonalds", "mcdonalds"],
    ["chik fil a", "chick-fil-a"],
    ["taco bel", "taco-bell"],
    ["whatabuger", "whataburger"],
    ["rasing canes", "raising-canes"],
  ])("forgives the typo %s", (q, slug) => {
    expect(parse(q).restaurant).toBe(slug);
  });

  // "tb" is an alias for Taco Bell; it is also the middle of "meatball".
  it("matches aliases as whole words only", () => {
    expect(parse("meatball sub").restaurant).toBeNull();
    expect(parse("cakes").restaurant).toBeNull();
    expect(parse("high protein").restaurant).toBeNull();
  });

  it("does not leave the restaurant's name behind as a menu word", () => {
    expect(parse("high protein chick-fil-a").leftover).toEqual([]);
    expect(parse("low carb taco bell").leftover).toEqual([]);
  });
});

describe("restaurants we don't have", () => {
  // The defect: "high protein wendys" answered "no restaurant found", which is
  // untrue — one was named, we just don't carry it.
  it("recognises a chain it knows of but has no menu for", () => {
    const parsed = parse("high protein wendys");
    expect(parsed.restaurant).toBeNull();
    expect(parsed.unknownRestaurant).toEqual({ name: "Wendy's", slug: "wendys", known: true });
  });

  it.each(["burger king whopper", "subway under 500 cal", "kfc", "5 guys", "in-n-out"])(
    "recognises %s",
    (q) => {
      expect(parse(q).unknownRestaurant?.known).toBe(true);
    }
  );

  it("takes a guess at a name it has never seen", () => {
    expect(parse("high protein at bobs diner").unknownRestaurant).toEqual({
      name: "Bobs Diner",
      slug: "bobs-diner",
      known: false,
    });
  });

  it("does not invent a restaurant out of ordinary words", () => {
    for (const q of ["high protein food", "something healthy for lunch", "cheap burger", "low carb"]) {
      const parsed = parse(q);
      expect(parsed.restaurant, q).toBeNull();
      expect(parsed.unknownRestaurant, q).toBeNull();
    }
  });
});

describe("calories: constraint, target, or range", () => {
  it.each([
    ["under 800 calories", { target: null, min: null, max: 800 }],
    ["below 500 cal", { target: null, min: null, max: 500 }],
    ["less than 600 kcal", { target: null, min: null, max: 600 }],
    ["at most 700 cals", { target: null, min: null, max: 700 }],
    ["max 650 calories", { target: null, min: null, max: 650 }],
    ["<500 cal", { target: null, min: null, max: 500 }],
    ["500 calories or less", { target: null, min: null, max: 500 }],
    ["under 800", { target: null, min: null, max: 800 }],
    ["over 1000 calories", { target: null, min: 1000, max: null }],
    ["at least 900 cal", { target: null, min: 900, max: null }],
    ["1000+ calories", { target: null, min: 1000, max: null }],
    ["around 800 calories", { target: 800, min: null, max: null }],
    ["about 700", { target: 700, min: null, max: null }],
    ["~500 cal", { target: 500, min: null, max: null }],
    ["roughly 650 cal", { target: 650, min: null, max: null }],
    ["800 calories", { target: 800, min: null, max: null }],
    ["an 800-calorie lunch", { target: 800, min: null, max: null }],
    ["800 calorie", { target: 800, min: null, max: null }],
    ["500-700 cal", { target: null, min: 500, max: 700 }],
    ["500 to 700 calories", { target: null, min: 500, max: 700 }],
    ["between 500 and 700 calories", { target: null, min: 500, max: 700 }],
  ])("%s", (q, expected) => {
    expect(criteria(`${q} chipotle`).calories).toEqual(expected);
  });

  it("leaves calories alone when none are mentioned", () => {
    expect(parse("high protein chipotle").patch.calories).toBeUndefined();
  });

  it("ignores numbers that cannot be calories", () => {
    expect(criteria("under 99999 calories chipotle").calories).toEqual({ target: null, min: null, max: null });
  });
});

describe("price: always a cap", () => {
  it.each([
    ["under $8", 8],
    ["under $7.50", 7.5],
    ["$10", 10],
    ["for $12", 12],
    ["less than 9 dollars", 9],
    ["10 bucks", 10],
    ["under 8", 8],
    ["$6 or less", 6],
  ])("%s", (q, expected) => {
    expect(criteria(`cheap meal at mcdonalds ${q}`).price_max).toBe(expected);
  });

  it("keeps a price and a calorie number apart in the same query", () => {
    const c = criteria("mcdonalds under $8 under 800 calories");
    expect(c.price_max).toBe(8);
    expect(c.calories.max).toBe(800);
  });

  it("does not read a dollar amount as calories", () => {
    expect(criteria("mcdonalds $800").calories.target).toBeNull();
  });
});

describe("nutrient limits", () => {
  it("reads a protein amount as a floor", () => {
    expect(criteria("chipotle 40g protein").limits).toEqual([{ nutrient: "protein_g", min: 40, max: null }]);
    expect(criteria("chipotle at least 50 grams of protein").limits).toEqual([{ nutrient: "protein_g", min: 50, max: null }]);
    expect(criteria("chipotle 40g+ protein").limits).toEqual([{ nutrient: "protein_g", min: 40, max: null }]);
  });

  it("reads a carb, fat or sodium amount as a ceiling", () => {
    expect(criteria("chipotle under 30g carbs").limits).toEqual([{ nutrient: "carbs_g", min: null, max: 30 }]);
    expect(criteria("chipotle 20g fat").limits).toEqual([{ nutrient: "fat_g", min: null, max: 20 }]);
    expect(criteria("chipotle under 1000mg sodium").limits).toEqual([{ nutrient: "sodium_mg", min: null, max: 1000 }]);
    expect(criteria("chipotle carbs under 25").limits).toEqual([{ nutrient: "carbs_g", min: null, max: 25 }]);
  });

  it("leans the ranking the same way the limit points", () => {
    expect(goalsOf("chipotle at least 40g protein")).toEqual(["high protein_g"]);
    expect(goalsOf("chipotle under 30g carbs")).toEqual(["low carbs_g"]);
  });

  it("does not mistake a gram amount for calories", () => {
    expect(criteria("chipotle under 30g carbs").calories.max).toBeNull();
  });
});

describe("goals", () => {
  it.each([
    ["high protein", ["high protein_g"]],
    ["high-protein", ["high protein_g"]],
    ["protein", ["high protein_g"]],
    ["lots of protein", ["high protein_g"]],
    ["low carb", ["low carbs_g"]],
    ["low-carb", ["low carbs_g"]],
    ["keto", ["low carbs_g"]],
    ["no carbs", ["low carbs_g"]],
    ["low fat", ["low fat_g"]],
    ["lean", ["low fat_g"]],
    ["low sodium", ["low sodium_mg"]],
    ["low salt", ["low sodium_mg"]],
    ["low calorie", ["low calories"]],
    ["light", ["low calories"]],
    ["high protein low carb", ["high protein_g", "low carbs_g"]],
    ["keto high protein", ["high protein_g", "low carbs_g"]],
    ["healthy", ["high protein_g", "low calories"]],
    ["low protein", ["low protein_g"]],
  ])("%s", (q, expected) => {
    expect(goalsOf(`${q} chipotle`)).toEqual(expected.sort());
  });

  // Substring matching used to make "highlight" low-calorie and "dietary" a
  // diet. Whole words only.
  it("does not find goals inside other words", () => {
    expect(goalsOf("highlights chipotle")).toEqual([]);
    expect(goalsOf("dietary chipotle")).toEqual([]);
  });

  it("reads 'no fat' as a goal, not as an item to remove", () => {
    const parsed = parse("no fat chipotle");
    expect(parsed.excludePhrases).toEqual([]);
    expect(goalsOf("no fat chipotle")).toEqual(["low fat_g"]);
  });
});

describe("preferences", () => {
  it("separates 'cheap' (a lean) from 'under $8' (a cap)", () => {
    const cheap = criteria("cheap mcdonalds");
    expect(cheap.budget_priority).toBe(true);
    expect(cheap.price_max).toBeNull();

    const capped = criteria("mcdonalds under $8");
    expect(capped.budget_priority).toBe(false);
    expect(capped.price_max).toBe(8);
  });

  it("recognises variety, which used to be parsed and then ignored", () => {
    expect(criteria("mix it up panda express").variety).toBe(true);
    expect(criteria("panda express").variety).toBe(false);
  });

  it("recognises breakfast", () => {
    expect(criteria("high protein mcdonalds breakfast").daypart).toBe("breakfast");
    expect(criteria("high protein mcdonalds").daypart).toBe("all-day");
  });
});

describe("menu words", () => {
  it("hands back words it didn't understand, for the menu to settle", () => {
    expect(parse("cheapest burger under 500 calories McDonald's").leftover).toEqual(["burger"]);
    expect(parse("chipotle bowl with steak").leftover).toEqual(["bowl", "steak"]);
  });

  it("captures what to leave out", () => {
    expect(parse("chipotle no rice").excludePhrases).toEqual(["rice"]);
    expect(parse("chipotle without beans or sour cream").excludePhrases).toEqual(["beans", "sour cream"]);
    expect(parse("mcdonalds hold the fries, high protein").excludePhrases).toEqual(["fries"]);
  });

  it("flags things it recognises but has no data for", () => {
    expect(parse("low sugar vegan chipotle").unsupported).toEqual(["sugar", "vegan"]);
  });
});

describe("a conversation", () => {
  const say = (base: Criteria, q: string) => applyPatch(base, parse(q).patch);

  it("keeps earlier criteria when a later message changes something else", () => {
    let c = say(emptyCriteria(), "high protein chipotle around 800 calories");
    c = say(c, "under $12");
    expect(canonicalText(c)).toBe("high protein, around 800 cal, under $12");
  });

  it("replaces a statement about the same thing", () => {
    let c = say(emptyCriteria(), "around 800 calories");
    c = say(c, "under 600 calories");
    expect(c.calories).toEqual({ target: null, min: null, max: 600 });
  });

  it("understands relative requests", () => {
    let c = say(emptyCriteria(), "high protein around 800 calories");
    c = say(c, "lighter");
    expect(c.calories.target).toBe(650);
    c = say(c, "cheaper");
    expect(c.budget_priority).toBe(true);
    expect(c.goals).toEqual([{ nutrient: "protein_g", direction: "high" }]);
  });

  it("can forget one thing", () => {
    let c = say(emptyCriteria(), "high protein low carb around 800 calories under $10");
    c = say(c, "forget the calories");
    expect(canonicalText(c)).toBe("high protein, low carb, under $10");
    c = say(c, "any price");
    expect(canonicalText(c)).toBe("high protein, low carb");
    c = say(c, "drop carbs");
    expect(canonicalText(c)).toBe("high protein");
  });

  it("can start over", () => {
    let c = say(emptyCriteria(), "high protein under 600 calories");
    c = say(c, "start over, low carb");
    expect(canonicalText(c)).toBe("low carb");
  });

  it("changes its mind about a goal instead of holding both", () => {
    let c = say(emptyCriteria(), "low carb");
    c = say(c, "high carb");
    expect(c.goals).toEqual([{ nutrient: "carbs_g", direction: "high" }]);
  });
});

describe("canonical text", () => {
  // The property everything else leans on: writing criteria as text and
  // parsing that text gives the same criteria back. It is what makes a link
  // restore a search, and what lets the conversation be stateless.
  it.each([
    "high protein",
    "high protein low carb around 800 calories",
    "low fat under 600 cal under $7.50 cheap",
    "500-700 calories at least 40g protein",
    "over 900 cal under 60g carbs variety",
    "breakfast low sodium under 1200mg sodium",
    "healthy under $10",
  ])("round-trips: %s", (q) => {
    const first = criteria(q);
    const text = canonicalText(first);
    const second = criteria(text);
    expect(second, `"${q}" → "${text}"`).toEqual(first);
  });

  it("gives every chip the text of the search without it", () => {
    const chips = chipsFor(criteria("high protein around 800 calories under $12"));
    expect(chips.map((c) => c.label)).toEqual(["High protein", "Around 800 cal", "Under $12"]);
    expect(chips.map((c) => c.without)).toEqual([
      "around 800 cal, under $12",
      "high protein, under $12",
      "high protein, around 800 cal",
    ]);
  });
});

describe("squash", () => {
  it("flattens the punctuation people type around names", () => {
    expect(squash("Chick-fil-A")).toBe("chick fil a");
    expect(squash("McDonald’s")).toBe("mcdonalds");
    expect(squash("500-700 cal")).toBe("500-700 cal");
  });
});

describe("recognisers that decline a match", () => {
  // Found through the API: "protein under 700" looks like a gram limit, is
  // rejected as implausible, and used to take the calorie ceiling down with it.
  it("does not lose a calorie ceiling that follows the word protein", () => {
    const c = criteria("high protein under 700 calories");
    expect(c.calories).toEqual({ target: null, min: null, max: 700 });
    expect(c.goals).toEqual([{ nutrient: "protein_g", direction: "high" }]);
    expect(c.limits).toEqual([]);
  });

  // Genuinely ambiguous, and read the way it is written: the number follows
  // the word sodium, so it is a sodium limit.
  it("reads 'sodium under 800' as milligrams of sodium", () => {
    expect(criteria("low sodium under 800").limits).toEqual([{ nutrient: "sodium_mg", min: null, max: 800 }]);
  });

  it("still reads a real gram limit written nutrient-first", () => {
    expect(criteria("carbs under 30").limits).toEqual([{ nutrient: "carbs_g", min: null, max: 30 }]);
    expect(criteria("protein over 40g").limits).toEqual([{ nutrient: "protein_g", min: 40, max: null }]);
  });

  it.each([
    "low carb under 600 calories",
    "low fat under 500 cal",
    "high protein over 900 calories",
    "low sodium under 800 calories",
  ])("keeps both halves of: %s", (q) => {
    const c = criteria(q);
    expect(c.goals.length, q).toBe(1);
    expect(c.calories.min ?? c.calories.max, q).not.toBeNull();
    expect(c.limits, q).toEqual([]);
  });
});
