import type { Daypart } from "./mealGrammar";

// ── What the user is asking for ──────────────────────────────────────────────
//
// A search used to be described by four loose values: a list of goals, one
// calorie number, a budget flag and an unused variety flag. That could not say
// "under 800 calories" (it was read as "around 800", and an 810 calorie order
// came back), and it could not say "under $8" at all.
//
// The fix is to keep three different kinds of statement apart, because the
// engine has to treat them differently:
//
//   constraint  "under 800 cal", "under $8", "at least 40g protein"
//               A line that must not be crossed. An order that crosses it is
//               not a worse answer, it is a wrong one.
//
//   target      "around 800 cal"
//               Somewhere to aim. Landing 40 calories off is fine; landing 400
//               off is not an answer to the question.
//
//   preference  "high protein", "cheap", "variety"
//               A direction to lean. Used to rank the orders that survive the
//               two kinds above.
//
// Criteria is also the *memory* of a conversation. Each new message is parsed
// into a CriteriaPatch and applied on top of what was already in force, which
// is how "make it cheaper" can mean something.

export type NutrientKey = "calories" | "protein_g" | "fat_g" | "carbs_g" | "sodium_mg";
export type Direction = "high" | "low";

export interface Goal {
  nutrient: NutrientKey;
  direction: Direction;
}

/** A hard bound on one nutrient other than calories, in that nutrient's unit. */
export interface NutrientLimit {
  nutrient: Exclude<NutrientKey, "calories">;
  min: number | null;
  max: number | null;
}

export interface CalorieCriteria {
  /** "around 800" — aim here. */
  target: number | null;
  /** "at least 600" — never go below. */
  min: number | null;
  /** "under 800" — never go above. */
  max: number | null;
}

export interface Criteria {
  goals: Goal[];
  calories: CalorieCriteria;
  /** "under $8" — a hard cap on the order's total price. */
  price_max: number | null;
  limits: NutrientLimit[];
  /** "cheap" — lean toward lower prices without capping them. */
  budget_priority: boolean;
  /** "mix it up" — prefer orders made of different things. */
  variety: boolean;
  /** Which menu is on sale. All-day unless the user asks for breakfast. */
  daypart: Daypart;
  /** Things the order must contain ("with nuggets"). */
  include: string[];
  /** Things the order must not contain ("no fries"). */
  exclude: string[];
}

export const EMPTY_CRITERIA: Criteria = {
  goals: [],
  calories: { target: null, min: null, max: null },
  price_max: null,
  limits: [],
  budget_priority: false,
  variety: false,
  daypart: "all-day",
  include: [],
  exclude: [],
};

export const emptyCriteria = (): Criteria => ({
  ...EMPTY_CRITERIA,
  goals: [],
  calories: { target: null, min: null, max: null },
  limits: [],
  include: [],
  exclude: [],
});

// ── One message's worth of change ────────────────────────────────────────────
//
// `undefined` means "this message didn't mention it", which is different from
// `null` ("this message cleared it"). That distinction is the whole reason a
// patch is its own type rather than a partial Criteria.

export interface CriteriaPatch {
  /** "start over" — discard everything before applying the rest. */
  reset: boolean;
  goals: Goal[];
  /** Nutrients whose goals and limits should be forgotten. */
  dropNutrients: NutrientKey[];
  calories?: CalorieCriteria | null;
  price_max?: number | null;
  limits: NutrientLimit[];
  budget_priority?: boolean;
  variety?: boolean;
  daypart?: Daypart;
  include: string[];
  exclude: string[];
  /** Terms to stop including or excluding. */
  dropTerms: string[];
  /** "lighter" / "bigger" — relative to whatever is already in force. */
  nudgeCalories?: "down" | "up";
}

export const emptyPatch = (): CriteriaPatch => ({
  reset: false,
  goals: [],
  dropNutrients: [],
  limits: [],
  include: [],
  exclude: [],
  dropTerms: [],
});

/** Whether a patch says anything at all. */
export function isEmptyPatch(p: CriteriaPatch): boolean {
  return (
    !p.reset &&
    p.goals.length === 0 &&
    p.dropNutrients.length === 0 &&
    p.calories === undefined &&
    p.price_max === undefined &&
    p.limits.length === 0 &&
    p.budget_priority === undefined &&
    p.variety === undefined &&
    p.daypart === undefined &&
    p.include.length === 0 &&
    p.exclude.length === 0 &&
    p.dropTerms.length === 0 &&
    p.nudgeCalories === undefined
  );
}

