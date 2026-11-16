import type { MenuItem, Slot, ComponentOption, Menu } from "./db";
import type { Criteria, NutrientKey } from "./criteria";
import { shapeOf, type MealRole, type MealShape } from "./mealGrammar";
import { matchesTerm, searchable, type Searchable } from "./menuTerms";
import type { Notice } from "./notices";
import {
  LOW_DENSITY,
  NEGLIGIBLE,
  absoluteGoalFit,
  addTotals,
  calorieProximity,
  planCalories,
  rankedGoals,
  scorePool,
  weightsFor,
  type CaloriePlan,
  type Scored,
  type Totals,
  type Weights,
} from "./scoring";
import { selectResults, type Ranked } from "./selectResults";

// ── The engine ───────────────────────────────────────────────────────────────
//
// One entry point, recommend(menu, criteria), for both kinds of restaurant.
// It runs the same five steps either way:
//
//   1. ENUMERATE   every order a person could place
//                  fixed menu:      combinations of 1–4 items, filtered by the
//                                   meal grammar
//                  build-your-own:  every legal way to fill the core slots,
//                                   then condiments added to each
//   2. CONSTRAIN   drop what breaks a hard rule the user stated ("under 800",
//                  "under $8", "no fries"). If that drops everything, say so
//                  and keep the nearest misses instead.
//   3. SIZE        keep what lands in the calorie window; if nothing does,
//                  keep the nearest and say so.
//   4. SCORE       goal density, closeness to the meal size, price
//                  (lib/scoring.ts)
//   5. SELECT      a best match plus alternatives that are genuinely different
//                  (lib/selectResults.ts)
//
// The old engine was two separate optimisers that had grown different rules:
// each had its own calorie window; one returned five results and the other
// three; neither knew about price caps. Sharing steps 2–5 is what makes
// results consistent across restaurant types.

export type OrderShape = MealShape | "build";

/** One thing in an order. */
export interface OrderPick {
  id: number;
  name: string;
  /** Slot name on build-your-own restaurants; absent on fixed menus. */
  group?: string;
  /** Fixed menus only. */
  role?: MealRole;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number;
  price: number | null;
  price_estimated?: boolean;
}

export interface Candidate {
  picks: OrderPick[];
  totals: Totals;
  shape: OrderShape;
  /**
   * What makes two orders "the same idea": the mains on a fixed menu, the core
   * components on a build. Orders sharing a signature differ only by sides or
   * condiments and never both appear in one result set.
   */
  signature: string;
  /** Names of the mains (fixed menus), for limiting how often one recurs. */
  mains: string[];
  /** Ids of the components that define the order, for measuring overlap. */
  core: Set<number>;
  /** True when anything is ordered more than once. */
  repeats: boolean;
  /** How many double portions the order contains (builds only). */
  upsized: number;
}

export type ScoredCandidate = Candidate & Scored;

export interface Recommendation {
  results: Ranked[];
  notices: Notice[];
  plan: CaloriePlan;
}

interface Context {
  criteria: Criteria;
  plan: CaloriePlan;
  weights: Weights;
  hasPrices: boolean;
  /** Stemmed name + tags for every pickable thing, by id. */
  terms: Map<number, Searchable>;
}

const NUTRIENT_LABEL: Record<NutrientKey, string> = {
  calories: "calories",
  protein_g: "protein",
  fat_g: "fat",
  carbs_g: "carbs",
  sodium_mg: "sodium",
};

// ── Fixed menus ──────────────────────────────────────────────────────────────

/** A realistic order is at most three things… */
const MAX_ITEMS = 3;
/**
 * …unless it is built from light mains. "Three tacos and chips" is four items
 * and completely ordinary; "burger, fries, salad and a pie" is four items and
 * is not what anyone means by an order.
 */
const MAX_ITEMS_LIGHT = 4;
const LIGHT_MAIN_WEIGHT = 0.5;

/** Nothing above this is worth enumerating, whatever the query. */
const SANITY_CEILING = 2600;

const pickOf = (item: MenuItem): OrderPick => ({
  id: item.id,
  name: item.name,
  role: item.role,
  calories: item.calories,
  protein_g: item.protein_g,
  fat_g: item.fat_g,
  carbs_g: item.carbs_g,
  sodium_mg: item.sodium_mg,
  price: item.price,
  ...(item.price_estimated ? { price_estimated: true } : {}),
});

