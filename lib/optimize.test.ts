import { describe, it, expect } from "vitest";
import { recommendMeal, type MealCombination } from "./optimize";
import type { Goal } from "./parseQuery";
import { CHICK_FIL_A, MCDONALDS } from "./__fixtures__/menus";

// Categories that function as the centrepiece of an order. Defined locally for
// now because these tests deliberately assert against the `category` column
// that already exists in the schema — they describe the behaviour we want
// without assuming anything about how we'll implement it. This list moves into
// lib/mealGrammar.ts once that module exists.
const ALL_DAY_MAINS = ["sandwich", "wrap", "entree", "salad", "burger"];

const HIGH_PROTEIN: Goal[] = [{ nutrient: "protein_g", direction: "high" }];
const LOW_FAT: Goal[] = [{ nutrient: "fat_g", direction: "low" }];

const categoriesIn = (combo: MealCombination) => combo.items.map((i) => i.category);
const describeCombo = (c: MealCombination) =>
  `${c.total_calories}cal ${c.total_protein_g}g — ` +
  c.items.map((i) => `${i.name} [${i.category}]`).join(" + ");

describe("recommendMeal — meal coherence", () => {
  // DEFECT 1: the optimizer has no concept of time of day, so it happily
  // combines a breakfast item with a lunch main. Chick-fil-A stops serving
  // breakfast at ~10:30am, so these orders cannot physically be placed.
  it("never combines a breakfast item with an all-day main", () => {
    const results = recommendMeal(CHICK_FIL_A, LOW_FAT, 800, 3, false);

    const offenders = results.filter((combo) => {
      const cats = categoriesIn(combo);
      return (
        cats.includes("breakfast") && cats.some((c) => ALL_DAY_MAINS.includes(c))
      );
    });

    expect(
      offenders.map(describeCombo),
      "breakfast items must not appear alongside all-day mains"
    ).toEqual([]);
  });

  // DEFECT 2: with a "high protein" goal, sides score badly on their own, so
  // every returned combo ends up being mains stacked on mains. Stacking mains
  // is a legitimate order for some people — the bug is that it's the ONLY
  // thing offered, leaving no traditional main-plus-side option.
  it("offers at least one order that includes a side or dessert", () => {
    const results = recommendMeal(CHICK_FIL_A, HIGH_PROTEIN, 800, 3, false);

    const withAccompaniment = results.filter((combo) =>
      categoriesIn(combo).some((c) => c === "side" || c === "dessert")
    );

    expect(
      withAccompaniment.length,
      `no result included a side or dessert. Results were:\n${results.map(describeCombo).join("\n")}`
    ).toBeGreaterThan(0);
  });

  // The point of the whole exercise: the result set should read as a range of
  // real orders, not one idea restated. A high-protein search is the hard case,
  // because stacking mains outscores everything else.
  it("spans more than one kind of order", () => {
    const results = recommendMeal(CHICK_FIL_A, HIGH_PROTEIN, 800, 3, false);
    const shapes = new Set(results.map((r) => r.shape));

    expect(
      shapes.size,
      `every result was the same shape:\n${results.map(describeCombo).join("\n")}`
    ).toBeGreaterThanOrEqual(2);
  });

  it("does not let one shape take over the result set", () => {
    const results = recommendMeal(CHICK_FIL_A, HIGH_PROTEIN, 800, 3, false);

    const perShape = new Map<string, number>();
    for (const r of results) perShape.set(r.shape, (perShape.get(r.shape) ?? 0) + 1);

    for (const [shape, count] of perShape) {
      expect(
        count,
        `"${shape}" filled ${count} of ${results.length} results:\n${results.map(describeCombo).join("\n")}`
      ).toBeLessThanOrEqual(2);
    }
  });

  // DEFECT 3: the top results are near-duplicates of each other — the same
  // strong item reappears in most of them, so five "options" present one idea
  // five times.
  it("does not let a single item dominate the result set", () => {
    // McDonald's rather than Chick-fil-A: the Double Quarter Pounder outclasses
    // everything else on protein, which is what makes the top results collapse
    // into near-duplicates of each other.
    const results = recommendMeal(MCDONALDS, HIGH_PROTEIN, 800, 3, false);

    const appearances = new Map<string, number>();
    for (const combo of results) {
      for (const item of combo.items) {
        appearances.set(item.name, (appearances.get(item.name) ?? 0) + 1);
      }
    }

    const [worstItem, worstCount] = [...appearances.entries()].sort(
      (a, b) => b[1] - a[1]
    )[0] ?? ["<none>", 0];

    expect(
      worstCount,
      `"${worstItem}" appeared in ${worstCount} of ${results.length} results:\n${results.map(describeCombo).join("\n")}`
    ).toBeLessThanOrEqual(Math.ceil(results.length / 2));
  });
});
