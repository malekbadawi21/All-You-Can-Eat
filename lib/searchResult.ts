import type { MealCombination, BuildOption } from "./optimize";
import type { Goal } from "./parseQuery";
import type { RestaurantInfo } from "./db";

// ── The API's public shape ───────────────────────────────────────────────────
//
// /api/search used to answer in three different shapes depending on how the
// question happened to be phrased and which data model the restaurant used:
//
//   "high protein chick-fil-a"                -> top_results     (10 loose items)
//   "high protein chick-fil-a around 800 cal" -> recommendations (5 meal combos)
//   "high protein chipotle"                   -> options         (3 builds)
//
// Three keys, three item structures, three rendering paths — and which one you
// got depended on the restaurant's internals rather than on what you asked.
// Everything here is the same idea: orders you could walk in and place. So
// there is now one shape, and the differences that genuinely matter — whether
// an order has slot structure, what kind of pick it represents — are fields on
// it rather than separate response formats.

/** One thing in an order: a menu item, or one pick from a build slot. */
export interface OrderItem {
  id: number;
  name: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number;
  price: number;
  /**
   * Which slot this pick belongs to ("protein", "side"), for build-your-own
   * restaurants. Absent on fixed menus, where an order is a flat list of items.
   * Present means the UI *may* group; it never has to.
   */
  group?: string;
}

export interface OrderResult {
  /** Human-facing name for this kind of order — "Classic meal", "Most variety". */
  label: string;
  /**
   * Where the label came from, so the UI can style the two families
   * differently if it wants to. Not a rendering requirement: `items` is
   * renderable the same way for both.
   */
  kind: "meal" | "build";
  items: OrderItem[];
  total_calories: number;
  total_protein_g: number;
  total_fat_g: number;
  total_carbs_g: number;
  total_sodium_mg: number;
  total_price: number;
}

export interface SearchResponse {
  restaurant: {
    name: string;
    slug: string;
    type: RestaurantInfo["type"];
  };
  query: string;
  goals: Goal[];
  /** null rather than absent, so the field's presence is not itself a signal. */
  calorie_target: number | null;
  budget_priority: boolean;
  results: OrderResult[];
}

export interface SearchError {
  error: string;
  /** Machine-readable, so the UI can react without matching on prose. */
  code: "missing_query" | "query_too_long" | "no_restaurant" | "unknown_restaurant";
  /** Populated when the restaurant couldn't be identified, to drive suggestions. */
  available?: string[];
}

const round1 = (n: number) => +n.toFixed(1);
const round2 = (n: number) => +n.toFixed(2);

/** A fixed-menu meal combination in the unified shape. */
export function fromMealCombination(combo: MealCombination): OrderResult {
  return {
    label: combo.shape_label,
    kind: "meal",
    items: combo.items.map((item) => ({
      id: item.id,
      name: item.name,
      calories: item.calories,
      protein_g: item.protein_g,
      fat_g: item.fat_g,
      carbs_g: item.carbs_g,
      sodium_mg: item.sodium_mg,
      price: item.price,
    })),
    total_calories: combo.total_calories,
    total_protein_g: round1(combo.total_protein_g),
    total_fat_g: round1(combo.total_fat_g),
    total_carbs_g: round1(combo.total_carbs_g),
    total_sodium_mg: combo.total_sodium_mg,
    total_price: round2(combo.total_price),
  };
}

/** A build-your-own order in the unified shape, slots flattened into groups. */
export function fromBuildOption(option: BuildOption): OrderResult {
  return {
    label: option.label,
    kind: "build",
    items: option.order.flatMap((slot) =>
      slot.selected.map((pick) => ({
        id: pick.id,
        name: pick.name,
        calories: pick.calories,
        protein_g: pick.protein_g,
        fat_g: pick.fat_g,
        carbs_g: pick.carbs_g,
        sodium_mg: pick.sodium_mg,
        price: pick.price,
        group: slot.slot_name,
      }))
    ),
    total_calories: option.total_calories,
    total_protein_g: round1(option.total_protein_g),
    total_fat_g: round1(option.total_fat_g),
    total_carbs_g: round1(option.total_carbs_g),
    total_sodium_mg: option.total_sodium_mg,
    total_price: round2(option.total_price),
  };
}