const round50 = (n: number) => Math.max(100, Math.round(n / 50) * 50);

/** The meal size assumed when nobody states one. See lib/scoring.ts. */
export const DEFAULT_MEAL_CALORIES = 700;

/**
 * What's in force after `patch` is said on top of `base`.
 *
 * The rule throughout: a new statement about something *replaces* the old
 * statement about the same thing, and leaves everything else alone. Saying
 * "under 600 calories" after "around 800" changes the calories and keeps the
 * high-protein goal you set two messages ago.
 */
export function applyPatch(base: Criteria, patch: CriteriaPatch): Criteria {
  const next: Criteria = patch.reset
    ? emptyCriteria()
    : {
        ...base,
        goals: [...base.goals],
        calories: { ...base.calories },
        limits: base.limits.map((l) => ({ ...l })),
        include: [...base.include],
        exclude: [...base.exclude],
      };

  for (const nutrient of patch.dropNutrients) {
    next.goals = next.goals.filter((g) => g.nutrient !== nutrient);
    next.limits = next.limits.filter((l) => l.nutrient !== nutrient);
    if (nutrient === "calories") next.calories = { target: null, min: null, max: null };
  }

  for (const goal of patch.goals) {
    // One goal per nutrient: "low carb" then "high carb" is a change of mind.
    next.goals = next.goals.filter((g) => g.nutrient !== goal.nutrient);
    next.goals.push(goal);
  }

  if (patch.calories !== undefined) {
    next.calories = patch.calories ?? { target: null, min: null, max: null };
  }

  if (patch.nudgeCalories && patch.calories === undefined) {
    const factor = patch.nudgeCalories === "down" ? 0.8 : 1.25;
    const { target, min, max } = next.calories;
    if (target !== null || min !== null || max !== null) {
      next.calories = {
        target: target === null ? null : round50(target * factor),
        min: min === null ? null : round50(min * factor),
        max: max === null ? null : round50(max * factor),
      };
    } else {
      // Nothing to be relative to, so be relative to an ordinary meal.
      next.calories = { target: round50(DEFAULT_MEAL_CALORIES * factor), min: null, max: null };
    }
  }

  if (patch.price_max !== undefined) next.price_max = patch.price_max;

  for (const limit of patch.limits) {
    next.limits = next.limits.filter((l) => l.nutrient !== limit.nutrient);
    if (limit.min !== null || limit.max !== null) next.limits.push(limit);
  }

  if (patch.budget_priority !== undefined) next.budget_priority = patch.budget_priority;
  if (patch.variety !== undefined) next.variety = patch.variety;
  if (patch.daypart !== undefined) next.daypart = patch.daypart;

  const dropped = new Set(patch.dropTerms);
  next.include = next.include.filter((t) => !dropped.has(t));
  next.exclude = next.exclude.filter((t) => !dropped.has(t));

  for (const term of patch.include) {
    // Asking for something you previously ruled out lifts the rule.
    next.exclude = next.exclude.filter((t) => t !== term);
    if (!next.include.includes(term)) next.include.push(term);
  }
  for (const term of patch.exclude) {
    next.include = next.include.filter((t) => t !== term);
    if (!next.exclude.includes(term)) next.exclude.push(term);
  }

  return next;
}

// ── Saying it back ───────────────────────────────────────────────────────────
//
// Criteria can be written as text and read back by the parser to the same
// Criteria. That round trip is tested, and three things rely on it:
//
//   • a link — /restaurant/chipotle?q=high+protein,+under+800+cal — restores
//     the exact search
//   • the conversation needs no server-side session: the client hands back the
//     canonical text and the server re-derives the state
//   • removing a chip is just a search for the text without that phrase

const NUTRIENT_WORD: Record<NutrientKey, string> = {
  calories: "calorie",
  protein_g: "protein",
  fat_g: "fat",
  carbs_g: "carb",
  sodium_mg: "sodium",
};