const totalsOf = (picks: OrderPick[]): Totals =>
  picks.reduce<Totals>((sum, p) => addTotals(sum, p), {
    calories: 0,
    protein_g: 0,
    fat_g: 0,
    carbs_g: 0,
    sodium_mg: 0,
    price: 0,
  });

/**
 * On a "low X" search, is one of the sides or desserts in this order the very
 * thing the user asked to avoid?
 *
 * This is what kept Cinnabon Delights in "low carb taco bell". Scoring alone
 * does not catch it — two tacos and a dessert has barely more carbs per
 * calorie than three tacos — but a person reading "low carb" would never add
 * the dessert. An accompaniment is fine if it carries a negligible amount of
 * the nutrient (a side salad's 7g of carbs), or if it is genuinely low in it
 * per calorie. Both tests use fixed thresholds; see scoring.LOW_DENSITY for
 * why they are not relative to the rest of the order.
 */
function concedesGoal(items: MenuItem[], criteria: Criteria): boolean {
  const lowGoals = criteria.goals.filter((g) => g.direction === "low");
  if (lowGoals.length === 0) return false;

  for (const item of items) {
    if (item.role === "main") continue;
    for (const goal of lowGoals) {
      if (item[goal.nutrient] <= NEGLIGIBLE[goal.nutrient]) continue;
      // "Low calorie" has no density to speak of: a side is either small or
      // it isn't.
      if (goal.nutrient === "calories") return true;
      const itemDensity = (item[goal.nutrient] / Math.max(item.calories, 1)) * 100;
      if (itemDensity > LOW_DENSITY[goal.nutrient]) return true;
    }
  }
  return false;
}

function mealCandidate(items: MenuItem[], ctx: Context): Candidate | null {
  let shape: MealShape | null = shapeOf(items);
  if (shape === null) return null;

  // The grammar calls an order a stack by weight alone. Two *different*
  // substantial mains — a hamburger and a box of nuggets — is a double-up too,
  // even where their weights fall just short. (Tacos are exempt: three kinds
  // of taco is one main's worth of food, not two mains.)
  if (shape !== "stack") {
    const substantial = new Set(
      items.filter((i) => i.role === "main" && i.portion_weight >= LIGHT_MAIN_WEIGHT).map((i) => i.id)
    );
    if (substantial.size >= 2) shape = "stack";
  }

  if (items.length > MAX_ITEMS) {
    const lightMains = items.filter(
      (i) => i.role === "main" && i.portion_weight < LIGHT_MAIN_WEIGHT
    ).length;
    if (lightMains < 2) return null;
  }

  // Two of the same sandwich is an order. Two bags of apple slices is the
  // optimiser padding calories with whatever is cheapest.
  let repeats = false;
  for (let i = 1; i < items.length; i++) {
    if (items[i].id === items[i - 1].id) {
      if (items[i].role !== "main") return null;
      repeats = true;
    }
  }

  if (concedesGoal(items, ctx.criteria)) return null;

  const picks = items.map(pickOf);
  const mainItems = items.filter((i) => i.role === "main");
  const mains = mainItems.map((i) => i.name).sort();

  return {
    picks,
    totals: totalsOf(picks),
    shape,
    signature: mains.join(" + "),
    mains,
    core: new Set(mainItems.map((i) => i.id)),
    repeats,
    upsized: 0,
  };
}

function enumerateMeals(items: MenuItem[], ctx: Context): Candidate[] {
  const out: Candidate[] = [];
  const combo: MenuItem[] = [];

  // Depth-first over combinations with repetition: each level may reuse the
  // item it is standing on (start = i), so [fries, burger] and [burger, fries]
  // are never both visited.
  const walk = (
    start: number,
    calories: number,
    sides: number,
    desserts: number,
    weight: number
  ) => {
    for (let i = start; i < items.length; i++) {
      const item = items[i];
      const nextCalories = calories + item.calories;
      const nextSides = sides + (item.role === "side" ? 1 : 0);
      const nextDesserts = desserts + (item.role === "dessert" ? 1 : 0);
      const nextWeight = weight + item.portion_weight;

      // Limits that only get worse as items are added, so the whole branch
      // can be skipped. (Incoherence in general can't be pruned this way: a
      // lone side is not an order, but a side plus a main is.)
      if (
        nextCalories > SANITY_CEILING ||
        nextSides > 2 ||
        nextDesserts > 1 ||
        nextWeight > 2.5
      ) {
        continue;
      }

      combo.push(item);
      const candidate = mealCandidate(combo, ctx);
      if (candidate) out.push(candidate);
      if (combo.length < MAX_ITEMS_LIGHT) {
        walk(i, nextCalories, nextSides, nextDesserts, nextWeight);
      }
      combo.pop();
    }
  };

  walk(0, 0, 0, 0, 0);
  return out;
}

