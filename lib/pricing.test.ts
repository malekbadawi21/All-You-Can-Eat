import { describe, it, expect } from "vitest";
import { menuOf } from "./__fixtures__/seedMenus";
import type { Slot } from "./db";

type PricedSlot = Omit<Slot, "options"> & { options: (Slot["options"][number] & { price: number })[] };

// Every seeded restaurant has prices. Asserting that here, once, lets the
// tests below compare them as plain numbers.
function priced(slug: string): PricedSlot[] {
  const slots = menuOf(slug).slots;
  for (const slot of slots) {
    for (const o of slot.options) {
      if (o.price === null) throw new Error(`${slug}: ${o.name} has no price`);
    }
  }
  return slots as PricedSlot[];
}

const CHIPOTLE_SLOTS = priced("chipotle");
const PANDA_SLOTS = priced("panda-express");
const CANES_SLOTS = priced("raising-canes");

// These assert price *relationships*, not price *amounts*.
//
// Amounts go stale — fast food pricing moves, and varies by more than a dollar
// between markets — so a test pinning "$9.79" would fail for being out of date
// rather than for being wrong. The relationships are what the optimizer
// actually reasons about, and they hold regardless of the absolute numbers.
//
// They read the seed documents in db/seed/ directly, so a bad price edit there
// fails here.

const slot = (slots: PricedSlot[], name: string) =>
  slots.find((s) => s.slot_name === name)!;

const option = (slots: PricedSlot[], slotName: string, optionName: string) =>
  slot(slots, slotName).options.find((o) => o.name === optionName)!;

describe("Chipotle pricing", () => {
  // The defect that prompted the audit. Bowl and Salad are nutritionally
  // identical here (both 0/0/0 — they're containers), so any price difference
  // decides every tie between them. Salad was priced $1.00 below Bowl, which
  // meant Chipotle results were always salads and a Bowl was unrecommendable.
  it("prices every base the same, because they are the same order", () => {
    const prices = slot(CHIPOTLE_SLOTS, "base").options.map((o) => o.price);
    expect(new Set(prices).size, `base prices: ${prices.join(", ")}`).toBe(1);
  });

  // Steak, barbacoa and carnitas carry real upcharges. At $0.00 across the
  // board they read as free upgrades over chicken, which quietly corrupted
  // every "cheapest" query.
  it("charges more for premium proteins than for chicken", () => {
    const chicken = option(CHIPOTLE_SLOTS, "protein", "Chicken");
    for (const name of ["Steak", "Barbacoa", "Carnitas"]) {
      expect(
        option(CHIPOTLE_SLOTS, "protein", name).price,
        `${name} should cost more than Chicken`
      ).toBeGreaterThan(chicken.price);
    }
  });

  it("prices sofritas the same as chicken", () => {
    expect(option(CHIPOTLE_SLOTS, "protein", "Sofritas").price).toBe(
      option(CHIPOTLE_SLOTS, "protein", "Chicken").price
    );
  });

  it("charges more to double a protein than to have it once", () => {
    for (const name of ["Chicken", "Steak", "Barbacoa", "Carnitas", "Sofritas"]) {
      expect(
        option(CHIPOTLE_SLOTS, "protein", `${name} (Double)`).price,
        `${name} (Double) vs ${name}`
      ).toBeGreaterThan(option(CHIPOTLE_SLOTS, "protein", name).price);
    }
  });

  // Doubling a premium protein should cost more than doubling a cheap one —
  // the upcharge compounds rather than flattening out.
  it("keeps premium proteins premium when doubled", () => {
    expect(option(CHIPOTLE_SLOTS, "protein", "Steak (Double)").price).toBeGreaterThan(
      option(CHIPOTLE_SLOTS, "protein", "Chicken (Double)").price
    );
  });

  it("charges for guacamole and queso, and nothing else on the extras", () => {
    const paid = slot(CHIPOTLE_SLOTS, "toppings")
      .options.filter((o) => o.price > 0)
      .map((o) => o.name)
      .sort();
    expect(paid).toEqual(["Guacamole", "Queso Blanco"]);

    for (const slotName of ["rice", "beans", "salsa"]) {
      for (const o of slot(CHIPOTLE_SLOTS, slotName).options) {
        expect(o.price, `${o.name} should be free`).toBe(0);
      }
    }
  });
});

describe("Panda Express pricing", () => {
  it("charges more as the base carries more entrees", () => {
    const [bowl, plate, bigger] = slot(PANDA_SLOTS, "base").options;
    expect(plate.price).toBeGreaterThan(bowl.price);
    expect(bigger.price).toBeGreaterThan(plate.price);
  });

  it("charges a premium only for the premium entrees", () => {
    const paid = slot(PANDA_SLOTS, "entree")
      .options.filter((o) => o.price > 0)
      .map((o) => o.name)
      .sort();
    expect(paid).toEqual(["Black Pepper Sirloin Steak", "Honey Walnut Shrimp"]);
  });

  it("includes any side at no extra charge", () => {
    for (const o of slot(PANDA_SLOTS, "side").options) {
      expect(o.price, `${o.name}`).toBe(0);
    }
  });
});

describe("Raising Cane's pricing", () => {
  it("charges more as the combo carries more chicken", () => {
    const byFingers = ["3 Finger Combo", "Box Combo (4 Fingers)", "Caniac Combo (6 Fingers)"];
    for (let i = 1; i < byFingers.length; i++) {
      expect(
        option(CANES_SLOTS, "combo", byFingers[i]).price,
        `${byFingers[i]} vs ${byFingers[i - 1]}`
      ).toBeGreaterThan(option(CANES_SLOTS, "combo", byFingers[i - 1]).price);
    }
  });

  it("charges less for one extra finger than for a whole combo", () => {
    expect(option(CANES_SLOTS, "extra", "Extra Chicken Finger").price).toBeLessThan(
      option(CANES_SLOTS, "combo", "3 Finger Combo").price
    );
  });
});
