import { DEFAULT_MEAL_CALORIES, type Criteria, type Goal, type NutrientKey } from "./criteria";

// ── How an order is judged ───────────────────────────────────────────────────
//
// Everything about *ranking* lives here, shared by fixed menus and
// build-your-own restaurants so the two can never drift apart again.
//
// The one idea that changed from the old engine: goals are scored on
// **density** (grams per 100 calories), not on totals and not per item.
//
//   • Per-item averages (the old fixed-menu scoring) rewarded adding a small,
//     low-carb dessert to a low-carb order: the dessert's own number was low,
//     so the average went *up* while the order got worse. That is how Cinnabon
//     Delights ended up in "low carb taco bell".
//
//   • Totals (the old build-your-own scoring) rewarded size. Every ingredient
//     has some protein, so the highest-protein Chipotle order was simply the
//     biggest one: a 1,310 calorie burrito with double rice and double beans.
//
// "High protein" does not mean "eat more". It means: of what I eat, make a lot
// of it protein. Density says exactly that, and how *much* to eat is a
// separate question answered by the calorie plan below.

export interface Totals {
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number;
  /** Null when the restaurant has no price data. */
  price: number | null;
}

export const ZERO_TOTALS: Totals = {
  calories: 0,
  protein_g: 0,
  fat_g: 0,
  carbs_g: 0,
  sodium_mg: 0,
  price: 0,
};

export function addTotals(a: Totals, b: Omit<Totals, "price"> & { price: number | null }): Totals {
  return {
    calories: a.calories + b.calories,
    protein_g: a.protein_g + b.protein_g,
    fat_g: a.fat_g + b.fat_g,
    carbs_g: a.carbs_g + b.carbs_g,
    sodium_mg: a.sodium_mg + b.sodium_mg,
    price: a.price === null || b.price === null ? null : a.price + b.price,
  };
}

/** Grams (or mg) of a nutrient per 100 calories of the order. */
export function density(t: Totals, nutrient: Exclude<NutrientKey, "calories">): number {
  return (t[nutrient] / Math.max(t.calories, 1)) * 100;
}

/** The goals that are ranked on. Calorie goals shift the meal size instead. */
export const rankedGoals = (goals: Goal[]) =>
  goals.filter((g): g is Goal & { nutrient: Exclude<NutrientKey, "calories"> } => g.nutrient !== "calories");

// ── How much food ────────────────────────────────────────────────────────────
//
// Every search gets a calorie plan, stated or not. It has two layers:
//
//   hard   what the user *said* must hold ("under 800"). Never crossed. If
//          nothing can satisfy it, the user is told so.
//   soft   the size of meal to aim for, and a window around it. If nothing
//          lands in the window, the nearest orders are used instead.
//
// With no number given there is still a soft plan, because "high protein
// chipotle" means a meal, not a 2,000 calorie feast and not a cup of chicken.
// Without it, density alone would always pick the smallest, leanest thing on
// the board.

export interface CaloriePlan {
  hardMin: number | null;
  hardMax: number | null;
  softMin: number;
  softMax: number;
  target: number;
  /** True when the user gave a number, so missing it is worth telling them. */
  explicitTarget: boolean;
  /**
   * How much landing *below* the target costs, relative to landing above it.
   * 1 when the user named a size ("around 800"): 600 is as wrong as 1000.
   * Less when they only named a ceiling or asked for something light: "under
   * 500 calories" is not a request to eat 499 of them, so a 300 calorie order
   * is barely worse than a 450 one.
   */
  undershoot: number;
}

/** "Low calorie" with no number: a light meal rather than a starved one. */
const LIGHT_MEAL_CALORIES = 450;
/** "Bulking" with no number. */
const BIG_MEAL_CALORIES = 1000;