// ── Build-your-own ───────────────────────────────────────────────────────────
//
// A build has a backbone and condiments. The backbone — required slots and
// pick-one slots: Chipotle's base, protein, rice and beans; Panda's plate,
// entrees and side — is searched exhaustively, every legal combination. The
// condiments — optional pick-many slots: toppings, salsa, an extra finger —
// are then added to each backbone greedily.
//
// Searching the condiments exhaustively too would be cleaner in principle and
// costs half a million builds at Chipotle alone. Greedy is right here because
// condiments are small, nearly independent, and judged the way a person adds
// them: one at a time, "does this make it better?"

/** Most picks a "pick many" backbone slot may take when nothing fixes its count. */
const MAX_MANY_PICK = 3;
/** Most condiments from any one slot. Every topping on the board is not an order. */
const MAX_CONDIMENT_PICKS = 3;

/**
 * What the first, second and third pick from a condiment slot are worth on
 * their own, before nutrition is considered. This is the "an order has salsa
 * on it" prior: small enough that a topping which hurts the goal is still
 * refused, large enough that an order is not left bare when nothing helps or
 * hurts.
 */
const CONDIMENT_BONUS = [0.035, 0.012, 0];

function* combinationsWithRepetition<T>(arr: T[], size: number, start = 0): Generator<T[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = start; i < arr.length; i++) {
    for (const rest of combinationsWithRepetition(arr, size - 1, i)) {
      yield [arr[i], ...rest];
    }
  }
}

/** Every way a single backbone slot could legitimately be filled. */
function slotChoices(slot: Slot): ComponentOption[][] {
  const { options, required, pick } = slot;
  if (options.length === 0) return [[]];

  if (pick === "1") {
    const choices = options.map((o) => [o]);
    if (!required) choices.push([]);
    return choices;
  }

  // Repetition allowed: two Texas Toasts, two Orange Chickens.
  const choices: ComponentOption[][] = required ? [] : [[]];
  for (let size = 1; size <= MAX_MANY_PICK; size++) {
    for (const combo of combinationsWithRepetition(options, size)) choices.push(combo);
  }
  return choices;
}

const optionPick = (option: ComponentOption, group: string): OrderPick => ({
  id: option.id,
  name: option.name,
  group,
  calories: option.calories,
  protein_g: option.protein_g,
  fat_g: option.fat_g,
  carbs_g: option.carbs_g,
  sodium_mg: option.sodium_mg,
  price: option.price,
  ...(option.price_estimated ? { price_estimated: true } : {}),
});

/** Adds condiments to one backbone, one at a time, while each one helps. */
function addCondiments(backbone: OrderPick[], condimentSlots: Slot[], ctx: Context): OrderPick[] {
  const { criteria, plan, weights } = ctx;
  if (condimentSlots.length === 0) return backbone;

  const picks = [...backbone];
  let totals = totalsOf(picks);
  const taken = new Map<string, number>();
  const chosen = new Set<number>();

  const maxLimits = criteria.limits.filter((l) => l.max !== null);
  const allowed = (next: Totals) =>
    next.calories <= (plan.hardMax ?? Infinity) &&
    next.calories <= plan.softMax &&
    (criteria.price_max === null ||
      next.price === null ||
      next.price <= criteria.price_max + 1e-9) &&
    maxLimits.every((l) => next[l.nutrient] <= l.max!);

  const add = (option: ComponentOption, slot: Slot) => {
    picks.push(optionPick(option, slot.slot_name));
    totals = addTotals(totals, option);
    chosen.add(option.id);
    taken.set(slot.slot_name, (taken.get(slot.slot_name) ?? 0) + 1);
  };

  // Anything asked for by name goes on first, if it fits — "add guac" is an
  // instruction, not a suggestion to be weighed.
  for (const term of criteria.include) {
    if (picks.some((p) => matchesTerm(ctx.terms.get(p.id)!, term))) continue;
    for (const slot of condimentSlots) {
      const option = slot.options.find((o) => matchesTerm(ctx.terms.get(o.id)!, term));
      if (option && !chosen.has(option.id) && allowed(addTotals(totals, option))) {
        add(option, slot);
        break;
      }
    }
  }

  for (;;) {
    let best: { option: ComponentOption; slot: Slot; utility: number } | null = null;
    const fitNow = absoluteGoalFit(totals, criteria.goals);
    const sizeNow = calorieProximity(totals.calories, plan);

    for (const slot of condimentSlots) {
      const count = taken.get(slot.slot_name) ?? 0;
      if (count >= MAX_CONDIMENT_PICKS) continue;

      for (const option of slot.options) {
        if (chosen.has(option.id)) continue;
        const next = addTotals(totals, option);
        if (!allowed(next)) continue;

        const cost = option.price ?? 0;
        const utility =
          weights.goal * (absoluteGoalFit(next, criteria.goals) - fitNow) +
          weights.calories * (calorieProximity(next.calories, plan) - sizeNow) +
          CONDIMENT_BONUS[count] -
          // Paid extras need to earn their place; more so when money matters.
          cost * (criteria.budget_priority ? 0.03 : 0.008);

        if (!best || utility > best.utility) best = { option, slot, utility };
      }
    }

    if (!best || best.utility <= 0) break;
    add(best.option, best.slot);
  }

  return picks;
}

