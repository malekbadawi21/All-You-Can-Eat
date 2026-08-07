import { describe, it, expect } from "vitest";
import { buildOrder, buildOrders, type SlotSelection } from "./optimize";
import type { Goal } from "./parseQuery";
import { CHIPOTLE_SLOTS, PANDA_SLOTS, CANES_SLOTS } from "./__fixtures__/slots";

const HIGH_PROTEIN: Goal[] = [{ nutrient: "protein_g", direction: "high" }];
const LOW_FAT: Goal[] = [{ nutrient: "fat_g", direction: "low" }];

const totalCalories = (order: SlotSelection[]) =>
  order.reduce(
    (sum, slot) => sum + slot.selected.reduce((s, o) => s + o.calories, 0),
    0
  );

const picksIn = (order: SlotSelection[], slotName: string) =>
  order.find((s) => s.slot_name === slotName)?.selected ?? [];

const describeOrder = (order: SlotSelection[]) =>
  order
    .filter((s) => s.selected.length > 0)
    .map((s) => `${s.slot_name}=${s.selected.map((o) => o.name).join("+")}`)
    .join(" | ");

// The same window recommendMeal() enforces for fixed menus. Build-your-own
// restaurants had no equivalent, which is what let a 600 calorie request come
// back with a 1970 calorie order.
const MAX_OVERSHOOT = 1.25;
const MAX_UNDERSHOOT = 0.5;

describe("buildOrder — calorie targets", () => {
  it("keeps a Raising Cane's order near the requested calories", () => {
    const target = 900;
    const order = buildOrder(CANES_SLOTS, HIGH_PROTEIN, target, false);
    const calories = totalCalories(order);

    expect(
      calories,
      `asked for ${target} cal, got ${calories}: ${describeOrder(order)}`
    ).toBeLessThanOrEqual(target * MAX_OVERSHOOT);
  });

  // Cane's cannot assemble a 600 calorie order at all: the smallest combo is
  // 550 and it forces two sides of at least 140 each, so ~830 is the floor.
  // The right answer is the closest thing that exists, not the 1970 calorie
  // Caniac Combo that maximising protein used to return once the calorie
  // penalty had saturated at zero.
  it("returns the closest achievable order when the target is impossible", () => {
    const target = 600;
    const order = buildOrder(CANES_SLOTS, HIGH_PROTEIN, target, false);
    const calories = totalCalories(order);

    expect(
      calories,
      `asked for ${target} cal (floor is ~830), got ${calories}: ${describeOrder(order)}`
    ).toBeLessThanOrEqual(1000);
  });

  it("keeps a Panda Express order near the requested calories", () => {
    const target = 800;
    const order = buildOrder(PANDA_SLOTS, HIGH_PROTEIN, target, false);
    const calories = totalCalories(order);

    expect(
      calories,
      `asked for ${target} cal, got ${calories}: ${describeOrder(order)}`
    ).toBeLessThanOrEqual(target * MAX_OVERSHOOT);
  });

  it("does not undershoot the requested calories either", () => {
    const target = 900;
    const order = buildOrder(CHIPOTLE_SLOTS, LOW_FAT, target, false);
    const calories = totalCalories(order);

    expect(
      calories,
      `asked for ${target} cal, got ${calories}: ${describeOrder(order)}`
    ).toBeGreaterThanOrEqual(target * MAX_UNDERSHOOT);
  });
});

