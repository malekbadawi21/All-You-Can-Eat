// ── Meal grammar ─────────────────────────────────────────────────────────────
//
// The optimizer in lib/optimize.ts scores meals on nutrition: it treats an
// order as a bag of five numbers and maximises against the user's goals. That
// works well for judging *how good* an order is and not at all for judging
// whether it's an order a human would actually place. Left to itself it
// produced things like "Egg White Grill + Icedream Cone + Grilled Chicken
// Sandwich" — a breakfast item, an ice cream cone and a lunch sandwich, which
// you physically cannot buy at the same time of day.
//
// This module supplies the missing concept: what *shape* an order has. It
// deals only in categories, deliberately knowing nothing about calories or
// goals, which keeps it small and independently testable.
//
// Two jobs:
//   1. isCoherent()  — reject orders that are impossible or that nobody places
//   2. shapeOf()     — classify the rest, so results can span several shapes
//                      instead of five variations on one idea
//
// WHERE THE FACTS LIVE: role, daypart and portion weight are stored on each
// item (real columns — see db/migrations/0001_init.ts). They used to be derived
// here from `category`, which mixes daypart ("breakfast"), role ("side") and
// form factor ("taco") in one word; that is how a 15-calorie "Side Salad" filed
// under `salad` came to count as a full main course. The grammar now reads the
// stored facts and judges nothing from the category at all.
//
// CATEGORY_PROFILES survives as the *classifier*: when a menu arrives without
// those fields (dynamic ingestion), classifyItem() proposes them from the
// category and the item's name, and the result is stored where a human can
// correct it.

export type MealRole = "main" | "side" | "dessert";
export type Daypart = "breakfast" | "all-day";

/** The shapes a real order can take. Every shape requires at least one main. */
export type MealShape = "single" | "classic" | "stack";

export interface CategoryProfile {
  role: MealRole;
  daypart: Daypart;
  /**
   * How much of "one person's main course" this item represents. Lets a single
   * ceiling express rules that would otherwise need per-restaurant special
   * cases: three tacos (0.35 each) is a normal order, three burgers (1.0 each)
   * is not.
   *
   * Weight is per-category rather than derived from calories on purpose — a
   * 590-calorie milkshake is not a main course, so calories are the wrong
   * signal for main-ness even though they look like a tidier one.
   */
  weight: number;
}

/**
 * Everything the grammar needs to know about an item. No nutrition, no name,
 * no category — an order's shape depends only on these three facts.
 */
export interface ShapedItem {
  role: MealRole;
  daypart: Daypart;
  /** See CategoryProfile.weight. */
  portion_weight: number;
}

const MAIN = (weight: number, daypart: Daypart = "all-day"): CategoryProfile => ({
  role: "main",
  daypart,
  weight,
});

const CATEGORY_PROFILES: Record<string, CategoryProfile> = {
  // Full-size mains — one is a meal's worth of food.
  burger: MAIN(1.0),
  sandwich: MAIN(1.0),
  wrap: MAIN(1.0),
  salad: MAIN(1.0),
  burrito: MAIN(1.0),
  bowl: MAIN(1.0),
  nachos: MAIN(1.0),
  quesadilla: MAIN(1.0),
  chalupa: MAIN(1.0),
  specialty: MAIN(1.0),

  // Nuggets and strips. Weighted as a full main after this was tried at 0.75 on
  // the reasoning that nuggets are a lighter, shareable main: three portions
  // then came to 2.25, slipped under the ceiling, and produced "12ct + 12ct +
  // 12ct" — thirty-six nuggets for twenty-one dollars. A 12-count nugget is a
  // main course, so it weighs like one.
  entree: MAIN(1.0),

  // Breakfast is the one daypart-restricted category. Weight matches `entree`
  // because a breakfast sandwich is a real main, just a smaller one.
  breakfast: MAIN(0.75, "breakfast"),

  // Tacos are the reason weight exists at all: nobody orders one taco, and
  // three is completely normal, so they can't be treated as full mains.
  taco: MAIN(0.35),

  side: { role: "side", daypart: "all-day", weight: 0.25 },
  dessert: { role: "dessert", daypart: "all-day", weight: 0.25 },
};

/**
 * Unknown categories are treated as full all-day mains. This is the
 * conservative choice: an unrecognised item counts fully against the portion
 * ceiling, so a menu we've never seen can't smuggle an absurd order through.
 * It matters more than it looks — once menus are ingested dynamically, novel
 * categories arriving from a new restaurant is the normal case, not the
 * exception.
 */
const DEFAULT_PROFILE: CategoryProfile = MAIN(1.0);

export function profileFor(category: string): CategoryProfile {
  return CATEGORY_PROFILES[category.toLowerCase()] ?? DEFAULT_PROFILE;
}