/**
 * Drops options that are nutritionally the same as an earlier one in their
 * slot, unless the user asked for one by name.
 *
 * Chipotle's Bowl and Salad are both an empty container; black and pinto
 * beans differ by a few milligrams of sodium. To the engine these are one
 * choice listed twice, and treating them as two is how the old results came
 * back as "three different orders" that were the same bowl with the beans
 * swapped. Keeping only the first of each set means an alternative has to
 * differ in something that changes the meal.
 *
 * Saying "salad" or "pinto" still works: a named option is always kept.
 */
function withoutTwins(slot: Slot, ctx: Context): Slot {
  const named = (o: ComponentOption) =>
    ctx.criteria.include.some((term) => {
      const entry = ctx.terms.get(o.id)!;
      // The slot's own name ("rice") names every option in it, which would
      // defeat the point; only a match on the option's own words counts.
      return matchesTerm({ tokens: entry.tokens, tags: [] }, term);
    });
  const same = (a: ComponentOption, b: ComponentOption) =>
    Math.abs(a.calories - b.calories) <= 10 &&
    Math.abs(a.protein_g - b.protein_g) <= 1.5 &&
    Math.abs(a.fat_g - b.fat_g) <= 1.5 &&
    Math.abs(a.carbs_g - b.carbs_g) <= 2 &&
    (a.price ?? 0) === (b.price ?? 0) &&
    JSON.stringify(a.pick_counts ?? null) === JSON.stringify(b.pick_counts ?? null);

  const kept: ComponentOption[] = [];
  for (const option of slot.options) {
    const twin = kept.find((k) => same(k, option));
    if (!twin) kept.push(option);
    else if (named(option)) {
      // The named one replaces its twin rather than joining it.
      if (named(twin)) kept.push(option);
      else kept[kept.indexOf(twin)] = option;
    }
  }
  return kept.length === slot.options.length ? slot : { ...slot, options: kept };
}

