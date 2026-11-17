import { getAllRestaurants, getMenu, type Menu } from "./db";
import { tokensOf } from "./menuTerms";
import { parseQuery } from "./parseQuery";
import { inferRestaurant, searchMenu, vocabularyOf } from "./search";
import type { SearchError, SearchResponse } from "./searchResult";

// ── Running a search ─────────────────────────────────────────────────────────
//
// The one place a search touches the database. The API route calls this, and
// so do the server-rendered restaurant pages — which is why it is a plain
// function returning a status and a body rather than something tied to HTTP.
//
// Everything interesting happens in three pure modules it calls:
//   lib/parseQuery.ts  what did they say?
//   lib/search.ts      what does that mean on this menu?
//   lib/optimize.ts    what should they order?

// Long enough for any real request ("high protein low carb order at chick fil a
// around 800 calories under $10, no fries" is 79), short enough that nothing
// pathological reaches the parser's regular expressions.
export const MAX_QUERY_LENGTH = 200;
/** Canonical criteria are terse; anything longer than this isn't ours. */
const MAX_CONTEXT_LENGTH = 400;

export interface SearchRequest {
  /** What the user typed. May be empty when `restaurant` is given. */
  q?: string | null;
  /** Slug of the restaurant the user is standing at, if any. */
  restaurant?: string | null;
  /** `criteria.canonical` from the previous response, to continue from it. */
  context?: string | null;
}

export type SearchOutcome =
  | { status: 200; body: SearchResponse }
  | { status: 400 | 404; body: SearchError };

const fail = (status: 400 | 404, body: SearchError): SearchOutcome => ({ status, body });

/** True when a permitted source exists to try adding this restaurant from. */
export type CanIngest = (slug: string) => boolean;

export async function runSearch(
  request: SearchRequest,
  canIngest: CanIngest = () => false
): Promise<SearchOutcome> {
  const q = (request.q ?? "").trim();
  const standingAt = request.restaurant?.trim().toLowerCase() || null;

  // ── Validate before anything touches the database ─────────────────────────
  if (q === "" && !standingAt) {
    return fail(400, { error: "Missing required query param: q", code: "missing_query" });
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return fail(400, {
      error: `Query is too long (${q.length} characters, max ${MAX_QUERY_LENGTH}).`,
      code: "query_too_long",
    });
  }
  const context =
    request.context && request.context.length <= MAX_CONTEXT_LENGTH ? request.context : null;

  const restaurants = await getAllRestaurants();
  const available = restaurants.map((r) => r.name);
  const parsed = parseQuery(q, restaurants);

  // ── Which restaurant? ─────────────────────────────────────────────────────
  //
  // In order: one named in the message; a chain we recognise but don't carry
  // (say so); the one the user is standing at; one implied by a menu item
  // ("big mac"); a name we've never heard of (say so); otherwise, none.
  let slug = parsed.restaurant;

  if (!slug && parsed.unknownRestaurant?.known) {
    const { name, slug: wanted } = parsed.unknownRestaurant;
    return fail(404, {
      error: `We don't have ${name} yet.`,
      code: "unknown_restaurant",
      available,
      requested: { name, slug: wanted, can_ingest: canIngest(wanted) },
    });
  }

  if (!slug && standingAt && restaurants.some((r) => r.slug === standingAt)) slug = standingAt;

  if (!slug) {
    const menus = (await Promise.all(restaurants.map((r) => getMenu(r.slug)))).filter(
      (m): m is Menu => Boolean(m)
    );
    slug = inferRestaurant(parsed.leftover, menus);

    if (!slug && parsed.unknownRestaurant) {
      // The parser guesses that leftover words are a restaurant's name. Only
      // believe it if they aren't *all* food we serve somewhere: "spicy
      // nuggets" is a craving, not a place, while "Zorblatt Grill" is a place
      // even though "grill" appears on a menu.
      const guess = tokensOf(parsed.unknownRestaurant.name);
      const served = new Set(menus.flatMap((m) => vocabularyOf(m).flatMap((v) => v.tokens)));
      if (!guess.every((token) => served.has(token))) {
        const { name, slug: wanted } = parsed.unknownRestaurant;
        return fail(404, {
          error: `We don't have ${name} yet.`,
          code: "unknown_restaurant",
          available,
          requested: { name, slug: wanted, can_ingest: canIngest(wanted) },
        });
      }
    }
  }

  if (!slug) {
    return fail(400, {
      error:
        "Which restaurant? Try something like “high protein Chick-fil-A under 700 calories”.",
      code: "no_restaurant",
      available,
    });
  }

  const menu = await getMenu(slug);
  if (!menu) {
    return fail(404, {
      error: `We don't have ${slug} yet.`,
      code: "unknown_restaurant",
      available,
      requested: { name: slug, slug, can_ingest: canIngest(slug) },
    });
  }

  // Context only carries over within one restaurant: "no rice" means nothing
  // at McDonald's, and arriving somewhere new is a fresh conversation.
  const sameRestaurant = !standingAt || standingAt === slug;

  return {
    status: 200,
    body: searchMenu(menu, { parsed, query: q, context: sameRestaurant ? context : null }),
  };
}