// ── Classifying an item nobody has classified yet ────────────────────────────
//
// Used when a menu is ingested without role/daypart/weight. Rules are checked
// top to bottom and the first match wins, so the specific ones sit above the
// general ones: "Side Salad" has to be caught as a side before the word
// "salad" files it under mains, which is the exact mistake the old
// category-only scheme made.
//
// This is a proposal, not a verdict. Whatever it returns is written to the
// database as plain columns, where a wrong guess is a one-row fix.

interface NameRule {
  pattern: RegExp;
  category: string;
  profile: CategoryProfile;
}

const SIDE: CategoryProfile = { role: "side", daypart: "all-day", weight: 0.25 };
const BREAKFAST_SIDE: CategoryProfile = { role: "side", daypart: "breakfast", weight: 0.25 };
const DESSERT: CategoryProfile = { role: "dessert", daypart: "all-day", weight: 0.25 };

const NAME_RULES: NameRule[] = [
  // Breakfast sides before anything else mentions potatoes.
  { pattern: /\bhash ?browns?\b|\bhash brown sticks\b/, category: "breakfast", profile: BREAKFAST_SIDE },

  // Sweet things. "Shake" before "cake" so "pancakes" is not a dessert.
  { pattern: /\b(milk)?shakes?\b|\bmcflurry\b|\bfrosty\b|\bsundaes?\b|\bcones?\b|\bice ?cream\b|\bcookies?\b|\bbrownies?\b|\bdonuts?\b|\bdoughnuts?\b|\bchurros?\b|\bcinnamon (roll|twists?|sticks?)\b|\bcinnabon\b|\b(apple|cherry|pecan|pumpkin) pie\b|\bturnover\b|\bcheesecake\b|\bfrozen custard\b/, category: "dessert", profile: DESSERT },

  // Breakfast mains.
  { pattern: /\bbreakfast\b|\bmcmuffin\b|\bmcgriddles?\b|\bbiscuit (sandwich|with)\b|\b(egg|sausage|bacon)[^,]* biscuit\b|\bhotcakes?\b|\bpancakes?\b|\bfrench toast\b|\bcroissan'?wich\b|\bomelet(te)?\b|\bscrambler?\b|\boatmeal\b|\byogurt parfait\b/, category: "breakfast", profile: MAIN(0.75, "breakfast") },

  // Sides.
  { pattern: /\bside salad\b|\bfries\b|\bfrench fr(y|ied)\b|\bonion rings\b|\btots\b|\bpotato wedges\b|\bmashed potato(es)?\b|\bcole ?slaw\b|\bapple slices\b|\bfruit cup\b|\bmac(aroni)? (&|and|n) cheese\b|\bbreadsticks?\b|\bgarlic bread\b|\btexas toast\b|\bbiscuit\b|\bcorn on the cob\b|\bgreen beans\b|\bbaked beans\b|\bchips\b|\bside of\b|\brice\b(?! bowl)/, category: "side", profile: SIDE },

  // Light mains — the things people order several of.
  { pattern: /\btacos?\b/, category: "taco", profile: MAIN(0.35) },
  { pattern: /\bsliders?\b|\bwings?\b|\bslice\b/, category: "entree", profile: MAIN(0.5) },

  // Full mains, named by form so results can group them.
  { pattern: /\bburgers?\b|\bwhopper\b|\bbig mac\b|\bquarter pounder\b|\bmcdouble\b/, category: "burger", profile: MAIN(1.0) },
  { pattern: /\bsandwich\b|\bsub\b|\bmelt\b|\bfilet\b|\bhot dog\b|\bgyro\b/, category: "sandwich", profile: MAIN(1.0) },
  { pattern: /\bwraps?\b/, category: "wrap", profile: MAIN(1.0) },
  { pattern: /\bburritos?\b/, category: "burrito", profile: MAIN(1.0) },
  { pattern: /\bquesadillas?\b/, category: "quesadilla", profile: MAIN(1.0) },
  { pattern: /\bnachos\b/, category: "nachos", profile: MAIN(1.0) },
  { pattern: /\bbowl\b/, category: "bowl", profile: MAIN(1.0) },
  { pattern: /\bsalad\b/, category: "salad", profile: MAIN(1.0) },
  { pattern: /\bnuggets?\b|\bstrips?\b|\btenders?\b|\bfingers?\b|\bpopcorn chicken\b|\bfried chicken\b|\bdrumstick\b|\bbreast\b|\bthigh\b/, category: "entree", profile: MAIN(1.0) },
  { pattern: /\bpizza\b/, category: "pizza", profile: MAIN(1.0) },
];

export interface Classification extends CategoryProfile {
  category: string;
}

/**
 * Proposes a category, role, daypart and portion weight for an item.
 *
 * A category the profile table already knows is trusted unless the name plainly
 * contradicts it (the Side Salad case); otherwise the name decides. Anything
 * unrecognised falls through to a full all-day main, for the reason given on
 * DEFAULT_PROFILE.
 */
export function classifyItem(name: string, category?: string): Classification {
  const lower = name.toLowerCase();
  const byName = NAME_RULES.find((rule) => rule.pattern.test(lower));
  const known = category ? CATEGORY_PROFILES[category.toLowerCase()] : undefined;

  if (known && category) {
    // A stated category wins on what *kind* of thing this is, but a name that
    // says "side" or "dessert" overrules a category that says "main".
    if (byName && byName.profile.role !== "main" && known.role === "main") {
      return { category: category.toLowerCase(), ...byName.profile, daypart: known.daypart === "breakfast" ? "breakfast" : byName.profile.daypart };
    }
    return { category: category.toLowerCase(), ...known };
  }

  if (byName) return { category: category?.toLowerCase() ?? byName.category, ...byName.profile };
  return { category: category?.toLowerCase() ?? "item", ...DEFAULT_PROFILE };
}

// ── Tunable limits ───────────────────────────────────────────────────────────

/**
 * Two full mains *plus a side* (2.25) is a real order; three burgers (3.0) is
 * not. The headroom above 2.0 is deliberate and was a correction: a first pass
 * set this to 2.2 on the reasoning that two mains is the limit, which quietly
 * outlawed "two sandwiches and a fries" — a stack normally arrives with a side.
 */
const MAX_PORTION_WEIGHT = 2.5;

/** Above this, an order is deliberately more than one main's worth of food. */
const STACK_THRESHOLD = 1.5;

const MAX_SIDES = 2;
const MAX_DESSERTS = 1;

// ── Derived facts about a set of items ───────────────────────────────────────

export function portionWeight(items: ShapedItem[]): number {
  return items.reduce((sum, item) => sum + item.portion_weight, 0);
}

function countByRole(items: ShapedItem[]): Record<MealRole, number> {
  const counts: Record<MealRole, number> = { main: 0, side: 0, dessert: 0 };
  for (const item of items) counts[item.role]++;
  return counts;
}

function mainWeight(items: ShapedItem[]): number {
  return items.reduce(
    (sum, item) => (item.role === "main" ? sum + item.portion_weight : sum),
    0
  );
}

// ── The two public questions ─────────────────────────────────────────────────

/**
 * Is this a set of items a person could actually walk in and order?
 *
 * The rules are kept few and individually defensible. Anything that's merely
 * *unpopular* rather than impossible is left alone — filtering that out is the
 * job of scoring and of shape selection, not of a hard rule. In particular,
 * stacking two mains is allowed: "two Chick-fil-A sandwiches" is a real order
 * for a real person, and banning it would be the algorithm imposing taste.
 */
export function isCoherent(items: ShapedItem[]): boolean {
  if (items.length === 0) return false;

  const counts = countByRole(items);

  // Every order needs something to be built around. This is also what makes
  // the "fifteen fruit cups" failure mode unrepresentable rather than merely
  // low-scoring.
  if (counts.main === 0) return false;

  if (counts.side > MAX_SIDES) return false;
  if (counts.dessert > MAX_DESSERTS) return false;

  if (portionWeight(items) > MAX_PORTION_WEIGHT) return false;

  // Daypart: a breakfast item cannot share an order with an all-day main,
  // because the two are not on sale at the same time. Breakfast alongside a
  // side or dessert is fine — a parfait with hash browns is a real order.
  const hasBreakfast = items.some((item) => item.daypart === "breakfast");
  if (hasBreakfast) {
    const hasAllDayMain = items.some(
      (item) => item.role === "main" && item.daypart === "all-day"
    );
    if (hasAllDayMain) return false;
  }

  return true;
}

/**
 * Which shape does this order take? Returns null for incoherent sets.
 *
 * Checked in this order because the categories overlap: "two sandwiches plus
 * fries" is a stack that happens to include a side, and calling it a stack is
 * the more useful description.
 */
export function shapeOf(items: ShapedItem[]): MealShape | null {
  if (!isCoherent(items)) return null;

  if (mainWeight(items) >= STACK_THRESHOLD) return "stack";

  const counts = countByRole(items);
  if (counts.side > 0 || counts.dessert > 0) return "classic";

  return "single";
}

/**
 * Shapes in the order results should try to cover them. "classic" leads
 * because a main-plus-side is what most people picture when they think of a
 * fast food order — and it was the shape the old optimizer never produced.
 */
export const MEAL_SHAPES: readonly MealShape[] = ["classic", "single", "stack"];

/**
 * Human-facing labels for each shape.
 *
 * Deliberately say nothing about *why* an order was picked. "stack" was briefly
 * labelled "Extra protein", which read as a lie on a low-fat search — the label
 * describes the order's shape, and the goal it serves is a separate matter.
 */
export const SHAPE_LABELS: Record<MealShape, string> = {
  classic: "Classic meal",
  single: "No sides",
  stack: "Double up",
};

/**
 * The main items in an order, used to tell results apart. Two orders sharing
 * every main are variations on one idea however much their sides differ, which
 * is what let a single strong item fill four of five result slots.
 */
export function mainSignature(items: (ShapedItem & { name: string })[]): string[] {
  return items
    .filter((item) => item.role === "main")
    .map((item) => item.name)
    .sort();
}