function enumerateBuilds(allSlots: Slot[], ctx: Context): Candidate[] {
  if (allSlots.length === 0) return [];

  const slots = allSlots.map((slot) => withoutTwins(slot, ctx));
  const backboneSlots = slots.filter((s) => s.required || s.pick === "1");
  const condimentSlots = slots.filter((s) => !s.required && s.pick === "many");

  // Some slots are coupled: picking "Bowl" at Panda Express fixes the entree
  // slot to exactly one pick, "Plate" to two. The slots are enumerated
  // independently and the combinations that break the coupling are skipped.
  const countFrom = new Map<number, number>();
  backboneSlots.forEach((slot, i) => {
    if (!slot.count_from) return;
    const source = backboneSlots.findIndex((s) => s.slot_name === slot.count_from);
    if (source !== -1) countFrom.set(i, source);
  });

  // A slot's count has to be known before the slot is filled, so its source
  // must come first. Menus are written that way round (base before entree).
  for (const [dependent, source] of countFrom) {
    if (source > dependent) {
      throw new Error(
        `Slot "${backboneSlots[dependent].slot_name}" takes its count from a later slot`
      );
    }
  }

  // A "double" is an option that is exactly twice another in its slot —
  // Chicken (Double), White Rice (Double). Found from the numbers rather than
  // from the name, so it needs no flag in the data.
  const doubles = new Set<number>();
  for (const slot of slots) {
    for (const big of slot.options) {
      const isDouble = slot.options.some(
        (small) =>
          small.id !== big.id &&
          small.calories > 0 &&
          big.calories === small.calories * 2 &&
          Math.abs(big.protein_g - small.protein_g * 2) < 0.6
      );
      if (isDouble) doubles.add(big.id);
    }
  }

  const slotOrder = new Map(slots.map((s, i) => [s.slot_name, i]));
  const choiceLists = backboneSlots.map(slotChoices);
  const out: Candidate[] = [];
  const current: ComponentOption[][] = [];

  const visit = (depth: number, calories: number) => {
    if (depth === backboneSlots.length) {
      const backbone = backboneSlots.flatMap((slot, i) =>
        current[i].map((o) => optionPick(o, slot.slot_name))
      );
      const core = new Set(backbone.map((p) => p.id));
      const picks = addCondiments(backbone, condimentSlots, ctx);

      // Slots come back in menu order, so the order reads the way it is said
      // at the counter. (Array.sort is stable, so picks within a slot keep
      // the order they were chosen in.)
      picks.sort((a, b) => slotOrder.get(a.group!)! - slotOrder.get(b.group!)!);

      const ids = picks.map((p) => p.id);
      out.push({
        picks,
        totals: totalsOf(picks),
        shape: "build",
        signature: [...core].sort((a, b) => a - b).join(","),
        mains: [],
        core,
        repeats: new Set(ids).size !== ids.length,
        upsized: ids.filter((id) => doubles.has(id)).length,
      });
      return;
    }

    for (const choice of choiceLists[depth]) {
      // Coupling: does this slot's pick count match what its source demands?
      const source = countFrom.get(depth);
      if (source !== undefined) {
        const required = current[source][0]?.pick_counts?.[backboneSlots[depth].slot_name];
        if (required != null && choice.length !== required) continue;
      }
      const next = calories + choice.reduce((s, o) => s + o.calories, 0);
      if (next > SANITY_CEILING) continue;

      current[depth] = choice;
      visit(depth + 1, next);
    }
  };

  visit(0, 0);
  return out;
}

// ── Hard constraints ─────────────────────────────────────────────────────────

interface Constraint {
  notice: Notice["code"];
  /** 0 when satisfied; otherwise how far over, as a fraction of the bound. */
  overshoot: (c: Candidate) => number;
  /** Said to the user when no order at all satisfies this one constraint. */
  explain: (all: Candidate[], restaurant: string) => string;
}

const money = (n: number) => `$${n.toFixed(2)}`;

function constraintsFor(ctx: Context): Constraint[] {
  const { criteria, plan, hasPrices } = ctx;
  const out: Constraint[] = [];
  const minOf = (all: Candidate[], f: (c: Candidate) => number) =>
    all.reduce((m, c) => Math.min(m, f(c)), Infinity);
  const maxOf = (all: Candidate[], f: (c: Candidate) => number) =>
    all.reduce((m, c) => Math.max(m, f(c)), -Infinity);

  if (plan.hardMax !== null) {
    const max = plan.hardMax;
    out.push({
      notice: "calorie_max_unreachable",
      overshoot: (c) => Math.max(0, (c.totals.calories - max) / max),
      explain: (all, name) =>
        `Nothing at ${name} comes in under ${max} calories — the lightest order is ${minOf(all, (c) => c.totals.calories)}. Showing the closest.`,
    });
  }
  if (plan.hardMin !== null) {
    const min = plan.hardMin;
    out.push({
      notice: "calorie_min_unreachable",
      overshoot: (c) => Math.max(0, (min - c.totals.calories) / min),
      explain: (all, name) =>
        `No single order at ${name} reaches ${min} calories — the biggest is ${maxOf(all, (c) => c.totals.calories)}. Showing the closest.`,
    });
  }
  if (criteria.price_max !== null && hasPrices) {
    const cap = criteria.price_max;
    out.push({
      notice: "price_max_unreachable",
      overshoot: (c) => Math.max(0, ((c.totals.price ?? 0) - cap) / cap),
      explain: (all, name) =>
        `Nothing at ${name} is under ${money(cap)} — the cheapest order is about ${money(minOf(all, (c) => c.totals.price ?? 0))}. Showing the closest.`,
    });
  }
  for (const limit of criteria.limits) {
    const unit = limit.nutrient === "sodium_mg" ? "mg" : "g";
    const word = NUTRIENT_LABEL[limit.nutrient];
    if (limit.min !== null) {
      const min = limit.min;
      out.push({
        notice: "nutrient_limit_unreachable",
        overshoot: (c) => Math.max(0, (min - c.totals[limit.nutrient]) / Math.max(min, 1)),
        explain: (all, name) =>
          `No order at ${name} reaches ${min}${unit} of ${word} — the most is ${Math.round(maxOf(all, (c) => c.totals[limit.nutrient]))}${unit}. Showing the closest.`,
      });
    }
    if (limit.max !== null) {
      const max = limit.max;
      out.push({
        notice: "nutrient_limit_unreachable",
        overshoot: (c) => Math.max(0, (c.totals[limit.nutrient] - max) / Math.max(max, 1)),
        explain: (all, name) =>
          `No order at ${name} stays under ${max}${unit} of ${word} — the least is ${Math.round(minOf(all, (c) => c.totals[limit.nutrient]))}${unit}. Showing the closest.`,
      });
    }
  }
  for (const term of criteria.include) {
    out.push({
      notice: "include_unreachable",
      overshoot: (c) =>
        c.picks.some((p) => matchesTerm(ctx.terms.get(p.id)!, term)) ? 0 : 1,
      explain: (_all, name) =>
        `No order at ${name} can include “${term}” alongside everything else you asked for.`,
    });
  }

  return out;
}

