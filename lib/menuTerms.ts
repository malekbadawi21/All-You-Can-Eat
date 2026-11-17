// ── Matching the user's words to the menu ────────────────────────────────────
//
// "no fries", "with nuggets", "burger". The parser can spot that a word is
// *probably* a menu word, but only the menu can confirm it, so that last step
// happens here.
//
// Matching is on whole words after light stemming, never on substrings:
// "no cream" must not remove an Icedream Cone. One deliberate exception lets a
// word match the *end* of a longer one, so "nuggets" finds "McNuggets" and
// "burger" finds "Cheeseburger".

const SYNONYMS: Record<string, string> = {
  guac: "guacamole",
  nugs: "nuggets",
  nuggies: "nuggets",
  fry: "fries",
  veg: "veggies",
  veggie: "veggies",
  vegetables: "veggies",
  vegetable: "veggies",
  shakes: "shake",
  milkshake: "shake",
  milkshakes: "shake",
  soda: "drink",
  tender: "strips",
  tenders: "strips",
  fingers: "finger",
  sammy: "sandwich",
  sammie: "sandwich",
};

/** Reduces a word to the form both sides are compared in. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  w = SYNONYMS[w] ?? w;
  // Crude on purpose. It only has to be *consistent* — the same rule is
  // applied to the query and to the menu — not linguistically correct.
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

export const tokensOf = (text: string): string[] =>
  text
    .split(/[^A-Za-z0-9']+/)
    .map(stem)
    .filter(Boolean);

/** One thing on the menu, reduced to what can be matched against. */
export interface Searchable {
  /** Stemmed words of the name, in order. */
  tokens: string[];
  /** Other handles: the category on fixed menus, the slot name on builds. */
  tags: string[];
}

export const searchable = (name: string, ...tags: (string | undefined)[]): Searchable => ({
  tokens: tokensOf(name),
  tags: tags.filter((t): t is string => Boolean(t)).map(stem),
});

const tokenMatches = (have: string, want: string) =>
  have === want || (want.length >= 5 && have.length > want.length && have.endsWith(want));

/** Whether `term` (one or more words) names this menu entry. */
export function matchesTerm(entry: Searchable, term: string): boolean {
  const want = tokensOf(term);
  if (want.length === 0) return false;

  if (want.length === 1) {
    return entry.tags.includes(want[0]) || entry.tokens.some((t) => tokenMatches(t, want[0]));
  }

  // Several words must appear together, in order: "sour cream", "big mac".
  for (let start = 0; start + want.length <= entry.tokens.length; start++) {
    if (want.every((w, i) => tokenMatches(entry.tokens[start + i], w))) return true;
  }
  return false;
}

export interface ResolvedPhrase {
  /** Terms the menu recognises, in the user's own words. */
  terms: string[];
  /** Words that matched nothing on this menu. */
  unmatched: string[];
}

/**
 * Splits a run of words into the longest menu terms it contains.
 *
 * "orange chicken fried rice" becomes ["orange chicken", "fried rice"] rather
 * than four separate words, because requiring an order to contain "chicken"
 * and, separately, "rice" is a much weaker statement than the one made.
 */
export function resolvePhrase(words: string[], menu: Searchable[]): ResolvedPhrase {
  const terms: string[] = [];
  const unmatched: string[] = [];

  let i = 0;
  while (i < words.length) {
    let taken = 0;
    for (const size of [3, 2, 1]) {
      if (i + size > words.length) continue;
      const term = words.slice(i, i + size).join(" ");
      if (menu.some((entry) => matchesTerm(entry, term))) {
        if (!terms.includes(term)) terms.push(term);
        taken = size;
        break;
      }
    }
    if (taken === 0) {
      unmatched.push(words[i]);
      taken = 1;
    }
    i += taken;
  }

  return { terms, unmatched };
}