const NUTRIENT_UNIT: Record<NutrientLimit["nutrient"], string> = {
  protein_g: "g",
  fat_g: "g",
  carbs_g: "g",
  sodium_mg: "mg",
};

const LIMIT_WORD: Record<NutrientLimit["nutrient"], string> = {
  protein_g: "protein",
  fat_g: "fat",
  carbs_g: "carbs",
  sodium_mg: "sodium",
};

const money = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface CriteriaChip {
  /** Stable within a response; usable as a React key. */
  id: string;
  /** What the chip says: "High protein", "Under 800 cal". */
  label: string;
  /** The canonical text of everything *except* this chip. */
  without: string;
}

interface Part {
  id: string;
  /** Parser-readable. */
  text: string;
  /** Human-readable, where that differs. */
  label?: string;
  remove: (c: Criteria) => Criteria;
}

function parts(c: Criteria): Part[] {
  const out: Part[] = [];

  for (const goal of c.goals) {
    out.push({
      id: `goal:${goal.nutrient}`,
      text: `${goal.direction} ${NUTRIENT_WORD[goal.nutrient]}`,
      remove: (x) => ({ ...x, goals: x.goals.filter((g) => g.nutrient !== goal.nutrient) }),
    });
  }

  const { target, min, max } = c.calories;
  const calorieText =
    min !== null && max !== null
      ? `${min}-${max} cal`
      : max !== null
        ? `under ${max} cal`
        : min !== null
          ? `over ${min} cal`
          : target !== null
            ? `around ${target} cal`
            : null;
  if (calorieText) {
    out.push({
      id: "calories",
      text: calorieText,
      remove: (x) => ({ ...x, calories: { target: null, min: null, max: null } }),
    });
  }

  if (c.price_max !== null) {
    out.push({
      id: "price",
      text: `under ${money(c.price_max)}`,
      remove: (x) => ({ ...x, price_max: null }),
    });
  }

  for (const limit of c.limits) {
    const unit = NUTRIENT_UNIT[limit.nutrient];
    const word = LIMIT_WORD[limit.nutrient];
    const remove = (x: Criteria) => ({
      ...x,
      limits: x.limits.filter((l) => l.nutrient !== limit.nutrient),
    });
    if (limit.min !== null) {
      out.push({ id: `limit:${limit.nutrient}:min`, text: `at least ${limit.min}${unit} ${word}`, remove });
    }
    if (limit.max !== null) {
      out.push({ id: `limit:${limit.nutrient}:max`, text: `under ${limit.max}${unit} ${word}`, remove });
    }
  }

  if (c.daypart === "breakfast") {
    out.push({ id: "daypart", text: "breakfast", remove: (x) => ({ ...x, daypart: "all-day" }) });
  }
  for (const term of c.include) {
    out.push({
      id: `include:${term}`,
      text: `with ${term}`,
      remove: (x) => ({ ...x, include: x.include.filter((t) => t !== term) }),
    });
  }
  for (const term of c.exclude) {
    out.push({
      id: `exclude:${term}`,
      text: `no ${term}`,
      remove: (x) => ({ ...x, exclude: x.exclude.filter((t) => t !== term) }),
    });
  }
  if (c.budget_priority) {
    out.push({ id: "budget", text: "cheap", label: "Cheaper", remove: (x) => ({ ...x, budget_priority: false }) });
  }
  if (c.variety) {
    out.push({ id: "variety", text: "variety", label: "More variety", remove: (x) => ({ ...x, variety: false }) });
  }

  return out;
}

/** Parser-readable text for a Criteria. Empty string when nothing is asked. */
export function canonicalText(c: Criteria): string {
  return parts(c)
    .map((p) => p.text)
    .join(", ");
}

export function chipsFor(c: Criteria): CriteriaChip[] {
  return parts(c).map((part) => ({
    id: part.id,
    label: part.label ?? capitalize(part.text),
    without: canonicalText(part.remove(c)),
  }));
}

/** A sentence fragment for prose: "high protein, around 800 calories". */
export function describeCriteria(c: Criteria): string {
  return parts(c)
    .map((p) => (p.label ?? p.text).toLowerCase().replace(/\bcal\b/, "calories"))
    .join(", ");
}

/** True when the user asked for nothing in particular. */
export function isUnconstrained(c: Criteria): boolean {
  return parts(c).length === 0;
}
