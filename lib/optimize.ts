import type { MenuItem, Slot, ComponentOption } from "./db";
import type { Goal, NutrientKey } from "./parseQuery";

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

// Yield every size-k combination of items from arr.
// For 38 items and size=3 this produces 8,436 combinations — fast enough for
// a synchronous API route.
function* combinations<T>(arr: T[], size: number): Generator<T[]> {
  if (size === 1) {
    for (const item of arr) yield [item];
    return;
  }
  for (let i = 0; i <= arr.length - size; i++) {
    for (const rest of combinations(arr.slice(i + 1), size - 1)) {
      yield [arr[i], ...rest];
    }
  }
}

// Same idea as combinations(), but allows picking the same item more than
// once — e.g. "2 Texas Toast" at Raising Cane's, or "2 Orange Chicken" at
// Panda Express. Used only for build-your-own component slots, where
// ordering two of the same side is a real thing you can do; fixed-menu meal
// combos (recommendMeal, via combinations() above) stay distinct-only since
// "2 different burgers" and "2 of the same burger" are different UX asks.
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

  const results: MealCombination[] = [];

  for (let size = 1; size <= Math.min(maxItems, eligible.length); size++) {
    for (const combo of combinations(eligible, size)) {
      const totalCal = combo.reduce((sum, i) => sum + i.calories, 0);

      // Reject meals that overshoot by more than 25% or undershoot by more than 50%
      if (totalCal > calorieTarget * 1.25) continue;
      if (totalCal < calorieTarget * 0.5) continue;

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
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ── Build-your-own recommendation (Chipotle) ─────────────────────────────────
//
// Instead of deciding each slot in isolation (which let an early slot like
// "protein" greedily spend the whole calorie budget before later slots like
// "rice" or "beans" ever got a say), we enumerate full candidate builds —
// one choice per slot, combined — and score each build as a whole. This is
// the same idea as recommendMeal()'s combinations() search above, just
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
  calorieBudget: number
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

  const eligible = options
    .map((option) => {
      const goalScore = scoreOption(option, goals, ranges);
      const priceScore = 1 - option.price / maxPrice;
      const combined = budgetPriority ? 0.4 * goalScore + 0.6 * priceScore : goalScore;
      return { ...option, score: combined, goalScore };
    })
    // Gate on goalScore even in budget mode — a free item that hurts your
    // goals is still bad, regardless of price.
    .filter((o) => o.goalScore > skipScore)
    .sort((a, b) => b.score - a.score);

  let caloriesUsed = 0;
  const selected: typeof eligible = [];
  for (const option of eligible) {
    if (caloriesUsed + option.calories > calorieBudget) continue;
    selected.push(option);
    caloriesUsed += option.calories;
  }

  return { selection: { slot_name, required, pick, selected }, caloriesUsed };
}

export function buildOrder(
  slots: Slot[],
  goals: Goal[],
  calorieTarget?: number,
  budgetPriority: boolean = false
): SlotSelection[] {
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

  const totals = builds.map(totalsFor);

  const goalScores = goalScoresFor(totals, goals);
  const pScores = priceScores(totals.map((t) => t.price));
  const calScores = calorieTarget
    ? totals.map((t) => Math.max(0, 1 - Math.abs(t.calories - calorieTarget) / calorieTarget))
    : null;

  // Same weighting scheme as recommendMeal(): calorie proximity only enters
  // the score when a target was actually given.
  const goalWeight  = calorieTarget ? (budgetPriority ? 0.45 : 0.60) : (budgetPriority ? 0.65 : 0.90);
  const calWeight   = calorieTarget ? (budgetPriority ? 0.20 : 0.30) : 0;
  const priceWeight = calorieTarget ? (budgetPriority ? 0.35 : 0.10) : (budgetPriority ? 0.35 : 0.10);

  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < builds.length; i++) {
    const score =
      goalWeight * goalScores[i] +
      calWeight * (calScores ? calScores[i] : 0) +
      priceWeight * pScores[i];
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const winningBuild = builds[bestIdx];
  const jointResult: SlotSelection[] = jointSlots.map((slot, i) => ({
    slot_name: slot.slot_name,
    required: slot.required,
    pick: slot.pick,
    selected: winningBuild[i].map((o) => ({ ...o, score: bestScore })),
  }));

  // With no calorie target, there's nothing to budget against — condiments
  // are included purely on goal fit, same as before. With a target, only
  // whatever's left after the core slots is available for toppings/salsa.
  let remainingBudget = calorieTarget
    ? Math.max(0, calorieTarget - totals[bestIdx].calories)
    : Infinity;

  const deferredResult: SlotSelection[] = [];
  for (const slot of deferredSlots) {
    const { selection, caloriesUsed } = decideOptionalManySlot(
      slot, goals, budgetPriority, remainingBudget
    );
    deferredResult.push(selection);
    remainingBudget -= caloriesUsed;
  }

  // Return slots in their original order so the UI's slot list stays stable.
  const bySlotName = new Map(
    [...jointResult, ...deferredResult].map((r) => [r.slot_name, r])
  );
  return slots.map((slot) => bySlotName.get(slot.slot_name)!);
}
