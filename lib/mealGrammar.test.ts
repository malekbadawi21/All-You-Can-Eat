import { describe, it, expect } from "vitest";
import {
  profileFor,
  portionWeight,
  isCoherent,
  shapeOf,
  mainSignature,
} from "./mealGrammar";

// Terse item builder. The grammar reads role, daypart and portion weight off
// the item itself; here they are filled in from a category the same way the
// ingestion classifier would, so each test still reads as "a burger", "a taco".
const item = (category: string, name = category) => {
  const profile = profileFor(category);
  return {
    category,
    name,
    role: profile.role,
    daypart: profile.daypart,
    portion_weight: profile.weight,
  };
};

const BURGER = item("burger", "Big Mac");
const SANDWICH = item("sandwich", "Chicken Sandwich");
const NUGGETS = item("entree", "Nuggets (12 ct)");
const TACO = item("taco", "Crunchy Taco");
const FRIES = item("side", "Fries");
const FRUIT_CUP = item("side", "Fruit Cup");
const COOKIE = item("dessert", "Cookie");
const EGG_MUFFIN = item("breakfast", "Egg McMuffin");
const HASH_BROWNS = item("breakfast", "Hash Browns");

describe("profileFor", () => {
  it("maps known categories to role, daypart and weight", () => {
    expect(profileFor("burger")).toEqual({
      role: "main",
      daypart: "all-day",
      weight: 1.0,
    });
    expect(profileFor("side").role).toBe("side");
    expect(profileFor("breakfast").daypart).toBe("breakfast");
    expect(profileFor("taco").weight).toBeLessThan(profileFor("burger").weight);
  });

  it("is case insensitive", () => {
    expect(profileFor("BURGER")).toEqual(profileFor("burger"));
  });

  // Matters once menus are ingested from arbitrary restaurants: an unfamiliar
  // category must count fully against the portion ceiling rather than slipping
  // through as weightless.
  it("treats an unknown category as a full all-day main", () => {
    expect(profileFor("poutine")).toEqual({
      role: "main",
      daypart: "all-day",
      weight: 1.0,
    });
  });
});

describe("portionWeight", () => {
  it("sums the weights of the items", () => {
    expect(portionWeight([BURGER, FRIES])).toBeCloseTo(1.25);
    expect(portionWeight([TACO, TACO, TACO])).toBeCloseTo(1.05);
  });
});

describe("isCoherent", () => {
  it("requires at least one main", () => {
    // The document's "fifteen fruit cups" complaint: an order of nothing but
    // sides has no centrepiece and is not an order.
    expect(isCoherent([FRUIT_CUP])).toBe(false);
    expect(isCoherent([FRUIT_CUP, FRIES])).toBe(false);
    expect(isCoherent([COOKIE])).toBe(false);
    expect(isCoherent([])).toBe(false);
  });

  it("allows stacking two mains", () => {
    // Deliberately permitted: two sandwiches is a real order for a real
    // person, and a high-protein search should be able to offer it.
    expect(isCoherent([SANDWICH, SANDWICH])).toBe(true);
    expect(isCoherent([SANDWICH, NUGGETS])).toBe(true);
  });

  it("rejects piling on a third full main", () => {
    expect(isCoherent([BURGER, BURGER, BURGER])).toBe(false);

    // The document's "thirty grilled nuggets only" complaint. Three 12-count
    // nugget portions is 36 nuggets for about $21, and it is what actually came
    // back once repetition was allowed in the combination search.
    expect(isCoherent([NUGGETS, NUGGETS, NUGGETS])).toBe(false);
    expect(isCoherent([NUGGETS, NUGGETS])).toBe(true);
  });

  it("allows several tacos, because that is how tacos work", () => {
    expect(isCoherent([TACO, TACO, TACO])).toBe(true);
    expect(isCoherent([TACO, TACO, TACO, TACO])).toBe(true);
  });

  it("rejects a breakfast item beside an all-day main", () => {
    // Chick-fil-A stops serving breakfast around 10:30am, so this order cannot
    // be placed at any single moment.
    expect(isCoherent([EGG_MUFFIN, SANDWICH])).toBe(false);
    expect(isCoherent([EGG_MUFFIN, BURGER, FRIES])).toBe(false);
  });

  it("allows breakfast items together, and with sides", () => {
    expect(isCoherent([EGG_MUFFIN, HASH_BROWNS])).toBe(true);
    expect(isCoherent([EGG_MUFFIN, FRUIT_CUP])).toBe(true);
  });

  it("caps sides and desserts", () => {
    expect(isCoherent([BURGER, FRIES, FRUIT_CUP])).toBe(true);
    expect(isCoherent([BURGER, FRIES, FRUIT_CUP, item("side", "Mac")])).toBe(false);
    expect(isCoherent([BURGER, COOKIE])).toBe(true);
    expect(isCoherent([BURGER, COOKIE, item("dessert", "Pie")])).toBe(false);
  });
});

describe("shapeOf", () => {
  it("classifies a lone main as single", () => {
    expect(shapeOf([BURGER])).toBe("single");
  });

  it("classifies a main plus an accompaniment as classic", () => {
    expect(shapeOf([BURGER, FRIES])).toBe("classic");
    expect(shapeOf([BURGER, FRIES, COOKIE])).toBe("classic");
  });

  it("classifies more than one main's worth of food as a stack", () => {
    expect(shapeOf([SANDWICH, SANDWICH])).toBe("stack");
    expect(shapeOf([SANDWICH, NUGGETS])).toBe("stack");
  });

  it("calls a stack a stack even when it includes a side", () => {
    // Both descriptions fit; "stack" is the more informative one.
    expect(shapeOf([SANDWICH, SANDWICH, FRIES])).toBe("stack");
  });

  it("treats a few tacos as one main's worth, not a stack", () => {
    // 3 x 0.35 = 1.05, below the stack threshold — which is the intent: three
    // tacos is an ordinary order, not an unusually large one.
    expect(shapeOf([TACO, TACO, TACO])).toBe("single");
    expect(shapeOf([TACO, TACO, FRIES])).toBe("classic");
  });

  it("returns null for incoherent sets", () => {
    expect(shapeOf([FRUIT_CUP])).toBeNull();
    expect(shapeOf([EGG_MUFFIN, SANDWICH])).toBeNull();
  });
});

describe("mainSignature", () => {
  it("lists only the mains, sorted, ignoring sides", () => {
    expect(mainSignature([SANDWICH, FRIES])).toEqual(["Chicken Sandwich"]);
    expect(mainSignature([NUGGETS, SANDWICH, FRIES])).toEqual([
      "Chicken Sandwich",
      "Nuggets (12 ct)",
    ]);
  });

  it("gives orders that differ only by side the same signature", () => {
    // Which is the point: they are variations on one idea, and should not both
    // occupy a result slot.
    expect(mainSignature([BURGER, FRIES])).toEqual(mainSignature([BURGER, COOKIE]));
  });
});