export function planCalories(criteria: Criteria): CaloriePlan {
  const { target, min, max } = criteria.calories;
  const calorieGoal = criteria.goals.find((g) => g.nutrient === "calories");

  // What size of meal to assume when the user didn't say.
  const assumed =
    calorieGoal?.direction === "low"
      ? LIGHT_MEAL_CALORIES
      : calorieGoal?.direction === "high"
        ? BIG_MEAL_CALORIES
        : DEFAULT_MEAL_CALORIES;

  if (target !== null) {
    return {
      hardMin: min,
      hardMax: max,
      // "Around 800" means roughly 700 to 900. The old window ran from half
      // the target to 125% of it, which let a 430 calorie order answer an 800
      // calorie question.
      softMin: target * 0.85,
      softMax: target * 1.15,
      target,
      explicitTarget: true,
      undershoot: 1,
    };
  }

  if (min !== null && max !== null) {
    return { hardMin: min, hardMax: max, softMin: min, softMax: max, target: (min + max) / 2, explicitTarget: false, undershoot: 1 };
  }

  if (max !== null) {
    // "Under 800" is a ceiling, not a wish to eat 800. Aim for an ordinary
    // meal if one fits, otherwise just inside the ceiling.
    const aim = Math.min(assumed, max * 0.9);
    return { hardMin: null, hardMax: max, softMin: aim * 0.5, softMax: max, target: aim, explicitTarget: false, undershoot: 0.6 };
  }

  if (min !== null) {
    const aim = Math.max(assumed, min * 1.1);
    return { hardMin: min, hardMax: null, softMin: min, softMax: aim * 1.5, target: aim, explicitTarget: false, undershoot: 1 };
  }

  return {
    hardMin: null,
    hardMax: null,
    softMin: assumed * 0.5,
    softMax: assumed * (calorieGoal?.direction === "low" ? 1.25 : 1.5),
    target: assumed,
    explicitTarget: false,
    undershoot: calorieGoal?.direction === "low" ? 0.4 : 1,
  };
}

/** 1 on the target, falling linearly away from it; see CaloriePlan.undershoot. */
export function calorieProximity(calories: number, plan: CaloriePlan): number {
  const off = (calories - plan.target) / plan.target;
  return Math.max(0, 1 - (off < 0 ? -off * plan.undershoot : off));
}

// ── Weights ──────────────────────────────────────────────────────────────────
//
// Three things are traded off: how well the order serves the stated goals, how
// close it lands to the meal size, and what it costs. Which matters most
// depends on what the user actually said:
//
//   • Named a goal            → the goal leads.
//   • Named a calorie number  → size counts for more, because they asked.
//   • Said "cheap"            → price moves from tiebreaker to a real factor.
//   • Said nothing            → size leads, so a bare "chipotle" returns
//                               ordinary-sized meals rather than whatever is
//                               cheapest. (With no goals the old engine's
//                               score collapsed to price alone.)

export interface Weights {
  goal: number;
  calories: number;
  price: number;
}

export function weightsFor(criteria: Criteria, plan: CaloriePlan, hasPrices: boolean): Weights {
  const hasGoals = rankedGoals(criteria.goals).length > 0;
  const statedSize =
    plan.explicitTarget || plan.hardMin !== null || plan.hardMax !== null;
  const budget = criteria.budget_priority;

  let w: Weights;
  if (hasGoals) {
    w = statedSize
      ? budget ? { goal: 0.33, calories: 0.25, price: 0.42 } : { goal: 0.56, calories: 0.32, price: 0.12 }
      : budget ? { goal: 0.35, calories: 0.2, price: 0.45 } : { goal: 0.6, calories: 0.28, price: 0.12 };
  } else {
    w = statedSize
      ? budget ? { goal: 0.15, calories: 0.35, price: 0.5 } : { goal: 0.15, calories: 0.6, price: 0.25 }
      : budget ? { goal: 0.15, calories: 0.32, price: 0.53 } : { goal: 0.15, calories: 0.6, price: 0.25 };
  }

  // No prices on record: price can't be judged, so its share goes to the goal.
  if (!hasPrices) w = { goal: w.goal + w.price, calories: w.calories, price: 0 };
  return w;
}

// ── Scoring a pool of candidates ─────────────────────────────────────────────

/**
 * The value at a given percentile of an unsorted list.
 *
 * Used instead of the raw minimum and maximum when normalising: one freak
 * candidate (two orders of grilled nuggets is 19g of protein per 100 calories)
 * would otherwise set the top of the scale by itself and squash every ordinary
 * order into the bottom third, where they become indistinguishable.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

function normaliser(values: number[]): (v: number) => number {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = percentile(sorted, 0.02);
  const hi = percentile(sorted, 0.98);
  const range = hi - lo;
  if (range <= 0) return () => 0.5;
  // Deliberately not clamped to [0, 1]: a candidate beyond the 98th percentile
  // should still outrank one sitting on it.
  return (v) => (v - lo) / range;
}

export interface Scored {
  /** 0–1-ish: how well the order serves the stated goals. */
  goalScore: number;
  calScore: number;
  priceScore: number;
  merit: number;
}

/**
 * With no goal stated there is still a mild preference, so that results are
 * not arbitrary: more protein per calorie. It is the closest thing fast food
 * has to a universally agreed "better", and at the low weight it gets it only
 * separates orders that are otherwise alike.
 */
