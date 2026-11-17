import {
  applyPatch,
  canonicalText,
  chipsFor,
  describeCriteria,
  emptyCriteria,
  type Criteria,
} from "./criteria";
import type { Menu, SourceInfo } from "./db";
import { freshnessOf } from "./freshness";
import { matchesTerm, resolvePhrase, searchable, type Searchable } from "./menuTerms";
import type { Notice } from "./notices";
import { recommend } from "./optimize";
import { LEFTOVER_SEPARATOR, parseQuery, type ParsedQuery } from "./parseQuery";
import { toOrderResult, type Provenance, type SearchResponse } from "./searchResult";

// ── From a message to an answer ──────────────────────────────────────────────
//
// The pure middle of a search: given a menu and what the user said, produce
// the response. No database, no HTTP — lib/searchService.ts does the fetching
// and hands the results here — so everything in this file can be tested with a
// menu built from a seed document.
//
// Its own job, beyond calling the parser and the engine, is the part neither
// of them can do alone: matching the user's leftover words against this
// particular menu. "nuggets" is a requirement at Chick-fil-A and noise at
// Chipotle, and only the menu knows which.

/** Every pickable thing on a menu, in matchable form. */
export function vocabularyOf(menu: Pick<Menu, "items" | "slots">): Searchable[] {
  return [
    ...menu.items.map((item) => searchable(item.name, item.category)),
    ...menu.slots.flatMap((slot) =>
      slot.options.map((option) => searchable(option.name, slot.slot_name))
    ),
  ];
}

/** Splits the parser's leftover tokens into runs of adjacent words. */
function runsOf(leftover: string[]): string[][] {
  const runs: string[][] = [[]];
  for (const token of leftover) {
    if (token === LEFTOVER_SEPARATOR) runs.push([]);
    else runs[runs.length - 1].push(token);
  }
  return runs.filter((run) => run.length > 0);
}

interface Understood {
  criteria: Criteria;
  /** Words that matched nothing on this menu. */
  unrecognized: string[];
}

/**
 * Applies one parsed message on top of the criteria already in force,
 * resolving its menu words against this menu.
 */
function understand(menu: Menu, parsed: ParsedQuery, base: Criteria): Understood {
  const vocabulary = vocabularyOf(menu);
  const unrecognized: string[] = [];
  const patch = { ...parsed.patch, include: [...parsed.patch.include], exclude: [...parsed.patch.exclude] };

  for (const phrase of parsed.excludePhrases) {
    const { terms, unmatched } = resolvePhrase(phrase.split(" "), vocabulary);
    patch.exclude.push(...terms);
    unrecognized.push(...unmatched);
  }
  for (const run of runsOf(parsed.leftover)) {
    const { terms, unmatched } = resolvePhrase(run, vocabulary);
    patch.include.push(...terms);
    unrecognized.push(...unmatched);
  }

  let criteria = applyPatch(base, patch);

  // At a build-your-own counter, asking for steak after asking for chicken is
  // a change of mind, not a request for both: they fill the same pick-one
  // slot. An earlier requirement that can only be met from the same slot as a
  // new one is dropped in its favour.
  if (menu.slots.length > 0 && patch.include.length > 0) {
    const slotsFor = (term: string) =>
      new Set(
        menu.slots
          .filter((slot) =>
            slot.options.some((o) => matchesTerm(searchable(o.name, slot.slot_name), term))
          )
          .map((slot) => slot.slot_name)
      );
    const pickOne = new Set(menu.slots.filter((s) => s.pick === "1").map((s) => s.slot_name));

    const superseded = new Set<string>();
    for (const fresh of patch.include) {
      const mine = slotsFor(fresh);
      if (mine.size !== 1) continue;
      const [slot] = mine;
      if (!pickOne.has(slot)) continue;

      for (const older of criteria.include) {
        if (older === fresh || patch.include.includes(older)) continue;
        const theirs = slotsFor(older);
        if (theirs.size === 1 && theirs.has(slot)) superseded.add(older);
      }
    }
    if (superseded.size > 0) {
      criteria = { ...criteria, include: criteria.include.filter((t) => !superseded.has(t)) };
    }
  }

  return { criteria, unrecognized };
}