describe("buildOrder — condiments", () => {
  // Salsa costs 15-30 calories. An order that spends its entire budget on core
  // slots and leaves none for salsa is not a Chipotle order anyone places.
  it("still includes salsa when a calorie target is given", () => {
    const order = buildOrder(CHIPOTLE_SLOTS, HIGH_PROTEIN, 800, false);

    expect(
      picksIn(order, "salsa").length,
      `no salsa in: ${describeOrder(order)}`
    ).toBeGreaterThan(0);
  });

  // With no calorie target the condiment budget was Infinity, so every option
  // that beat "add nothing" got added: five toppings and three salsas at once.
  it("does not pile on every topping and salsa when no target is given", () => {
    const order = buildOrder(CHIPOTLE_SLOTS, HIGH_PROTEIN, undefined, false);

    for (const slotName of ["toppings", "salsa"]) {
      const picks = picksIn(order, slotName);
      expect(
        picks.length,
        `${slotName} took ${picks.length} picks: ${describeOrder(order)}`
      ).toBeLessThanOrEqual(3);
    }
  });

  // Without a stated target the optimizer still shouldn't hand back a
  // 2000+ calorie monster; "high protein chipotle" means a meal, not a feast.
  it("keeps an untargeted order to a realistic meal size", () => {
    const order = buildOrder(CHIPOTLE_SLOTS, HIGH_PROTEIN, undefined, false);
    const calories = totalCalories(order);

    expect(
      calories,
      `untargeted order came to ${calories} cal: ${describeOrder(order)}`
    ).toBeLessThanOrEqual(1400);
  });
});

describe("buildOrders — three ways to answer the same query", () => {
  // How much of an order is made of different things: three Texas Toasts is
  // 1/3, toast + fries + slaw is 3/3.
  const varietyOf = (order: SlotSelection[]) => {
    const picks = order.flatMap((s) => s.selected);
    if (picks.length === 0) return 1;
    return new Set(picks.map((o) => o.id)).size / picks.length;
  };

  it("returns three distinct options for each build-your-own restaurant", () => {
    for (const [name, slots] of [
      ["Chipotle", CHIPOTLE_SLOTS],
      ["Panda Express", PANDA_SLOTS],
      ["Raising Cane's", CANES_SLOTS],
    ] as const) {
      const options = buildOrders(slots, HIGH_PROTEIN, 1200, false);

      expect(options.length, `${name} returned ${options.length} options`).toBe(3);
      expect(new Set(options.map((o) => o.label)).size, `${name} labels`).toBe(3);

      // Same query, genuinely different orders — not one build relabelled.
      const signatures = options.map((o) =>
        o.order
          .flatMap((s) => s.selected.map((x) => x.id))
          .sort((a, b) => a - b)
          .join(",")
      );
      expect(new Set(signatures).size, `${name} returned duplicate builds`).toBe(3);
    }
  });

  // Chipotle's slots are all pick-one, so no build can repeat a component and
  // every build scored a perfect intra-order variety. The three "different"
  // options came back as one order with the black beans swapped for pinto.
  // Options have to differ substantially, not cosmetically.
  it("does not pass off a one-component swap as a different option", () => {
    const options = buildOrders(CHIPOTLE_SLOTS, HIGH_PROTEIN, 800, false);

    for (let i = 0; i < options.length; i++) {
      for (let j = i + 1; j < options.length; j++) {
        const a = new Set(options[i].order.flatMap((s) => s.selected.map((o) => o.id)));
        const b = new Set(options[j].order.flatMap((s) => s.selected.map((o) => o.id)));
        const shared = [...a].filter((id) => b.has(id)).length;
        const differing = a.size + b.size - 2 * shared;

        expect(
          differing,
          `"${options[i].label}" and "${options[j].label}" differ by only ${differing} component(s):\n` +
            `  ${describeOrder(options[i].order)}\n  ${describeOrder(options[j].order)}`
        ).toBeGreaterThanOrEqual(2);
      }
    }
  });

  // Condiments added purely to reach a calorie target must not be the worst
  // possible choice for the stated goal. Ranking those additions by calories
  // alone put guacamole — the fattiest topping on the board — onto a low-fat
  // order, because it closed the gap fastest.
  it("does not reach a calorie target using the goal's worst ingredient", () => {
    const options = buildOrders(CHIPOTLE_SLOTS, LOW_FAT, 900, false);
    const toppings = CHIPOTLE_SLOTS.find((s) => s.slot_name === "toppings")!;
    const fattiest = Math.max(...toppings.options.map((o) => o.fat_g));

    for (const option of options) {
      for (const picked of picksIn(option.order, "toppings")) {
        expect(
          picked.fat_g,
          `"${option.label}" added ${picked.name} (${picked.fat_g}g fat) on a low-fat search: ${describeOrder(option.order)}`
        ).toBeLessThan(fattiest);
      }
    }
  });

  it("orders the strategies from most optimized to most varied", () => {
    const options = buildOrders(CANES_SLOTS, HIGH_PROTEIN, 1200, false);
    expect(options.map((o) => o.strategy)).toEqual([
      "optimized",
      "balanced",
      "variety",
    ]);
  });

  it("gives the variety option more distinct components than the optimized one", () => {
    const options = buildOrders(CANES_SLOTS, HIGH_PROTEIN, 1200, false);
    const optimized = options.find((o) => o.strategy === "optimized")!;
    const variety = options.find((o) => o.strategy === "variety")!;

    expect(
      varietyOf(variety.order),
      `variety=${describeOrder(variety.order)} vs optimized=${describeOrder(optimized.order)}`
    ).toBeGreaterThan(varietyOf(optimized.order));
  });

  // The whole point of keeping "optimized" separate: it is allowed to repeat a
  // component, because repeating is often what hits the goal hardest.
  it("lets the optimized option beat the variety option on the stated goal", () => {
    const options = buildOrders(CANES_SLOTS, HIGH_PROTEIN, 1200, false);
    const optimized = options.find((o) => o.strategy === "optimized")!;
    const variety = options.find((o) => o.strategy === "variety")!;

    expect(optimized.total_protein_g).toBeGreaterThanOrEqual(variety.total_protein_g);
  });

  // Every option is a real order, not just the first one.
  it("holds all three options to the calorie window", () => {
    const target = 1200;
    for (const options of [
      buildOrders(CHIPOTLE_SLOTS, HIGH_PROTEIN, target, false),
      buildOrders(PANDA_SLOTS, HIGH_PROTEIN, target, false),
      buildOrders(CANES_SLOTS, HIGH_PROTEIN, target, false),
    ]) {
      for (const option of options) {
        expect(
          option.total_calories,
          `${option.label}: ${describeOrder(option.order)}`
        ).toBeLessThanOrEqual(target * MAX_OVERSHOOT);
        expect(
          option.total_calories,
          `${option.label}: ${describeOrder(option.order)}`
        ).toBeGreaterThanOrEqual(target * MAX_UNDERSHOOT);
      }
    }
  });

  it("reports totals that match the order it returned", () => {
    // Guards against the totals being computed from the core build only, which
    // would silently omit condiment calories from what the user is shown.
    for (const option of buildOrders(CHIPOTLE_SLOTS, HIGH_PROTEIN, 1000, false)) {
      const actual = totalCalories(option.order);
      expect(option.total_calories, `${option.label}`).toBe(actual);
    }
  });
});

