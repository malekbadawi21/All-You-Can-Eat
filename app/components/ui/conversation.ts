import type { SearchError, SearchResponse } from "@/lib/searchResult";

// ── The conversation, as data ────────────────────────────────────────────────
//
// What the panel renders from. A conversation is a list of turns; a turn is
// one thing the user did (typed a message, tapped a suggestion, removed a
// chip) and what came back.
//
// Nothing here is React. Keeping the shapes and the wording in a plain module
// means the panel is only layout, and the sentences can be read — and changed
// — in one place.

export interface Turn {
  id: number;
  /** What the user typed, or null for the automatic first look at a menu. */
  said: string | null;
  /**
   * For actions that weren't typed — removing a chip — a short description to
   * show in place of a message: "Removed: High protein".
   */
  action?: string;
  status: "loading" | "ok" | "error";
  response?: SearchResponse;
  /** Set when status is "error". */
  error?: { message: string; code?: SearchError["code"] };
}

export type SearchOutcome =
  | { ok: true; response: SearchResponse }
  | { ok: false; error: SearchError | { error: string; code?: undefined } };

/** Whether a payload is the API's typed error rather than a result. */
const isError = (data: unknown): data is SearchError =>
  typeof data === "object" && data !== null && "code" in data && !("results" in data);

export interface SearchParams {
  q: string;
  restaurant?: string | null;
  context?: string | null;
}

/**
 * One request to /api/search. Never throws: a network failure comes back as an
 * error outcome like any other, so callers have exactly one failure path.
 */
export async function requestSearch(
  params: SearchParams,
  signal?: AbortSignal
): Promise<SearchOutcome> {
  const query = new URLSearchParams({ q: params.q });
  if (params.restaurant) query.set("restaurant", params.restaurant);
  if (params.context) query.set("context", params.context);

  try {
    const res = await fetch(`/api/search?${query}`, { signal });
    const data: unknown = await res.json();
    // Branch on the shape, never on the prose — the message is free to change.
    if (isError(data)) return { ok: false, error: data };
    return { ok: true, response: data as SearchResponse };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    return {
      ok: false,
      error: { error: "Couldn't reach the kitchen — check your connection and try again." },
    };
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The one-line reply shown for a turn. Deliberately plain: it says what was
 * understood and how many orders came back, because the orders themselves are
 * right underneath and the notices carry anything that went wrong.
 */
export function replyFor(turn: Turn, restaurantName: string): string {
  if (turn.status === "loading") return "Checking the kitchen…";
  if (turn.status === "error") return turn.error?.message ?? "Something went wrong.";

  const response = turn.response!;
  const count = response.results.length;
  const { summary } = response.criteria;

  if (count === 0) {
    return `Nothing at ${restaurantName} fits that. Try loosening one of the limits.`;
  }
  if (response.results[0].label === "Closest match") {
    return "Nothing matches that exactly. These come closest:";
  }
  if (!summary) {
    return turn.said === null
      ? `Here's what I'd order at ${restaurantName}. Tell me what you're after and I'll narrow it down.`
      : `Back to the whole menu — ${plural(count, "order")} worth a look:`;
  }
  return `${plural(count, "order")} for ${summary}:`;
}

/** For screen readers: the same information, said once when results change. */
export function announcementFor(turn: Turn, restaurantName: string): string {
  if (turn.status !== "ok") return turn.status === "error" ? replyFor(turn, restaurantName) : "";
  const response = turn.response!;
  const notices = response.notices.map((n) => n.message).join(" ");
  const first = response.results[0];
  const lead = first
    ? ` Top result: ${first.items.map((i) => (i.quantity > 1 ? `${i.quantity} ` : "") + i.name).join(", ")}, ${first.total_calories} calories.`
    : "";
  return `${replyFor(turn, restaurantName)}${lead} ${notices}`.trim();
}

/**
 * Things worth suggesting next, given what is already in force. A suggestion
 * that would repeat an active criterion is left out, so the row always offers
 * something that changes the answer.
 */
export function suggestionsFor(response: SearchResponse | undefined): string[] {
  const active = new Set(response?.criteria.chips.map((c) => c.id) ?? []);
  const fixed = response?.restaurant.type === "fixed";

  const all: { text: string; unless: string[] }[] = [
    { text: "High protein", unless: ["goal:protein_g"] },
    { text: "Low carb", unless: ["goal:carbs_g"] },
    { text: "Low fat", unless: ["goal:fat_g"] },
    { text: "Under 600 calories", unless: ["calories"] },
    { text: "Cheaper", unless: ["budget"] },
    { text: "Under $10", unless: ["price"] },
    ...(fixed ? [{ text: "Breakfast", unless: ["daypart"] }] : []),
    { text: "Mix it up", unless: ["variety"] },
  ];

  const hasPrices = response ? response.data.price !== null : true;
  return all
    .filter((s) => !s.unless.some((id) => active.has(id)))
    .filter((s) => hasPrices || !["Cheaper", "Under $10"].includes(s.text))
    .map((s) => s.text);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jul 2026" from an ISO date, without dragging in a date library or a locale. */
export function monthYear(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${year}` : iso;
}
