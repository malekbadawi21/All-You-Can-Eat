import type { MenuItem, Slot, ComponentOption } from "./db";
import type { Goal, NutrientKey } from "./parseQuery";
import {
  shapeOf,
  mainSignature,
  MEAL_SHAPES,
  SHAPE_LABELS,
  type MealShape,
} from "./mealGrammar";

// ── Shared scoring helpers ───────────────────────────────────────────────────

// Score a set of items against goals, normalizing each nutrient across the pool.
// Returns a 0–1 score per item where 1 = perfectly aligned with all goals.
function scoreItems(items: MenuItem[], goals: Goal[]): RankedItem[] {
  if (items.length === 0) return [];
  if (goals.length === 0) return items.map((item) => ({ ...item, score: 0.5 }));

  const ranges = new Map<NutrientKey, { min: number; max: number }>();
  for (const goal of goals) {
    const values = items.map((i) => i[goal.nutrient]);
    ranges.set(goal.nutrient, {
      min: Math.min(...values),
      max: Math.max(...values),
    });
  }

  return items.map((item) => {
    let total = 0;
    for (const goal of goals) {
      const { min, max } = ranges.get(goal.nutrient)!;
      const range = max - min;
      const normalized =
        range === 0 ? 0.5 : (item[goal.nutrient] - min) / range;
      total += goal.direction === "high" ? normalized : 1 - normalized;
    }
    return { ...item, score: total / goals.length };
  });
}

// ── Calorie window ───────────────────────────────────────────────────────────
//
// How far from a stated calorie target an order may land. Shared by both
// optimizers on purpose: fixed menus enforced this from the start, while
// build-your-own restaurants had only a soft scoring nudge, and that nudge
// clamps to zero once you are more than double the target — so overshooting by
// 1400 calories scored exactly the same as overshooting by 600, and "around 600
// calories" at Raising Cane's came back with a 1970 calorie order.

const MAX_OVERSHOOT = 1.25;
const MAX_UNDERSHOOT = 0.5;

function withinCalorieWindow(calories: number, target: number): boolean {
  return calories <= target * MAX_OVERSHOOT && calories >= target * MAX_UNDERSHOOT;
}

// A ceiling for orders where the user named no calorie target. Not a target —
// nothing is scored against it — purely a bound, so "high protein chipotle"
// can't answer with a 2,095 calorie burrito carrying five toppings and three
// salsas. Deliberately generous: it only has to exclude the absurd.
const MAX_UNTARGETED_CALORIES = 1400;

// Calories held back from the core slots so condiments have somewhere to live.
// Without this, the joint search over base/protein/rice/beans spends the entire
// budget — it is scored on calorie proximity, so landing exactly on target is
// what it is trying to do — and the toppings and salsa phase that runs
// afterwards inherits nothing. A Chipotle order with no salsa is not an order.
const CONDIMENT_RESERVE = 150;

// Most picks any one condiment slot may take. Every topping on the board is not
// an order anyone places.
const MAX_CONDIMENT_PICKS = 3;

// A tighter cap on picks added purely to close a calorie gap, rather than
// because they serve the goal. Two is enough to reach a target; three produced
// orders carrying three different salsas at once.
const MAX_FILLER_PICKS = 2;

// Normalize prices across a set of items so cheaper items score higher (0–1).
// Returns a parallel array of price scores.
function priceScores(prices: number[]): number[] {
  let min = Infinity, max = -Infinity;
  for (const p of prices) {
    if (p < min) min = p;
    if (p > max) max = p;
  }
  const range = max - min;
  return prices.map((p) => (range === 0 ? 0.5 : 1 - (p - min) / range));
}

// Yield every size-k selection of items from arr, allowing the same item to be
// picked more than once — "2 Texas Toast" at Raising Cane's, "2 Orange Chicken"
// at Panda Express, two of the same sandwich at Chick-fil-A. Used both for
// build-your-own component slots and for fixed-menu meal combinations.
//
// For a 38-item menu at size 3 that's 9,880 selections — fast enough for a
// synchronous API route, and the meal-grammar check in recommendMeal discards
// most of them before they're ever scored.
function* combinationsWithRepetition<T>(arr: T[], size: number): Generator<T[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    for (const rest of combinationsWithRepetition(arr.slice(i), size - 1)) {
      yield [arr[i], ...rest];
    }
  }
}

// ── Fixed restaurant ranking ─────────────────────────────────────────────────

export interface RankedItem extends MenuItem {
  score: number;
}