describe("buildOrder — coupled slots", () => {
  // Panda's base dictates how many entrees you get: Bowl 1, Plate 2, Bigger
  // Plate 3. Locking this in because it is the subtlest existing behaviour and
  // the easiest to break while changing how builds are selected.
  it("takes exactly as many entrees as the chosen base allows", () => {
    for (const target of [600, 800, 1000, 1200]) {
      const order = buildOrder(PANDA_SLOTS, HIGH_PROTEIN, target, false);
      const base = picksIn(order, "base")[0];
      const entrees = picksIn(order, "entree");
      if (!base) continue;

      expect(
        entrees.length,
        `${base.name} should take ${base.pick_counts?.entree} entrees, took ${entrees.length}`
      ).toBe(base.pick_counts?.entree);
    }
  });

  it("takes exactly as many sides as the chosen Cane's combo allows", () => {
    for (const target of [800, 1200, 1600]) {
      const order = buildOrder(CANES_SLOTS, HIGH_PROTEIN, target, false);
      const combo = picksIn(order, "combo")[0];
      const sides = picksIn(order, "side");
      if (!combo) continue;

      expect(
        sides.length,
        `${combo.name} should take ${combo.pick_counts?.side} sides, took ${sides.length}`
      ).toBe(combo.pick_counts?.side);
    }
  });
});