const DEFAULT_GOAL: Goal & { nutrient: "protein_g" } = { nutrient: "protein_g", direction: "high" };

export function scorePool(
  pool: Totals[],
  criteria: Criteria,
  plan: CaloriePlan,
  hasPrices: boolean
): Scored[] {
  if (pool.length === 0) return [];

  const weights = weightsFor(criteria, plan, hasPrices);
  const stated = rankedGoals(criteria.goals);
  const goals = stated.length > 0 ? stated : [DEFAULT_GOAL];

  const goalNormalisers = goals.map((goal) => normaliser(pool.map((t) => density(t, goal.nutrient))));
  const priceNormaliser = hasPrices ? normaliser(pool.map((t) => t.price ?? 0)) : null;

  return pool.map((t) => {
    let goalScore = 0;
    goals.forEach((goal, i) => {
      const n = goalNormalisers[i](density(t, goal.nutrient));
      goalScore += goal.direction === "high" ? n : 1 - n;
    });
    goalScore /= goals.length;

    const calScore = calorieProximity(t.calories, plan);
    const priceScore = priceNormaliser ? 1 - priceNormaliser(t.price ?? 0) : 0.5;

    return {
      goalScore,
      calScore,
      priceScore,
      merit: weights.goal * goalScore + weights.calories * calScore + weights.price * priceScore,
    };
  });
}

// ── Absolute scale, for judging one order by itself ──────────────────────────
//
// scorePool() is relative: it says which orders in a pool are best. Two places
// need to judge an order on its own instead — deciding whether one more topping
// helps, and deciding whether an alternative is good enough to show at all —
// so they use fixed scales. The ends are roughly the natural range of fast
// food: pure lean chicken is about 20g of protein per 100 calories, pure sugar
// 25g of carbohydrate, pure fat 11g.

const NATURAL_RANGE: Record<Exclude<NutrientKey, "calories">, number> = {
  protein_g: 20,
  carbs_g: 20,
  fat_g: 9,
  sodium_mg: 450,
};

/** 0–1 fit of one order to the stated goals, on a fixed scale. 0.5 with no goals. */
export function absoluteGoalFit(t: Totals, goals: Goal[]): number {
  const ranked = rankedGoals(goals);
  if (ranked.length === 0) return 0.5;

  let total = 0;
  for (const goal of ranked) {
    const n = Math.min(1, density(t, goal.nutrient) / NATURAL_RANGE[goal.nutrient]);
    total += goal.direction === "high" ? n : 1 - n;
  }
  return total / ranked.length;
}

/**
 * Whether an alternative is close enough to the best order on each goal to be
 * worth showing next to it.
 *
 * This is the guard against "Most variety: 31g protein" sitting beside "Best
 * match: 114g". An alternative may be worse — that is what makes it an
 * alternative — but not so much worse that showing it contradicts the question.
 */
export function withinReachOf(candidate: Totals, best: Totals, goals: Goal[]): boolean {
  for (const goal of rankedGoals(goals)) {
    const mine = density(candidate, goal.nutrient);
    const theirs = density(best, goal.nutrient);
    // A little absolute slack, so that when the best order has almost none of
    // a nutrient (a keto bowl with 2g of carbs) "twice as much" isn't an
    // impossibly small allowance.
    const slack = NATURAL_RANGE[goal.nutrient] * 0.12;

    if (goal.direction === "high" && mine < theirs * 0.55 - 0.001) return false;
    if (goal.direction === "low" && mine > Math.max(theirs * 1.8, theirs + slack)) return false;
  }
  return true;
}

/**
 * On a "low X" search, how much of X a side or dessert may carry before adding
 * it is a concession rather than an accompaniment. A side salad's 7g of carbs
 * is nothing; Cinnabon Delights' 17g is the thing the user asked to avoid.
 */
export const NEGLIGIBLE: Record<NutrientKey, number> = {
  calories: 120,
  protein_g: 5,
  carbs_g: 12,
  fat_g: 5,
  sodium_mg: 200,
};

/**
 * …and, for an accompaniment carrying more than a negligible amount, how low
 * its density has to be to count as genuinely low in that nutrient rather than
 * merely lower than something worse. Fixed numbers on purpose: comparing a
 * side to the mains it sits beside lets a carb-heavy set of mains excuse a
 * dessert. Roughly a fifth of calories from the nutrient.
 */
export const LOW_DENSITY: Record<Exclude<NutrientKey, "calories">, number> = {
  protein_g: 5,
  carbs_g: 5,
  fat_g: 2.5,
  sodium_mg: 110,
};