// ── recommend() ──────────────────────────────────────────────────────────────

/** The parts of a Menu the engine reads. Sources and provenance are not its business. */
export interface MenuLike {
  restaurant: { name: string; type: Menu["restaurant"]["type"] };
  items: MenuItem[];
  slots: Slot[];
}

export interface RecommendOptions {
  /** Most results to return. */
  limit?: number;
}

export function recommend(
  menu: MenuLike,
  criteria: Criteria,
  options: RecommendOptions = {}
): Recommendation {
  const notices: Notice[] = [];
  const name = menu.restaurant.name;
  const fixed = menu.restaurant.type === "fixed";

  const everything: { price: number | null }[] = fixed
    ? menu.items
    : menu.slots.flatMap((s) => s.options);
  const hasPrices = everything.length > 0 && everything.every((x) => x.price !== null);

  // Price can only be judged where there are prices. Rather than pretend, the
  // price parts of the question are set aside and the user is told.
  let effective = criteria;
  if (!hasPrices && (criteria.price_max !== null || criteria.budget_priority)) {
    notices.push({
      code: "price_unavailable",
      message: `We don't have price data for ${name}, so price wasn't taken into account.`,
    });
    effective = { ...criteria, price_max: null, budget_priority: false };
  }

  const plan = planCalories(effective);
  const terms = new Map<number, Searchable>();
  const excluded = (id: number) =>
    effective.exclude.some((term) => matchesTerm(terms.get(id)!, term));

  const ctx: Context = {
    criteria: effective,
    plan,
    weights: weightsFor(effective, plan, hasPrices),
    hasPrices,
    terms,
  };

  // 1 ── Enumerate ───────────────────────────────────────────────────────────
  let all: Candidate[];

  if (fixed) {
    for (const item of menu.items) terms.set(item.id, searchable(item.name, item.category));

    // Daypart. Breakfast and the all-day menu are not on sale together, so a
    // search is for one or the other: all-day unless breakfast is asked for.
    let daypart = effective.daypart;
    if (
      daypart === "breakfast" &&
      !menu.items.some((i) => i.daypart === "breakfast" && i.role === "main")
    ) {
      notices.push({
        code: "no_breakfast",
        message: `We don't have any breakfast items on record for ${name}. Showing the all-day menu.`,
      });
      daypart = "all-day";
    }

    const eligible = menu.items.filter(
      (item) =>
        item.calories > 0 &&
        !excluded(item.id) &&
        (daypart === "breakfast"
          ? // Breakfast mains, plus sides and desserts from either menu.
            item.daypart === "breakfast" || item.role !== "main"
          : item.daypart === "all-day")
    );
    all = enumerateMeals(eligible, ctx);
  } else {
    for (const slot of menu.slots) {
      for (const option of slot.options) {
        terms.set(option.id, searchable(option.name, slot.slot_name));
      }
    }

    const slots = menu.slots.map((slot) => {
      const kept = slot.options.filter((o) => !excluded(o.id));
      // A required slot can't be emptied: "no chicken" at a chicken-finger
      // restaurant leaves nothing to order. Keep the slot as it was.
      return kept.length === 0 && slot.required ? slot : { ...slot, options: kept };
    });
    all = enumerateBuilds(slots, ctx);
  }

  if (all.length === 0) return { results: [], notices, plan };

  // 2 ── Constrain ───────────────────────────────────────────────────────────
  const constraints = constraintsFor(ctx);
  const violation = (c: Candidate) => constraints.reduce((sum, k) => sum + k.overshoot(c), 0);

  let pool = all.filter((c) => violation(c) === 0);
  let closest = false;

  if (pool.length === 0) {
    closest = true;

    // Which constraint is to blame? One that nothing satisfies even alone is a
    // fact about the menu and can be stated precisely. Otherwise they only
    // fail in combination.
    const impossible = constraints.filter((k) => all.every((c) => k.overshoot(c) > 0));
    if (impossible.length > 0) {
      for (const k of impossible) notices.push({ code: k.notice, message: k.explain(all, name) });
    } else {
      notices.push({
        code: "constraints_conflict",
        message: `No order at ${name} meets all of that at once. These come closest.`,
      });
    }

    const least = all.reduce((m, c) => Math.min(m, violation(c)), Infinity);
    pool = all.filter((c) => violation(c) <= least * 1.15 + 0.02);
  }

  // 3 ── Size ────────────────────────────────────────────────────────────────
  const outside = (c: Candidate) =>
    c.totals.calories < plan.softMin
      ? plan.softMin - c.totals.calories
      : c.totals.calories > plan.softMax
        ? c.totals.calories - plan.softMax
        : 0;

  const inWindow = pool.filter((c) => outside(c) === 0);
  if (inWindow.length > 0) {
    pool = inWindow;
  } else {
    const nearest = pool.reduce((m, c) => Math.min(m, outside(c)), Infinity);
    const nearestCalories = pool.find((c) => outside(c) === nearest)!.totals.calories;

    // Raising Cane's has no order under about 830 calories, so "around 600"
    // has no real answer. The nearest orders are still more useful than
    // nothing — as long as the user is told that is what they are.
    if (plan.explicitTarget && !closest) {
      notices.push({
        code: "calorie_target_unreachable",
        message: `Nothing at ${name} lands near ${plan.target} calories — the closest is ${nearestCalories}. Showing the nearest orders.`,
      });
    }
    pool = pool.filter((c) => outside(c) <= nearest + plan.target * 0.15);
  }

  // "Mix it up": prefer orders with nothing doubled, when any exist.
  if (effective.variety) {
    const varied = pool.filter((c) => !c.repeats);
    if (varied.length > 0) pool = varied;
  }

  // 4 ── Score ───────────────────────────────────────────────────────────────
  const scores = scorePool(
    pool.map((c) => c.totals),
    effective,
    plan,
    hasPrices
  );
  // Two small priors, applied on top of the score. Neither is nutrition; both
  // are about what an ordinary order looks like.
  //
  //   • With no goal stated and no budget, lean toward a main with a side —
  //     what most people picture when they name a restaurant and nothing else.
  //   • A double portion is a deliberate choice. It should win when the goal
  //     calls for it (double chicken on a high-protein search still does,
  //     easily) and not appear merely because doubling the beans is free.
  const plain = rankedGoals(effective.goals).length === 0 && !effective.budget_priority;
  const prior = (c: Candidate) =>
    (plain && c.shape === "classic" && c.picks.some((p) => p.role === "side") ? 0.12 : 0) +
    (plain && c.shape === "single" ? 0.03 : 0) -
    // …and, for the same reason, toward not ordering the same thing twice.
    (plain && c.repeats ? 0.05 : 0) -
    0.035 * c.upsized;

  const scored: ScoredCandidate[] = pool.map((c, i) => ({
    ...c,
    ...scores[i],
    merit: scores[i].merit + prior(c),
  }));

  // 5 ── Select ──────────────────────────────────────────────────────────────
  const results = selectResults(scored, {
    kind: fixed ? "meal" : "build",
    criteria: effective,
    plan,
    closest,
    limit: options.limit ?? 5,
  });

  return { results, notices, plan };
}
