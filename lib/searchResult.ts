import type { Criteria, CriteriaChip } from "./criteria";
import type { RestaurantInfo } from "./db";
import type { MealRole } from "./mealGrammar";
import type { Notice } from "./notices";
import type { OrderPick, OrderShape } from "./optimize";
import type { Ranked } from "./selectResults";

// ── The API's public shape ───────────────────────────────────────────────────
//
// Everything /api/search can say, in one file. A search answers in the same
// shape whatever the restaurant, however the question was phrased, and whether
// it is the first message or the fifth in a conversation.
//
//   { restaurant, query, criteria, results, notices, data }
//
// What each part is for:
//
//   criteria   everything in force after this message — not just what this
//              message said. Carries `canonical`, a text form the parser reads
//              back to the same criteria: hand it back as `context` on the
//              next request and the conversation continues, with no session
//              stored anywhere.
//   results    0–5 orders. The first is the best match; every label is unique.
//   notices    what couldn't be done, and why. Empty when all went to plan.
//   data       where the numbers came from and how old they are.
//
// Scores are deliberately not exposed. They aren't comparable across
// restaurants and would mislead if displayed.
//
// __tests__/searchRoute.test.ts is the contract. Change this file and that
// test together.

/** One line of an order: a menu item, or one pick from a build slot. */
export interface OrderItem {
  id: number;
  name: string;
  /** How many. Nutrition and price below are for ONE; totals multiply. */
  quantity: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number;
  /** USD, approximate. Null when we have no price data — never "free". */
  price: number | null;
  /** Present and true when the price is an interpolation, not a sourced figure. */
  price_estimated?: true;
  /**
   * Which slot this pick belongs to ("protein", "side"), for build-your-own
   * restaurants. Absent on fixed menus. Present means the UI *may* group.
   */
  group?: string;
  /** main / side / dessert, on fixed menus. Absent on builds. */
  role?: MealRole;
}

export interface OrderResult {
  /** Stable for a given set of items; safe as a React key or a URL fragment. */
  id: string;
  /**
   * Why this order is in the list: "Best match", "Classic meal", "Budget
   * pick". Unique within a response.
   */
  label: string;
  kind: "meal" | "build";
  /** What the order is structurally: classic / single / stack, or "build". */
  shape: OrderShape;
  items: OrderItem[];
  total_calories: number;
  total_protein_g: number;
  total_fat_g: number;
  total_carbs_g: number;
  total_sodium_mg: number;
  /** Null when the restaurant has no price data. Always approximate. */
  total_price: number | null;
  /** True when any item's price is an estimate. */
  price_estimated: boolean;
}

/** Criteria, plus the ways of saying it back. */
export interface CriteriaView extends Criteria {
  /** Parser-readable text. Send back as `context` to continue the conversation. */
  canonical: string;
  /** For prose: "high protein, around 800 calories". Empty when nothing is asked. */
  summary: string;
  /** One removable chip per thing in force. */
  chips: CriteriaChip[];
}

/** Where one kind of figure came from. */
export interface Provenance {
  source: string;
  url: string | null;
  market: string;
  /** ISO date the figures were read from the source. */
  fetched_at: string;
  age_days: number;
  /** True once older than the freshness policy allows (lib/freshness.ts). */
  stale: boolean;
  notes: string | null;
}

export interface SearchResponse {
  restaurant: {
    name: string;
    slug: string;
    type: RestaurantInfo["type"];
  };
  /** The message as sent, trimmed. */
  query: string;
  criteria: CriteriaView;
  results: OrderResult[];
  notices: Notice[];
  data: {
    nutrition: Provenance | null;
    /** Null when the restaurant has no price data at all. */
    price: Provenance | null;
  };
}

export interface SearchError {
  error: string;
  /** Machine-readable, so the UI can react without matching on prose. */
  code: "missing_query" | "query_too_long" | "no_restaurant" | "unknown_restaurant";
  /** Names of the restaurants we do have, to drive suggestions. */
  available?: string[];
  /** For unknown_restaurant: what the user seemed to be asking for. */
  requested?: {
    name: string;
    slug: string;
    /** True when there is a permitted source we could try to add it from. */
    can_ingest: boolean;
  };
}

const round1 = (n: number) => +n.toFixed(1);
const round2 = (n: number) => +n.toFixed(2);

const ROLE_ORDER: Record<MealRole, number> = { main: 0, side: 1, dessert: 2 };

/** An engine result in the public shape. */
export function toOrderResult(ranked: Ranked, kind: "meal" | "build"): OrderResult {
  const { candidate, label } = ranked;

  // Fixed menus read best mains-first; builds are already in slot order.
  const picks: OrderPick[] =
    kind === "meal"
      ? [...candidate.picks].sort(
          (a, b) => ROLE_ORDER[a.role ?? "main"] - ROLE_ORDER[b.role ?? "main"]
        )
      : candidate.picks;

  // "Crunchy Taco, Crunchy Taco, Crunchy Taco" becomes one line with a
  // quantity of 3.
  const items: OrderItem[] = [];
  for (const pick of picks) {
    const last = items[items.length - 1];
    if (last && last.id === pick.id && last.group === pick.group) {
      last.quantity++;
      continue;
    }
    items.push({
      id: pick.id,
      name: pick.name,
      quantity: 1,
      calories: pick.calories,
      protein_g: pick.protein_g,
      fat_g: pick.fat_g,
      carbs_g: pick.carbs_g,
      sodium_mg: pick.sodium_mg,
      price: pick.price,
      ...(pick.price_estimated ? { price_estimated: true as const } : {}),
      ...(pick.group ? { group: pick.group } : {}),
      ...(pick.role ? { role: pick.role } : {}),
    });
  }

  const { totals } = candidate;
  return {
    id: items.map((i) => (i.quantity > 1 ? `${i.id}x${i.quantity}` : `${i.id}`)).join("-"),
    label,
    kind,
    shape: candidate.shape,
    items,
    total_calories: totals.calories,
    total_protein_g: round1(totals.protein_g),
    total_fat_g: round1(totals.fat_g),
    total_carbs_g: round1(totals.carbs_g),
    total_sodium_mg: totals.sodium_mg,
    total_price: totals.price === null ? null : round2(totals.price),
    price_estimated: candidate.picks.some((p) => p.price_estimated),
  };
}
