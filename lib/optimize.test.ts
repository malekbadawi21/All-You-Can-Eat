import { describe, it, expect } from "vitest";
import {
  ALL,
  BUILD,
  FIXED,
  ask,
  density,
  describeAll,
  describeOrder,
  namesIn,
} from "./__fixtures__/ask";
import { menuOf } from "./__fixtures__/seedMenus";
import type { OrderResult } from "./searchResult";

// ── What the engine promises ─────────────────────────────────────────────────
//
// These are the behaviours the original test suites protected (optimize.test,
// buildOrder.test), restated against the rewritten engine. The functions they
// called are gone; the promises are not. Each still names the defect that
// motivated it.
//
// They run the whole path — parser, menu matching, engine, selection — against
// the real seed menus, and assert on the public response shape, so they keep
// holding however the inside is rearranged.

const picks = (r: OrderResult, group: string) => r.items.filter((i) => i.group === group);
const countIn = (r: OrderResult, group: string) =>
  picks(r, group).reduce((n, i) => n + i.quantity, 0);

describe("fixed menus — orders a person could place", () => {
  // The optimizer once had no concept of time of day, and returned "Egg White
  // Grill + Icedream Cone + Grilled Chicken Sandwich". Breakfast and lunch are
  // not on sale together.
  it("never combines a breakfast item with an all-day main", () => {
    for (const slug of FIXED) {
      const breakfast = new Set(
        menuOf(slug).items.filter((i) => i.daypart === "breakfast").map((i) => i.name)
      );
      const allDayMains = new Set(
        menuOf(slug).items.filter((i) => i.daypart === "all-day" && i.role === "main").map((i) => i.name)
      );

      for (const q of ["low fat around 800 calories", "high protein", "breakfast", "high protein breakfast"]) {
        for (const result of ask(slug, q).results) {
          const names = namesIn(result);
          const mixed = names.some((n) => breakfast.has(n)) && names.some((n) => allDayMains.has(n));
          expect(mixed, `${slug} "${q}": ${describeOrder(result)}`).toBe(false);
        }
      }
    }
  });

  it("serves breakfast when breakfast is asked for", () => {
    for (const slug of FIXED) {
      const response = ask(slug, "high protein breakfast");
      const breakfast = new Set(
        menuOf(slug).items.filter((i) => i.daypart === "breakfast").map((i) => i.name)
      );
      expect(response.criteria.daypart).toBe("breakfast");
      for (const result of response.results) {
        const mains = result.items.filter((i) => i.role === "main").map((i) => i.name);
        expect(mains.every((n) => breakfast.has(n)), `${slug}: ${describeOrder(result)}`).toBe(true);
      }
    }
  });

  // With a high-protein goal, sides score badly on their own, so every result
  // used to be mains stacked on mains. Stacking is a legitimate order; the bug
  // was that nothing else was offered.
  it("offers at least one order that includes a side or dessert", () => {
    const response = ask("chick-fil-a", "high protein around 800 calories");
    const withAccompaniment = response.results.filter((r) =>
      r.items.some((i) => i.role === "side" || i.role === "dessert")
    );
    expect(withAccompaniment.length, describeAll(response)).toBeGreaterThan(0);
  });

  it("spans more than one kind of order", () => {
    for (const slug of FIXED) {
      const response = ask(slug, "high protein around 800 calories");
      const shapes = new Set(response.results.map((r) => r.shape));
      expect(shapes.size, `${slug}:\n${describeAll(response)}`).toBeGreaterThanOrEqual(2);
    }
  });

  // The Double Quarter Pounder outclasses everything else at McDonald's on
  // protein, and used to appear in nearly every result.
  it("does not let a single item dominate the result set", () => {
    for (const slug of FIXED) {
      const response = ask(slug, "high protein around 800 calories");
      const appearances = new Map<string, number>();
      for (const result of response.results) {
        for (const name of new Set(namesIn(result).filter((n) => menuOf(slug).items.find((i) => i.name === n)?.role === "main"))) {
          appearances.set(name, (appearances.get(name) ?? 0) + 1);
        }
      }
      const [worst, count] = [...appearances.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
      expect(
        count,
        `"${worst}" is in ${count} of ${response.results.length}:\n${describeAll(response)}`
      ).toBeLessThanOrEqual(2);
    }
  });

  // Thirty-six nuggets for twenty-one dollars is what came back the last time
  // a nugget portion was weighted as less than a full main.
  it("never stacks three portions of nuggets", () => {
    for (const q of ["high protein", "high protein around 800 calories", "low carb", "keto around 900 calories"]) {
      for (const result of ask("chick-fil-a", q).results) {
        const nuggets = result.items
          .filter((i) => /Nuggets/.test(i.name))
          .reduce((n, i) => n + i.quantity, 0);
        expect(nuggets, `"${q}": ${describeOrder(result)}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("lets tacos be ordered three or four at a time", () => {
    const response = ask("taco-bell", "low carb");
    const tacos = Math.max(
      ...response.results.map((r) =>
        r.items.filter((i) => /Taco/.test(i.name)).reduce((n, i) => n + i.quantity, 0)
      )
    );
    expect(tacos, describeAll(response)).toBeGreaterThanOrEqual(3);
  });
});

describe("calorie targets", () => {
  it("lands every result near a stated target", () => {
    for (const slug of ALL) {
      for (const target of [800, 1000]) {
        const response = ask(slug, `high protein around ${target} calories`);
        // Where the target is reachable at all. (Cane's floor is about 830.)
        if (response.notices.some((n) => n.code === "calorie_target_unreachable")) continue;

        for (const result of response.results) {
          expect(result.total_calories, `${slug} ~${target}: ${describeOrder(result)}`).toBeLessThanOrEqual(target * 1.15);
          expect(result.total_calories, `${slug} ~${target}: ${describeOrder(result)}`).toBeGreaterThanOrEqual(target * 0.85);
        }
      }
    }
  });

  // "Around 600" at Raising Cane's once returned a 1,970 calorie Caniac Combo:
  // the calorie penalty had saturated, so overshooting by 1,400 scored the same
  // as overshooting by 600.
  it("returns the closest achievable order when the target is impossible", () => {
    const response = ask("raising-canes", "high protein around 600 calories");
    for (const result of response.results) {
      expect(result.total_calories, describeOrder(result)).toBeLessThanOrEqual(1000);
    }
  });

  it("holds a range at both ends", () => {
    for (const slug of ALL) {
      const response = ask(slug, "between 850 and 1100 calories");
      for (const result of response.results) {
        expect(result.total_calories, `${slug}: ${describeOrder(result)}`).toBeGreaterThanOrEqual(850);
        expect(result.total_calories, `${slug}: ${describeOrder(result)}`).toBeLessThanOrEqual(1100);
      }
    }
  });

  it("keeps an untargeted order to a realistic meal size", () => {
    for (const slug of ALL) {
      for (const q of ["", "high protein", "low carb", "low fat"]) {
        for (const result of ask(slug, q).results) {
          expect(result.total_calories, `${slug} "${q}": ${describeOrder(result)}`).toBeLessThanOrEqual(1100);
          expect(result.total_calories, `${slug} "${q}": ${describeOrder(result)}`).toBeGreaterThanOrEqual(340);
        }
      }
    }
  });

  it("goes bigger when asked to bulk and lighter when asked to cut", () => {
    const bulk = ask("mcdonalds", "bulking").results[0];
    const plain = ask("mcdonalds", "").results[0];
    const light = ask("mcdonalds", "low calorie").results[0];
    expect(bulk.total_calories).toBeGreaterThan(plain.total_calories);
    expect(light.total_calories).toBeLessThan(plain.total_calories);
  });
});

describe("hard limits", () => {
  it("holds a protein floor", () => {
    const response = ask("chick-fil-a", "at least 60g protein under 700 calories");
    expect(response.results.length).toBeGreaterThan(0);
    for (const result of response.results) {
      expect(result.total_protein_g, describeOrder(result)).toBeGreaterThanOrEqual(60);
      expect(result.total_calories, describeOrder(result)).toBeLessThanOrEqual(700);
    }
  });

  it("holds a carb ceiling", () => {
    for (const slug of ["chipotle", "chick-fil-a"]) {
      const response = ask(slug, "under 30g carbs");
      for (const result of response.results) {
        expect(result.total_carbs_g, `${slug}: ${describeOrder(result)}`).toBeLessThanOrEqual(30);
      }
    }
  });

  it("holds a price cap on a build, condiments included", () => {
    const response = ask("chipotle", "high protein under $11");
    for (const result of response.results) {
      expect(result.total_price, describeOrder(result)).toBeLessThanOrEqual(11);
    }
  });
});

describe("build-your-own — condiments", () => {
  // Salsa costs 15–30 calories. An order that spends its whole budget on the
  // core slots and leaves none for salsa is not a Chipotle order anyone places.
  it("still includes salsa when a calorie target is given", () => {
    const best = ask("chipotle", "high protein around 800 calories").results[0];
    expect(countIn(best, "salsa"), describeOrder(best)).toBeGreaterThan(0);
  });

  // With no target the condiment budget used to be unlimited: five toppings
  // and three salsas at once.
  it("does not pile on every topping and salsa", () => {
    for (const q of ["", "high protein", "high protein around 1000 calories", "keto around 900 calories"]) {
      for (const result of ask("chipotle", q).results) {
        for (const slot of ["toppings", "salsa"]) {
          expect(countIn(result, slot), `"${q}" ${slot}: ${describeOrder(result)}`).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  // Reaching a calorie target by adding guacamole — the fattiest topping on
  // the board — to a low-fat order closes the gap with the worst possible
  // ingredient.
  it("does not reach a calorie target using the goal's worst ingredient", () => {
    const toppings = menuOf("chipotle").slots.find((s) => s.slot_name === "toppings")!;
    const fattiest = Math.max(...toppings.options.map((o) => o.fat_g));

    for (const result of ask("chipotle", "low fat around 900 calories").results) {
      for (const pick of picks(result, "toppings")) {
        expect(pick.fat_g, `${pick.name}: ${describeOrder(result)}`).toBeLessThan(fattiest);
      }
    }
  });

  // On a keto search nothing "helps" — zero carbs beats every topping — so the
  // order once had no way to grow and "keto around 700" came back at 380.
  it("fills a keto bowl out to the calories asked for", () => {
    const best = ask("chipotle", "keto around 700 calories").results[0];
    expect(best.total_calories, describeOrder(best)).toBeGreaterThanOrEqual(595);
    expect(best.total_carbs_g, describeOrder(best)).toBeLessThanOrEqual(25);
  });

  it("puts a named extra on the order", () => {
    const response = ask("chipotle", "high protein with guac");
    for (const result of response.results) {
      expect(namesIn(result), describeOrder(result)).toContain("Guacamole");
    }
  });
});

describe("build-your-own — alternatives", () => {
  it("returns at least three distinct options for each restaurant", () => {
    for (const slug of BUILD) {
      const response = ask(slug, "high protein around 1200 calories");
      const signatures = response.results.map((r) => r.id);

      expect(response.results.length, `${slug}:\n${describeAll(response)}`).toBeGreaterThanOrEqual(3);
      expect(new Set(signatures).size, `${slug} returned a duplicate build`).toBe(signatures.length);
    }
  });

  // Chipotle's slots are all pick-one, so no build can repeat a component. The
  // three "different" options once came back as one order with the black beans
  // swapped for pinto.
  it("does not pass off a one-component swap as a different option", () => {
    for (const q of ["high protein around 800 calories", "", "low carb", "cheap"]) {
      const { results } = ask("chipotle", q);
      for (let i = 0; i < results.length; i++) {
        for (let j = i + 1; j < results.length; j++) {
          const a = new Set(namesIn(results[i]));
          const b = new Set(namesIn(results[j]));
          const shared = [...a].filter((n) => b.has(n)).length;
          const differing = a.size + b.size - 2 * shared;
          expect(
            differing,
            `"${q}":\n  ${describeOrder(results[i])}\n  ${describeOrder(results[j])}`
          ).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  // Bowl and Salad are both an empty container; black and pinto beans are the
  // same numbers. Two orders that differ only in those are one order.
  it("does not offer two orders that differ only in a nutritionally identical choice", () => {
    const { results } = ask("chipotle", "high protein");
    const containers = results.flatMap((r) => picks(r, "base").map((p) => p.name));
    expect(containers.includes("Bowl") && containers.includes("Salad"), containers.join(", ")).toBe(false);
  });

  it("still serves the identical twin when it is asked for by name", () => {
    for (const result of ask("chipotle", "high protein salad with pinto beans").results) {
      expect(namesIn(result), describeOrder(result)).toContain("Salad");
      expect(namesIn(result).some((n) => n.startsWith("Pinto Beans")), describeOrder(result)).toBe(true);
    }
  });

  // Repetition is often the smart play — three Texas Toasts carry the same
  // protein as three fries for 420 fewer calories — so the best match may
  // repeat. A varied alternative is offered beside it.
  it("offers a varied order when the best match doubles up", () => {
    const response = ask("raising-canes", "high protein around 1200 calories");
    const best = response.results[0];
    const varied = response.results.find((r) => r.label === "Most variety");
    const repeats = (r: OrderResult) => r.items.some((i) => i.quantity > 1);

    if (repeats(best)) {
      expect(varied, describeAll(response)).toBeDefined();
      expect(repeats(varied!), describeOrder(varied!)).toBe(false);
      expect(varied!.items.length).toBeGreaterThan(best.items.length);
    }
  });

  it("lets the best match beat the varied option on the stated goal", () => {
    for (const slug of BUILD) {
      const response = ask(slug, "high protein around 1200 calories");
      const best = response.results[0];
      for (const other of response.results.slice(1)) {
        expect(
          density(best, "total_protein_g"),
          `${slug}:\n${describeAll(response)}`
        ).toBeGreaterThanOrEqual(density(other, "total_protein_g") - 0.01);
      }
    }
  });

  it("gives an order with nothing doubled when variety is asked for", () => {
    for (const slug of ["panda-express", "raising-canes"]) {
      const best = ask(slug, "high protein variety").results[0];
      expect(best.items.every((i) => i.quantity === 1), `${slug}: ${describeOrder(best)}`).toBe(true);
    }
  });
});

describe("build-your-own — coupled slots", () => {
  // Panda's base dictates how many entrees you get: Bowl 1, Plate 2, Bigger
  // Plate 3. The subtlest behaviour in the engine and the easiest to break.
  it("takes exactly as many entrees as the chosen base allows", () => {
    const bases = menuOf("panda-express").slots.find((s) => s.slot_name === "base")!.options;

    for (const q of ["", "high protein", "around 600 calories", "around 1000 calories", "around 1300 calories", "cheap"]) {
      for (const result of ask("panda-express", q).results) {
        const base = bases.find((b) => b.name === picks(result, "base")[0].name)!;
        expect(countIn(result, "entree"), `"${q}": ${describeOrder(result)}`).toBe(base.pick_counts!.entree);
        expect(countIn(result, "side")).toBe(1);
      }
    }
  });

  it("takes exactly as many sides as the chosen Cane's combo allows", () => {
    const combos = menuOf("raising-canes").slots.find((s) => s.slot_name === "combo")!.options;

    for (const q of ["", "high protein", "around 900 calories", "around 1300 calories", "around 1700 calories"]) {
      for (const result of ask("raising-canes", q).results) {
        const combo = combos.find((c) => c.name === picks(result, "combo")[0].name)!;
        expect(countIn(result, "side"), `"${q}": ${describeOrder(result)}`).toBe(combo.pick_counts!.side);
      }
    }
  });
});

describe("every result", () => {
  // Totals are what the UI displays. If they disagree with the items listed
  // beside them, the user sees an order that doesn't add up.
  it("reports totals that match its items, quantities included", () => {
    for (const slug of ALL) {
      for (const q of ["", "high protein around 1000 calories", "low carb"]) {
        for (const result of ask(slug, q).results) {
          const sum = (f: (i: OrderResult["items"][number]) => number) =>
            result.items.reduce((s, i) => s + f(i) * i.quantity, 0);

          expect(result.total_calories, `${slug} ${result.label}`).toBe(sum((i) => i.calories));
          expect(result.total_protein_g).toBeCloseTo(sum((i) => i.protein_g), 1);
          expect(result.total_carbs_g).toBeCloseTo(sum((i) => i.carbs_g), 1);
          expect(result.total_fat_g).toBeCloseTo(sum((i) => i.fat_g), 1);
          expect(result.total_sodium_mg).toBe(sum((i) => i.sodium_mg));
          expect(result.total_price).toBeCloseTo(sum((i) => i.price!), 2);
        }
      }
    }
  });

  it("ranks on the goal: low-carb results are lower in carbs than plain ones", () => {
    for (const slug of ALL) {
      const lowCarb = ask(slug, "low carb").results[0];
      const plain = ask(slug, "").results[0];
      expect(
        density(lowCarb, "total_carbs_g"),
        `${slug}:\n  low carb: ${describeOrder(lowCarb)}\n  plain: ${describeOrder(plain)}`
      ).toBeLessThanOrEqual(density(plain, "total_carbs_g"));
    }
  });

  it("answers quickly enough to feel instant", () => {
    const started = performance.now();
    for (const slug of ALL) ask(slug, "high protein around 800 calories under $15");
    // Seven searches. Generous: this guards against an accidental return to
    // exhaustive enumeration, not against a slow CI machine.
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