const quoted = (words: string[]) => words.map((w) => `“${w}”`).join(", ");

function provenance(source: SourceInfo | null, now: Date): Provenance | null {
  if (!source) return null;
  const { age_days, stale } = freshnessOf(source, now);
  return {
    source: source.name,
    url: source.url,
    market: source.market,
    fetched_at: source.fetched_at,
    age_days,
    stale,
    notes: source.notes,
  };
}

export interface SearchInputs {
  /** The message, already parsed against the restaurant catalog. */
  parsed: ParsedQuery;
  /** The message as typed, for echoing back. */
  query: string;
  /** Canonical criteria text from the previous turn, if this continues one. */
  context?: string | null;
  now?: Date;
}

export function searchMenu(menu: Menu, inputs: SearchInputs): SearchResponse {
  const { parsed, query, context, now = new Date() } = inputs;
  const notices: Notice[] = [];

  // What was already in force. The context is canonical text this code wrote
  // itself, so it is parsed with no catalog — a restaurant name inside it
  // would be a bug, not a destination — and anything it fails to match is
  // dropped silently rather than reported back as if the user had just said it.
  const base = context
    ? understand(menu, parseQuery(context), emptyCriteria()).criteria
    : emptyCriteria();

  const { criteria, unrecognized } = understand(menu, parsed, base);

  if (parsed.unsupported.length > 0) {
    notices.push({
      code: "unsupported_terms",
      message: `We don't have data on ${quoted(parsed.unsupported)}, so that part was ignored.`,
    });
  }
  if (unrecognized.length > 0) {
    notices.push({
      code: "unrecognized_terms",
      message: `Nothing on ${menu.restaurant.name}'s menu matches ${quoted([...new Set(unrecognized)])}, so that part was ignored.`,
    });
  }

  const recommendation = recommend(menu, criteria);
  notices.push(...recommendation.notices);

  const kind = menu.restaurant.type === "fixed" ? "meal" : "build";

  return {
    restaurant: {
      name: menu.restaurant.name,
      slug: menu.restaurant.slug,
      type: menu.restaurant.type,
    },
    query,
    criteria: {
      ...criteria,
      canonical: canonicalText(criteria),
      summary: describeCriteria(criteria),
      chips: chipsFor(criteria),
    },
    results: recommendation.results.map((r) => toOrderResult(r, kind)),
    notices,
    data: {
      nutrition: provenance(menu.sources.nutrition, now),
      price: provenance(menu.sources.price, now),
    },
  };
}

/**
 * Which restaurant, if exactly one, do these words belong to?
 *
 * "big mac under 600" names no restaurant, but only one menu has a Big Mac.
 * Deliberately conservative — being sent to the wrong restaurant is worse than
 * being asked which one — so a menu is chosen only when:
 *
 *   • it accounts for every one of the words ("zorblatt grill" is not
 *     Chick-fil-A just because they sell an Egg White Grill), and
 *   • at least one of the things named is on no other menu ("spicy nuggets"
 *     is a craving several places can satisfy; "orange chicken" is not).
 */
export function inferRestaurant(leftover: string[], menus: Menu[]): string | null {
  const runs = runsOf(leftover);
  if (runs.length === 0) return null;
  const wordCount = runs.reduce((n, run) => n + run.length, 0);

  const vocabularies = menus.map((menu) => ({ slug: menu.restaurant.slug, entries: vocabularyOf(menu) }));

  const candidates = vocabularies.filter(({ slug, entries }) => {
    const terms: string[] = [];
    let matched = 0;
    for (const run of runs) {
      for (const term of resolvePhrase(run, entries).terms) {
        terms.push(term);
        matched += term.split(" ").length;
      }
    }
    if (matched < wordCount) return false;

    return terms.some((term) =>
      vocabularies.every(
        (other) => other.slug === slug || !other.entries.some((entry) => matchesTerm(entry, term))
      )
    );
  });

  return candidates.length === 1 ? candidates[0].slug : null;
}
