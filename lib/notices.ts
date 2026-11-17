// ── Telling the user what we couldn't do ─────────────────────────────────────
//
// A search can succeed and still owe the user an explanation: the calorie
// target wasn't reachable, a word wasn't understood, there's no price data.
// The old API said nothing in those cases — "raising canes around 600
// calories" returned an 830 calorie order as if that were an answer to the
// question.
//
// A notice is that explanation. `code` is for programs (style it, test it,
// branch on it); `message` is for people and is free to be reworded.

export type NoticeCode =
  /** A stated calorie target has no order near it; nearest shown. */
  | "calorie_target_unreachable"
  /** No order is under the stated calorie ceiling. */
  | "calorie_max_unreachable"
  /** No order reaches the stated calorie floor. */
  | "calorie_min_unreachable"
  /** No order is under the stated price. */
  | "price_max_unreachable"
  /** No order satisfies a stated gram limit. */
  | "nutrient_limit_unreachable"
  /** Each constraint is satisfiable alone, but not all together. */
  | "constraints_conflict"
  /** Something the user asked to include isn't obtainable in a valid order. */
  | "include_unreachable"
  /** The restaurant has no price data, so price was ignored. */
  | "price_unavailable"
  /** Breakfast was asked for and there is none on record. */
  | "no_breakfast"
  /** Words that matched nothing on the menu. */
  | "unrecognized_terms"
  /** Concepts we hold no data for (sugar, allergens, diet labels). */
  | "unsupported_terms";

export interface Notice {
  code: NoticeCode;
  message: string;
}
