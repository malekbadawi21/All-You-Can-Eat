import { describe, it, expect } from "vitest";
import { buildOrder, type SlotSelection } from "./optimize";
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