// Returns items sorted by score. With budgetPriority, price is 35% of the
// score; without it, price is a 10% tiebreaker so the cheapest good option
// wins when nutrition is close.
export function rankItems(
  items: MenuItem[],
  goals: Goal[],
  budgetPriority: boolean = false
): RankedItem[] {
  const scored = scoreItems(items, goals);
  const pScores = priceScores(items.map((i) => i.price));

  return scored
    .map((item, idx) => {
      const goalWeight = budgetPriority ? 0.65 : 0.90;
      const priceWeight = budgetPriority ? 0.35 : 0.10;
      return { ...item, score: goalWeight * item.score + priceWeight * pScores[idx] };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Meal combination recommendation ─────────────────────────────────────────
// When a calorie target is given, we find combinations of 1–3 items whose
// total calories land close to the target while maximising goal alignment.
//
// Without budget: 60% goal + 30% calorie proximity + 10% price tiebreaker
// With budget:    45% goal + 20% calorie proximity + 35% price

export interface MealCombination {
  items: RankedItem[];
  total_calories: number;
  total_protein_g: number;
  total_fat_g: number;
  total_carbs_g: number;
  total_sodium_mg: number;
  total_price: number;
  score: number;
  // What kind of order this is — see lib/mealGrammar.ts. Carried through to the
  // UI so results can be labelled, and used to make sure the returned set spans
  // several kinds of order rather than five takes on the same one.
  shape: MealShape;
  shape_label: string;
}

export function recommendMeal(
  items: MenuItem[],
  goals: Goal[],
  calorieTarget: number,
  maxItems: number = 3,
  budgetPriority: boolean = false
): MealCombination[] {
  const scored = scoreItems(items, goals);

  // Only consider items that could fit within the calorie budget.
  const eligible = scored.filter(
    (item) => item.calories > 0 && item.calories <= calorieTarget * 1.15
  );

  // Pre-compute price scores over the eligible set for combo scoring below.
  const eligiblePriceScores = priceScores(eligible.map((i) => i.price));
  const priceScoreMap = new Map(
    eligible.map((item, idx) => [item.id, eligiblePriceScores[idx]])
  );

  const goalWeight  = budgetPriority ? 0.45 : 0.60;
  const calWeight   = budgetPriority ? 0.20 : 0.30;
  const priceWeight = budgetPriority ? 0.35 : 0.10;

  if (eligible.length === 0) return [];

  const results: MealCombination[] = [];

  // Repetition allowed, so "two of the same sandwich" is reachable. It used to
  // be distinct-only, which meant a high-protein search could offer you two
  // *different* sandwiches but never two of the one you actually want. The
  // grammar check below is what keeps repetition from turning into nonsense
  // like three fruit cups.
  for (let size = 1; size <= maxItems; size++) {
    for (const combo of combinationsWithRepetition(eligible, size)) {
      const totalCal = combo.reduce((sum, i) => sum + i.calories, 0);

      if (!withinCalorieWindow(totalCal, calorieTarget)) continue;

      // Is this an order a person could actually place? Cheaper to ask now than
      // to score a combination we're going to throw away, so this both fixes
      // the output and shrinks the search.
      const shape = shapeOf(combo);
      if (shape === null) continue;

      const avgGoalScore =
        combo.reduce((s, i) => s + i.score, 0) / combo.length;
      const calProximity = Math.max(
        0,
        1 - Math.abs(totalCal - calorieTarget) / calorieTarget
      );
      // Average the price scores of the items in this combo.
      const avgPriceScore =
        combo.reduce((s, i) => s + (priceScoreMap.get(i.id) ?? 0.5), 0) /
        combo.length;

      const totalPrice = +combo.reduce((s, i) => s + i.price, 0).toFixed(2);

      results.push({
        items: combo,
        total_calories: totalCal,
        total_protein_g: +combo.reduce((s, i) => s + i.protein_g, 0).toFixed(1),
        total_fat_g: +combo.reduce((s, i) => s + i.fat_g, 0).toFixed(1),
        total_carbs_g: +combo.reduce((s, i) => s + i.carbs_g, 0).toFixed(1),
        total_sodium_mg: combo.reduce((s, i) => s + i.sodium_mg, 0),
        total_price: totalPrice,
        score: goalWeight * avgGoalScore + calWeight * calProximity + priceWeight * avgPriceScore,
        shape,
        shape_label: SHAPE_LABELS[shape],
      });
    }
  }

  return selectDiverseByShape(results, 5);
}

// How many results a single main item may appear in. At 1 the results get
// artificially thin — "Double Quarter Pounder on its own" and "Double Quarter
// Pounder with fries" are genuinely different orders and both worth offering.
// At 5 one strong item fills the whole list, which is the defect this exists to
// prevent. 2 keeps both.
const MAX_MAIN_APPEARANCES = 2;

// How many results may share a shape. Without this, guaranteeing one of each
// shape isn't enough: the fill pass runs on score alone, and for a high-protein
// search stacks outscore everything, so three of five results came back as
// "Double up" and the range collapsed again.
const MAX_PER_SHAPE = 2;

// Picking the final results is a separate problem from scoring them.
//
// Taking the top 5 by score alone gives five near-identical orders: whatever
// item best serves the goal appears in nearly all of them, and because sides
// rarely help a goal on their own, every result ends up being mains only. The
// user is shown one idea five times.
//
// So instead: guarantee the best of each *kind* of order first — a classic
// main-and-side, a single item, a protein stack — then fill any remaining slots
// by score. Nobody gets excluded for having unusual taste, and nobody has to
// scroll past four variations of the same sandwich to find a different idea.
function selectDiverseByShape(
  candidates: MealCombination[],
  limit: number
): MealCombination[] {
  const byScore = [...candidates].sort((a, b) => b.score - a.score);

  const chosen: MealCombination[] = [];
  const taken = new Set<MealCombination>();
  const mainAppearances = new Map<string, number>();
  const shapeCounts = new Map<MealShape, number>();

  const isAvailable = (combo: MealCombination) =>
    !taken.has(combo) &&
    (shapeCounts.get(combo.shape) ?? 0) < MAX_PER_SHAPE &&
    mainSignature(combo.items).every(
      (name) => (mainAppearances.get(name) ?? 0) < MAX_MAIN_APPEARANCES
    );

  const take = (combo: MealCombination) => {
    chosen.push(combo);
    taken.add(combo);
    shapeCounts.set(combo.shape, (shapeCounts.get(combo.shape) ?? 0) + 1);
    for (const name of mainSignature(combo.items)) {
      mainAppearances.set(name, (mainAppearances.get(name) ?? 0) + 1);
    }
  };

  // Pass 1 — one of each shape. `find` walks in score order, so this takes the
  // best still-available candidate of that shape.
  for (const shape of MEAL_SHAPES) {
    if (chosen.length >= limit) break;
    const pick = byScore.find((c) => c.shape === shape && isAvailable(c));
    if (pick) take(pick);
  }

  // Pass 2 — fill the rest on merit, still respecting the shape cap. This is
  // what covers a shape having no decent candidate: rather than returning a
  // short list, the slot goes to the next best order of another shape.
  for (const combo of byScore) {
    if (chosen.length >= limit) break;
    if (!isAvailable(combo)) continue;
    take(combo);
  }

  // Pass 3 — a short list is worse than a repetitive one. If some menu or
  // calorie target only admits one or two shapes, the cap above would hand back
  // two results; drop it and fill up on score, keeping only the rule that stops
  // one item owning the whole list.
  for (const combo of byScore) {
    if (chosen.length >= limit) break;
    if (taken.has(combo)) continue;
    const signature = mainSignature(combo.items);
    if (signature.some((name) => (mainAppearances.get(name) ?? 0) >= MAX_MAIN_APPEARANCES)) {
      continue;
    }
    take(combo);
  }

  return chosen.sort((a, b) => b.score - a.score);
}

// ── Build-your-own recommendation (Chipotle) ─────────────────────────────────
//
// Instead of deciding each slot in isolation (which let an early slot like
// "protein" greedily spend the whole calorie budget before later slots like
// "rice" or "beans" ever got a say), we enumerate full candidate builds —
// one choice per slot, combined — and score each build as a whole. This is
// the same idea as recommendMeal()'s combination search above, just
// extended across multiple slots instead of a single flat item list.

export interface SlotSelection {
  slot_name: string;
  required: boolean;
  pick: string;
  selected: (ComponentOption & { score: number })[];
}

// "pick many" slots could in principle have any subset selected (2^n
// possibilities), which would make total builds grow exponentially as
// options are added over time. Capping the subset size — exactly like
// recommendMeal()'s maxItems — keeps growth polynomial instead: nobody
// realistically loads up on 5+ toppings anyway.
const MAX_MANY_PICK = 3;

// Every way a single slot could legitimately be filled.
function slotChoices(slot: Slot): ComponentOption[][] {
  const { options, required, pick } = slot;
  if (options.length === 0) return [[]];

  if (pick === "1") {
    const choices = options.map((o) => [o]);
    if (!required) choices.push([]); // skipping is valid for optional slots
    return choices;
  }

  // pick === "many" — repetition allowed (2 Texas Toasts, 2 Orange Chicken,
  // etc.), so the size cap isn't bounded by options.length the way a
  // distinct-only subset would be.
  const choices: ComponentOption[][] = [[]];
  for (let size = 1; size <= MAX_MANY_PICK; size++) {
    for (const combo of combinationsWithRepetition(options, size)) choices.push(combo);
  }
  return required ? choices.filter((c) => c.length > 0) : choices;
}

function cartesianProduct(slotChoiceLists: ComponentOption[][][]): ComponentOption[][][] {
  return slotChoiceLists.reduce<ComponentOption[][][]>(
    (builds, choicesForSlot) =>
      builds.flatMap((build) => choicesForSlot.map((choice) => [...build, choice])),
    [[]]
  );
}

interface BuildTotals {
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number;
  price: number;
}

function totalsFor(build: ComponentOption[][]): BuildTotals {
  const items = build.flat();
  return {
    calories: items.reduce((s, i) => s + i.calories, 0),
    protein_g: items.reduce((s, i) => s + i.protein_g, 0),
    fat_g: items.reduce((s, i) => s + i.fat_g, 0),
    carbs_g: items.reduce((s, i) => s + i.carbs_g, 0),
    sodium_mg: items.reduce((s, i) => s + i.sodium_mg, 0),
    price: items.reduce((s, i) => s + i.price, 0),
  };
}

// Same normalize-across-the-pool approach as scoreItems(), but the "items"
// being compared are whole builds (their nutrient totals) rather than
// individual menu items.
function goalScoresFor(totals: BuildTotals[], goals: Goal[]): number[] {
  if (goals.length === 0) return totals.map(() => 0.5);

  // Loop-based min/max instead of Math.min(...values) — with hundreds of
  // thousands of candidate builds, spreading the array as call arguments
  // overflows V8's call stack.
  const ranges = new Map<NutrientKey, { min: number; max: number }>();
  for (const goal of goals) {
    let min = Infinity, max = -Infinity;
    for (const t of totals) {
      const v = t[goal.nutrient];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ranges.set(goal.nutrient, { min, max });
  }

  return totals.map((t) => {
    let total = 0;
    for (const goal of goals) {
      const { min, max } = ranges.get(goal.nutrient)!;
      const range = max - min;
      const normalized = range === 0 ? 0.5 : (t[goal.nutrient] - min) / range;
      total += goal.direction === "high" ? normalized : 1 - normalized;
    }
    return total / goals.length;
  });
}

// Score a single option (or the all-zero "skip" baseline) against goals,
// using ranges already computed over the relevant pool.
function scoreOption(
  option: Record<NutrientKey, number>,
  goals: Goal[],
  ranges: Map<NutrientKey, { min: number; max: number }>
): number {
  let total = 0;
  for (const goal of goals) {
    const { min, max } = ranges.get(goal.nutrient)!;
    const range = max - min;
    const normalized = range === 0 ? 0.5 : (option[goal.nutrient] - min) / range;
    total += goal.direction === "high" ? normalized : 1 - normalized;
  }
  return total / goals.length;
}

const ZERO_NUTRIENTS: Record<NutrientKey, number> = {
  calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0, sodium_mg: 0,
};

// Optional "pick many" slots (toppings, salsa, extra add-ons) are condiments,
// not the backbone of the meal, so they're decided independently of the
// joint search above rather than joining its combinatorial space. But they
// are NOT calorie-free in aggregate — e.g. Chipotle's five toppings plus
// three salsas add up to ~700 calories together, so simply including every
// item that "beats doing nothing" for a goal (which is nearly all of them,
// since almost anything has *some* protein) blew straight through whatever
// budget the joint search carefully respected.
//
// Fix: still gate on "does this beat skipping for my goals?", but then add
// qualifying items greedily — best goal fit first — only while they still
// fit inside whatever calorie budget is left after the core slots.
function decideOptionalManySlot(
  slot: Slot,
  goals: Goal[],
  budgetPriority: boolean,
  calorieBudget: number,
  caloriesNeeded: number = 0
): { selection: SlotSelection; caloriesUsed: number } {
  const { options, required, pick, slot_name } = slot;

  if (options.length === 0 || goals.length === 0) {
    return { selection: { slot_name, required, pick, selected: [] }, caloriesUsed: 0 };
  }

  const pool: Record<NutrientKey, number>[] = [...options, ZERO_NUTRIENTS];
  const ranges = new Map<NutrientKey, { min: number; max: number }>();
  for (const goal of goals) {
    const values = pool.map((o) => o[goal.nutrient]);
    ranges.set(goal.nutrient, { min: Math.min(...values), max: Math.max(...values) });
  }

  const skipScore = scoreOption(ZERO_NUTRIENTS, goals, ranges);
  const maxPrice = Math.max(...options.map((o) => o.price), 0.01);

  const ranked = options
    .map((option) => {
      const goalScore = scoreOption(option, goals, ranges);
      const priceScore = 1 - option.price / maxPrice;
      const combined = budgetPriority ? 0.4 * goalScore + 0.6 * priceScore : goalScore;
      return { ...option, score: combined, goalScore };
    })
    .sort((a, b) => b.score - a.score);

  // Items that actively serve the goal. Gate on goalScore even in budget mode —
  // a free item that hurts your goals is still bad, regardless of price.
  const helpful = ranked.filter((o) => o.goalScore > skipScore);

  // Everything else, best-first. These only get used to close a gap to a stated
  // calorie target, because on a "low X" goal *nothing* beats adding nothing —
  // zero carbs is minimal carbs — so `helpful` is empty and the order has no
  // way to grow. That answered "keto chipotle around 700 calories" with a
  // 380 calorie order. Guacamole and sour cream on a keto bowl is not the
  // optimizer being sloppy; it is what the order looks like.
  // Ranked on calories *weighted by* how tolerable each is for the goal.
  //
  // Neither factor works alone. Ranking by goal fit put romaine lettuce (5
  // calories) first and left a 300 calorie gap untouched. Ranking by calories
  // alone put guacamole — 230 calories and 22g of fat — on a *low fat* order,
  // closing the gap with the single worst thing on the board.
  //
  // The product prefers what is both calorie-dense and inoffensive: guacamole
  // on a keto bowl, where its carbs are near zero, and queso rather than
  // guacamole when fat is what you're avoiding.
  const fillers = ranked
    .filter((o) => o.goalScore <= skipScore)
    .sort((a, b) => b.calories * b.goalScore - a.calories * a.goalScore);

  let caloriesUsed = 0;
  const selected: typeof ranked = [];

  const consider = (pool: typeof ranked, onlyWhileShort: boolean) => {
    let takenHere = 0;
    for (const option of pool) {
      // Fillers get a tighter cap than the slot as a whole. Three *different*
      // salsas is not an order anyone places, and padding calories was exactly
      // how it started happening.
      if (onlyWhileShort && takenHere >= MAX_FILLER_PICKS) break;
      // A count cap as well as a calorie one. Calories alone let this run away
      // whenever the budget was generous: nearly every topping has *some*
      // protein, so nearly every topping beat skipping, and a high-protein
      // Chipotle order came back holding cheese, queso, sour cream, guacamole
      // and fajita veggies at once — plus all three salsas. Nobody orders that.
      if (selected.length >= MAX_CONDIMENT_PICKS) break;
      if (onlyWhileShort && caloriesUsed >= caloriesNeeded) break;
      if (caloriesUsed + option.calories > calorieBudget) continue;
      selected.push(option);
      caloriesUsed += option.calories;
      takenHere++;
    }
  };

  consider(helpful, false);
  consider(fillers, true);

  return { selection: { slot_name, required, pick, selected }, caloriesUsed };
}

// Narrow candidate builds to those with a defensible calorie total, before any
// goal scoring gets a say.
//
// This has to cope with targets a restaurant simply cannot hit. Raising Cane's
// has no order under about 830 calories — the smallest combo is 550 and it
// forces two sides — so "around 600 calories" has no valid answer. Returning
// nothing would be unhelpful and returning the highest-protein order on the
// menu (which is what used to happen: a 1970 calorie Caniac Combo) is worse. So
// when the window is empty, fall back to whatever comes closest, and let goal
// scoring choose among those.
function restrictToCalorieRange(
  builds: ComponentOption[][][],
  range: { min: number; max: number }
): ComponentOption[][][] {
  if (builds.length === 0) return builds;

  const caloriesOf = (build: ComponentOption[][]) =>
    build.flat().reduce((sum, o) => sum + o.calories, 0);

  const inRange = builds.filter((b) => {
    const calories = caloriesOf(b);
    return calories >= range.min && calories <= range.max;
  });
  if (inRange.length > 0) return inRange;

  // Nothing fits. Rank by how far outside the range each build sits and keep
  // the near-misses, so goal scoring still gets a choice among them.
  const distanceOutside = (b: ComponentOption[][]) => {
    const calories = caloriesOf(b);
    if (calories < range.min) return range.min - calories;
    if (calories > range.max) return calories - range.max;
    return 0;
  };
  const closest = Math.min(...builds.map(distanceOutside));
  return builds.filter((b) => distanceOutside(b) <= closest * 1.1 + 1);
}

// The calorie range the *core* slots must land in, given the user's target.
//
// The floor is the full target's floor, not a reduced one: condiments are
// allowed to contribute nothing at all (on a low-fat search, adding zero fat
// beats every topping, so none qualify), and if that happens the core slots are
// the entire order. Letting them sit at half of a reduced target produced a
// 440 calorie answer to a 900 calorie question.
//
// The ceiling leaves CONDIMENT_RESERVE of headroom, so that a core build at the
// top of its range plus a full complement of condiments still lands inside the
// window the user asked for.
// ── Build strategies ─────────────────────────────────────────────────────────
//
// A build-your-own restaurant has one *best* answer to a query and several
// *good* ones, and which is right depends on the person. Returning only the
// optimum hides that, so results cover three positions on one axis: how much
// repetition you'll accept in exchange for hitting your goal harder.
//
// Repetition is not a flaw — it is frequently the smart play. At Raising
// Cane's, three Texas Toasts and three Crinkle-Cut Fries carry the same protein
// but differ by 420 calories, so taking three toasts is what pays for the
// bigger box of chicken. "Box Combo + 3x Texas Toast" is 1120 cal / 60g;
// swapping to fries makes it 1540 cal for the identical 60g. The optimizer is
// right to repeat. It's just not right for *everyone*.

export type BuildStrategy = "optimized" | "balanced" | "variety";

export const BUILD_STRATEGIES: readonly BuildStrategy[] = [
  "optimized",
  "balanced",
  "variety",
];

// How heavily each strategy weighs variety against pure goal fit. "optimized"
// ignores variety entirely, which is what makes it the strongest answer to the
// question as literally asked.
const STRATEGY_VARIETY_WEIGHT: Record<BuildStrategy, number> = {
  optimized: 0,
  balanced: 0.45,
  variety: 0.8,
};

const STRATEGY_LABELS: Record<BuildStrategy, string> = {
  optimized: "Best match",
  balanced: "Balanced",
  variety: "Most variety",
};

export interface BuildOption {
  label: string;
  strategy: BuildStrategy;
  order: SlotSelection[];
  total_calories: number;
  total_protein_g: number;
  total_fat_g: number;
  total_carbs_g: number;
  total_sodium_mg: number;
  total_price: number;
  score: number;
}

/**
 * How much of this build is made of *different* things, from 0 to 1.
 *
 * Three Texas Toasts scores 1/3; toast plus fries plus slaw scores 3/3. Builds
 * with no repeatable slot at all score 1 — there was no opportunity to repeat,
 * so there's nothing to hold against them.
 */
function varietyScore(build: ComponentOption[][]): number {
  const picks = build.flat();
  if (picks.length === 0) return 1;
  const distinct = new Set(picks.map((o) => o.id)).size;
  return distinct / picks.length;
}

/**
 * How much two builds overlap, 0 to 1 (Jaccard: shared components over total
 * distinct components).
 *
 * Needed because varietyScore alone only measures repetition *within* one
 * order, and repetition is only possible in "pick many" slots. Chipotle has
 * none — base, protein, rice and beans are all pick-one — so every Chipotle
 * build scored a perfect 1.0 and the variety strategies had nothing to work
 * with. The three "different" options came back as the same order with the
 * black beans swapped for pinto.
 *
 * So options are also scored on being unlike the ones already chosen. That's
 * the axis Chipotle actually varies along: a different protein or a different
 * base, rather than a different bean.
 */
function buildSimilarity(a: Set<number>, b: Set<number>): number {
  let shared = 0;
  for (const id of a) if (b.has(id)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

// How hard to push later options away from earlier ones. High enough to reject
// a bean swap as a distinct option; low enough that a genuinely better build
// still wins on merit.
const DIVERSITY_WEIGHT = 0.4;

/** Nutrition and price totals for a finished order, condiments included. */
function totalsForOrder(order: SlotSelection[]): BuildTotals {
  const picks = order.flatMap((slot) => slot.selected);
  return {
    calories: picks.reduce((s, o) => s + o.calories, 0),
    protein_g: picks.reduce((s, o) => s + o.protein_g, 0),
    fat_g: picks.reduce((s, o) => s + o.fat_g, 0),
    carbs_g: picks.reduce((s, o) => s + o.carbs_g, 0),
    sodium_mg: picks.reduce((s, o) => s + o.sodium_mg, 0),
    price: picks.reduce((s, o) => s + o.price, 0),
  };
}

function coreCalorieRange(target: number | undefined): { min: number; max: number } {
  if (target === undefined) {
    return { min: 0, max: MAX_UNTARGETED_CALORIES - CONDIMENT_RESERVE };
  }
  return {
    min: target * MAX_UNDERSHOOT,
    max: Math.max(target * MAX_UNDERSHOOT, target * MAX_OVERSHOOT - CONDIMENT_RESERVE),
  };
}

export function buildOrders(
  slots: Slot[],
  goals: Goal[],
  calorieTarget?: number,
  budgetPriority: boolean = false
): BuildOption[] {
  if (slots.length === 0) return [];

  // Required slots are the backbone of the meal regardless of pick type
  // (Chipotle's protein, Panda's entrees, Cane's combo) — those go through
  // the full joint search. Optional "pick many" slots are condiments and
  // are decided separately below.
  const jointSlots = slots.filter((s) => s.required || s.pick === "1");
  const deferredSlots = slots.filter((s) => !s.required && s.pick === "many");

  let builds = cartesianProduct(jointSlots.map(slotChoices));

  // Some slots are coupled: picking "Bowl" at Panda Express fixes the entree
  // slot to exactly 1 pick, "Plate" to 2, etc; picking "Caniac Combo" at
  // Cane's fixes the side slot to exactly 3 picks. The slots are still
  // searched independently above (so this works for any restaurant without
  // special casing), but builds that violate the coupling — e.g. Bowl + 3
  // entrees — are invalid and get filtered out here before scoring.
  const countFromIndex = new Map<number, number>(); // jointSlots index -> count_from jointSlots index
  jointSlots.forEach((slot, i) => {
    if (!slot.count_from) return;
    const sourceIdx = jointSlots.findIndex((s) => s.slot_name === slot.count_from);
    if (sourceIdx !== -1) countFromIndex.set(i, sourceIdx);
  });

  if (countFromIndex.size > 0) {
    builds = builds.filter((build) =>
      [...countFromIndex.entries()].every(([slotIdx, sourceIdx]) => {
        const slotName = jointSlots[slotIdx].slot_name;
        const requiredCount = build[sourceIdx][0]?.pick_counts?.[slotName];
        if (requiredCount == null) return true;
        return build[slotIdx].length === requiredCount;
      })
    );
  }

  // Hold calories back from the core slots so the condiment phase below has
  // something to spend. The joint search is scored on landing *on* the target,
  // so without this it consumes the lot and salsa never makes it in.
  const coreTarget = calorieTarget
    ? Math.max(calorieTarget * 0.5, calorieTarget - CONDIMENT_RESERVE)
    : undefined;

  builds = restrictToCalorieRange(builds, coreCalorieRange(calorieTarget));

  const totals = builds.map(totalsFor);

  const goalScores = goalScoresFor(totals, goals);
  const pScores = priceScores(totals.map((t) => t.price));
  const calScores = coreTarget
    ? totals.map((t) => Math.max(0, 1 - Math.abs(t.calories - coreTarget) / coreTarget))
    : null;

  // Same weighting scheme as recommendMeal(): calorie proximity only enters
  // the score when a target was actually given.
  const goalWeight  = calorieTarget ? (budgetPriority ? 0.45 : 0.60) : (budgetPriority ? 0.65 : 0.90);
  const calWeight   = calorieTarget ? (budgetPriority ? 0.20 : 0.30) : 0;
  const priceWeight = calorieTarget ? (budgetPriority ? 0.35 : 0.10) : (budgetPriority ? 0.35 : 0.10);

  // Can happen if a restaurant's coupling rules admit nothing, and indexing
  // into an empty build list below would throw rather than degrade.
  if (builds.length === 0) return [];

  const meritScores = builds.map(
    (_, i) =>
      goalWeight * goalScores[i] +
      calWeight * (calScores ? calScores[i] : 0) +
      priceWeight * pScores[i]
  );
  const varietyScoresByIdx = builds.map(varietyScore);

  // Turn one candidate build into a finished order: the core slots as chosen,
  // plus whatever condiments fit in the calories it left behind.
  const finalize = (buildIdx: number, score: number): SlotSelection[] => {
    const build = builds[buildIdx];

    const jointResult: SlotSelection[] = jointSlots.map((slot, i) => ({
      slot_name: slot.slot_name,
      required: slot.required,
      pick: slot.pick,
      selected: build[i].map((o) => ({ ...o, score })),
    }));

    // What's left for toppings and salsa. With a target that's the full target
    // minus what the core slots actually used — and because the core slots
    // aimed at coreTarget rather than the full one, roughly CONDIMENT_RESERVE
    // survives to here by construction.
    //
    // With no target this used to be Infinity, which is how an untargeted
    // search ended up holding five toppings and three salsas: every option beat
    // adding nothing, and nothing ever ran out.
    let remainingBudget = calorieTarget
      ? Math.max(0, calorieTarget - totals[buildIdx].calories)
      : Math.max(
          0,
          Math.min(CONDIMENT_RESERVE, MAX_UNTARGETED_CALORIES - totals[buildIdx].calories)
        );

    // How far short of the stated target the core slots left us. Condiments may
    // close that gap even when they don't serve the goal; with no target stated
    // there is no gap to close and they're chosen on goal fit alone.
    let stillShort = calorieTarget
      ? Math.max(0, calorieTarget - totals[buildIdx].calories)
      : 0;

    const deferredResult: SlotSelection[] = [];
    for (const slot of deferredSlots) {
      const { selection, caloriesUsed } = decideOptionalManySlot(
        slot, goals, budgetPriority, remainingBudget, stillShort
      );
      deferredResult.push(selection);
      remainingBudget -= caloriesUsed;
      stillShort = Math.max(0, stillShort - caloriesUsed);
    }

    // Return slots in their original order so the UI's slot list stays stable.
    const bySlotName = new Map(
      [...jointResult, ...deferredResult].map((r) => [r.slot_name, r])
    );
    return slots.map((slot) => bySlotName.get(slot.slot_name)!);
  };

  // Component id sets, for measuring how unlike each other two builds are.
  const buildIds = builds.map((b) => new Set(b.flat().map((o) => o.id)));

  const chosen: BuildOption[] = [];
  const takenBuilds = new Set<number>();
  const chosenIds: Set<number>[] = [];

  for (const strategy of BUILD_STRATEGIES) {
    const varietyWeight = STRATEGY_VARIETY_WEIGHT[strategy];

    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < builds.length; i++) {
      if (takenBuilds.has(i)) continue;

      // Penalise looking like something already offered. The first option has
      // nothing to differ from, so it is chosen on merit alone — which is what
      // makes "Best match" genuinely the best answer rather than a compromise.
      let overlap = 0;
      for (const previous of chosenIds) {
        overlap = Math.max(overlap, buildSimilarity(buildIds[i], previous));
      }

      const score =
        (1 - varietyWeight) * meritScores[i] +
        varietyWeight * varietyScoresByIdx[i] -
        DIVERSITY_WEIGHT * overlap;

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    // Every distinct build is already spoken for — a small menu, or a tight
    // calorie window, can leave fewer than three candidates.
    if (bestIdx === -1) break;

    takenBuilds.add(bestIdx);
    chosenIds.push(buildIds[bestIdx]);
    const order = finalize(bestIdx, meritScores[bestIdx]);
    const orderTotals = totalsForOrder(order);

    chosen.push({
      label: STRATEGY_LABELS[strategy],
      strategy,
      order,
      total_calories: orderTotals.calories,
      total_protein_g: +orderTotals.protein_g.toFixed(1),
      total_fat_g: +orderTotals.fat_g.toFixed(1),
      total_carbs_g: +orderTotals.carbs_g.toFixed(1),
      total_sodium_mg: orderTotals.sodium_mg,
      total_price: +orderTotals.price.toFixed(2),
      score: meritScores[bestIdx],
    });
  }

  return chosen;
}

// Kept for callers that only want the single best build — the "optimized"
// strategy is by definition what the old single-winner search returned.
export function buildOrder(
  slots: Slot[],
  goals: Goal[],
  calorieTarget?: number,
  budgetPriority: boolean = false
): SlotSelection[] {
  return buildOrders(slots, goals, calorieTarget, budgetPriority)[0]?.order ?? [];
}
