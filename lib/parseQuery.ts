import { KNOWN_CHAINS } from "./chains";
import {
  emptyPatch,
  type CriteriaPatch,
  type Goal,
  type NutrientKey,
  type NutrientLimit,
} from "./criteria";

export type { Goal, NutrientKey, Direction } from "./criteria";

// ── Reading what someone typed ───────────────────────────────────────────────
//
// A keyword parser, deliberately. It turns
//
//   "high protein chick fil a under 800 cal, no fries, cheap"
//
// into a restaurant plus a CriteriaPatch (see lib/criteria.ts). It is not an
// LLM and does not try to be: every phrase it understands is listed below,
// which means its behaviour is predictable, testable and free, and a phrase it
// gets wrong is a one-line fix.
//
// How it works: the text is normalised, then a series of recognisers each
// *consume* the span they understood, replacing it with a separator. Order
// matters and is the main design decision here — a price has to be consumed
// before calories are looked for, or "$8" becomes "8 calories"; "no carbs" has
// to be consumed as a goal before "no <thing>" is read as an exclusion.
// Whatever survives to the end is either a menu word ("nuggets") or noise, and
// that call needs the menu, so it is returned as `leftover` for lib/search.ts
// to settle.

export interface CatalogEntry {
  slug: string;
  name: string;
  aliases: string[];
}

export interface UnknownRestaurant {
  /** Best display form of what the user typed: "Wendy's". */
  name: string;
  slug: string;
  /** True when it matched the directory of chains we know of. */
  known: boolean;
}

export interface ParsedQuery {
  /** Slug of a restaurant in the catalog, if the query names one. */
  restaurant: string | null;
  /** A restaurant the query seems to name that the catalog doesn't have. */
  unknownRestaurant: UnknownRestaurant | null;
  patch: CriteriaPatch;
  /** Phrases that followed "no" / "without", for the menu to resolve. */
  excludePhrases: string[];
  /** Words nothing claimed. Menu words become "must include"; the rest is noise. */
  leftover: string[];
  /** Things we recognised but hold no data for: "sugar", "vegan". */
  unsupported: string[];
}

// ── Normalising ──────────────────────────────────────────────────────────────

const SEP = "|";

/**
 * Lower-cases and flattens punctuation so one spelling of each phrase is
 * enough: "Chick-fil-A", "chick fil a" and "McDonald’s" all come out in a form
 * the alias list can match. A hyphen between two numbers is kept, because
 * there it means a range.
 */
export function squash(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’‘`']/g, "")
    .replace(/\bw\/o\b/g, " without ")
    .replace(/\bw\/(?=\s|$)/g, " with ")
    .replace(/(\d)\s*[-–—]\s*(\d)/g, "$1-$2")
    .replace(/[,;:!?()]/g, ` ${SEP} `)
    .replace(/(?<!\d)-|-(?!\d)|[–—_/]/g, " ")
    .replace(/\.(?!\d)/g, " ")
    .replace(/[^a-z0-9 $.~<>=+&|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Damerau–Levenshtein distance, so "chipolte" is one edit from "chipotle". */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

const UNDER =
  "(?:under|below|less than|fewer than|at most|no more than|not more than|not over|up to|max(?:imum)?(?: of)?|within|<=|<)";
const OVER =
  "(?:over|above|more than|at least|no less than|not under|min(?:imum)?(?: of)?|>=|>)";
const ABOUT = "(?:around|about|approximately|approx|roughly|near|close to|circa|~)";
const CAL = "(?:k?cal(?:orie)?s?)";
const NUTR = "(protein|net carbs?|carbs?|carbohydrates?|fat|sodium|salt)";

const NUTRIENT_OF: Record<string, NutrientLimit["nutrient"]> = {
  protein: "protein_g",
  carb: "carbs_g",
  carbs: "carbs_g",
  "net carb": "carbs_g",
  "net carbs": "carbs_g",
  carbohydrate: "carbs_g",
  carbohydrates: "carbs_g",
  fat: "fat_g",
  sodium: "sodium_mg",
  salt: "sodium_mg",
};

/** Sanity ceilings, so "protein 9000" is ignored rather than obeyed. */
const LIMIT_MAX: Record<NutrientLimit["nutrient"], number> = {
  protein_g: 300,
  carbs_g: 500,
  fat_g: 300,
  sodium_mg: 10000,
};

const isUnder = (q: string | undefined) => Boolean(q && new RegExp(`^${UNDER}$`).test(q.trim()));
const isOver = (q: string | undefined) => Boolean(q && new RegExp(`^${OVER}$`).test(q.trim()));

interface GoalRule {
  pattern: RegExp;
  goals: Goal[];
}

const high = (nutrient: NutrientKey): Goal => ({ nutrient, direction: "high" });
const low = (nutrient: NutrientKey): Goal => ({ nutrient, direction: "low" });

// Checked in order, each consuming what it matches. The "low" form of a
// nutrient always sits above the bare word, so "low protein" is never read as
// "protein".
const GOAL_RULES: GoalRule[] = [
  { pattern: /\b(?:low(?:er)?|less|least|minimal) protein\b/g, goals: [low("protein_g")] },
  {
    pattern:
      /\b(?:(?:high(?:er|est)?|more|most|max(?:imum)?|extra|lots of|loads of|tons of|plenty of|rich in|packed with) protein|protein (?:packed|rich|heavy|dense|forward|focused)|gains|muscle|macro friendly|protein)\b/g,
    goals: [high("protein_g")],
  },
  {
    pattern:
      /\b(?:(?:low(?:er|est)?|less|fewer|least|no|zero|minimal|reduced|cut(?:ting)?) (?:net )?carb(?:s|ohydrates?)?|carb free|keto(?:genic)?|atkins)\b/g,
    goals: [low("carbs_g")],
  },
  {
    pattern: /\b(?:(?:high(?:er|est)?|more|most|extra|lots of) carb(?:s|ohydrates?)?|carb ?load(?:ing)?|carb up)\b/g,
    goals: [high("carbs_g")],
  },
  {
    pattern: /\b(?:(?:low(?:er|est)?|less|least|no|zero|reduced) fat|fat free|nonfat|lean(?:er|est)?)\b/g,
    goals: [low("fat_g")],
  },
  { pattern: /\b(?:high(?:er|est)?|more|extra) fat\b/g, goals: [high("fat_g")] },
  {
    pattern: /\b(?:(?:low(?:er|est)?|less|least|no|zero|reduced) (?:sodium|salt)|(?:sodium|salt) free|heart healthy)\b/g,
    goals: [low("sodium_mg")],
  },
  {
    pattern:
      /\b(?:(?:low(?:er|est)?|fewest|least|minimal|reduced) cal(?:orie)?s?|low ?cal|light|diet(?:ing)?|on a cut|cutting|skinny|slim|weight loss|los(?:e|ing) weight)\b/g,
    goals: [low("calories")],
  },
  {
    pattern: /\b(?:(?:high(?:er|est)?|most) cal(?:orie)?s?|bulk(?:ing)?|on a bulk|mass gain(?:er)?)\b/g,
    goals: [high("calories")],
  },
  // "Healthy" is not a nutrient. It is read here as the thing most people mean
  // by it at a drive-through: plenty of protein for not many calories.
  {
    pattern: /\b(?:health(?:y|ier|iest)|nutritious|clean(?:er)? eating|eat(?:ing)? clean)\b/g,
    goals: [high("protein_g"), low("calories")],
  },
];

const BUDGET =
  /\b(?:cheap(?:est|er)?|budget|affordable|inexpensive|least expensive|best value|good value|value|save money|low cost|low price|frugal|broke|economical|bang for (?:my|your|the) buck)\b/g;
const VARIETY =
  /\b(?:variety|mix it up|switch it up|change it up|something (?:different|else|new)|different|surprise me)\b/g;
const BREAKFAST = /\b(?:breakfast|brunch|morning)\b/g;
const ALL_DAY = /\b(?:lunch|dinner|supper|all day)\b/g;
const LIGHTER = /\b(?:lighter|smaller|less food|fewer cal(?:orie)?s?|less cal(?:orie)?s?)\b/g;
const BIGGER = /\b(?:bigger|larger|more food|more cal(?:orie)?s?|hungrier|more filling|heavier)\b/g;
const RESET = /\b(?:start over|start again|reset|clear (?:all|everything)|never ?mind|from scratch|new search)\b/g;

const UNSUPPORTED =
  /\b(sugar|fiber|fibre|gluten|vegan|vegetarian|dairy|lactose|peanuts?|allerg(?:y|ies|en|ens)|halal|kosher|cholesterol|saturated|trans fat|organic|paleo|whole30|pescatarian)\b/g;

/** What "forget the …" can refer to. */
const DROPPABLE: Record<string, NutrientKey | "price" | "daypart" | "variety"> = {
  calorie: "calories",
  calories: "calories",
  cal: "calories",
  protein: "protein_g",
  carb: "carbs_g",
  carbs: "carbs_g",
  fat: "fat_g",
  sodium: "sodium_mg",
  salt: "sodium_mg",
  price: "price",
  budget: "price",
  cost: "price",
  breakfast: "daypart",
  variety: "variety",
};
const DROP_WORDS = Object.keys(DROPPABLE).join("|");
const DROP = new RegExp(
  `\\b(?:forget|remove|drop|ignore|clear|lose|skip|nix|scrap|without)(?: about)?(?: the| my| that| any)? (${DROP_WORDS})(?: (?:limit|target|cap|goal|max|restriction))?\\b`,
  "g"
);
const ANY = new RegExp(
  `\\b(?:(?:any|whatever) (${DROP_WORDS})(?: (?:is fine|works|limit|amount))?|no (${DROP_WORDS}) (?:limit|target|cap|goal|max|restriction))\\b`,
  "g"
);

const EXCLUDE = new RegExp(
  `\\b(?:no|without|hold(?: the)?|skip(?: the)?|minus|exclud(?:e|ing)|not|dont want|dont like|hate|allergic to|nothing with)\\s+([a-z& ]+?)(?=\\s*(?:\\${SEP}|$|\\bwith\\b|\\bbut\\b|\\bplus\\b|\\bat\\b|\\bfrom\\b|\\bfor\\b|\\band (?:with|add)\\b|[0-9$]))`,
  "g"
);

/** Words that carry no meaning on their own once the recognisers have run. */
const STOPWORDS = new Set(
  `a an the and or but with add adding plus include including includes extra want wants need needs
   give gimme get find show me my i im id ill you your we us it its is are be been can could would
   should do does did have has had got some any something anything thing things stuff food foods
   meal meals order orders ordering option options choice choices eat eating eats ate lunch dinner
   supper snack good great best better nice tasty please thanks thank that this these those there
   here what whats which who how about like likes love really very just only also still keep same
   too so then than as of to at in on for from by near today tonight now right restaurant
   restaurants place places menu item items high higher low lower more less most least max min
   under over around calorie calories cal cals kcal protein carb carbs fat sodium salt price prices
   priced dollars bucks money cost costs worth go going get getting make makes made let lets try
   trying looking look pick recommend recommendation recommendations suggest suggestion suggestions
   idea ideas help possible per while if not no yes ok okay hey hi hello fast quick
   actually instead rather maybe perhaps well hmm um uh sure switch change swap replace use using
   one ones bit little lot kind sort way version type free again another other else now then
   whatever anyway though`
    .split(/\s+/)
    .filter(Boolean)
);

/** Generic food words: never mistaken for the name of a restaurant. */
const FOOD_WORDS = new Set(
  `burger burgers cheeseburger hamburger chicken beef pork steak fish shrimp turkey bacon sausage
   egg eggs pizza taco tacos burrito burritos bowl bowls salad salads sandwich sandwiches sub subs
   wrap wraps fries nuggets tenders strips wings rice beans cheese coffee shake shakes dessert
   desserts side sides drink drinks soda veggie veggies vegetables noodles pasta soup combo nachos
   quesadilla cookie cookies mexican chinese italian american asian spicy grilled fried crispy
   breakfast guac guacamole salsa toast biscuit`
    .split(/\s+/)
    .filter(Boolean)
);

// ── Restaurant recognition ───────────────────────────────────────────────────

interface AliasHit {
  slug: string;
  alias: string;
}

function findAlias(text: string, entries: { slug: string; aliases: string[] }[]): AliasHit | null {
  // Longest alias first, so "panda express" beats "panda" and both are
  // removed from the text as one unit.
  const all = entries
    .flatMap((e) => e.aliases.map((alias) => ({ slug: e.slug, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const candidate of all) {
    const pattern = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(candidate.alias)}(?=$|[^a-z0-9])`);
    if (pattern.test(text)) return candidate;
  }
  return null;
}

/**
 * Typo tolerance: "chipolte", "mcdonlds", "chik fil a".
 *
 * Only aliases of seven letters or more are eligible. Short ones sit too close
 * to ordinary words — "canes" is one edit from "cakes" — and a wrong restaurant
 * is a much worse failure than an unrecognised one.
 */
function findFuzzyAlias(
  tokens: string[],
  entries: { slug: string; aliases: string[] }[]
): (AliasHit & { span: [number, number] }) | null {
  let best: (AliasHit & { span: [number, number]; distance: number }) | null = null;

  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (alias.length < 7) continue;
      const allowed = alias.length >= 10 ? 2 : 1;
      const words = alias.split(" ").length;

      for (const size of new Set([words, words - 1, words + 1])) {
        if (size < 1) continue;
        for (let start = 0; start + size <= tokens.length; start++) {
          const slice = tokens.slice(start, start + size);
          if (slice.includes(SEP)) continue;
          const candidate = slice.join(" ");
          if (Math.abs(candidate.length - alias.length) > allowed) continue;
          // A real word that merely resembles a name is not a typo of it.
          if (size === 1 && (STOPWORDS.has(candidate) || FOOD_WORDS.has(candidate))) continue;
          const distance = editDistance(candidate, alias);
          if (distance <= allowed && (!best || distance < best.distance)) {
            best = { slug: entry.slug, alias: candidate, span: [start, start + size], distance };
          }
        }
      }
    }
  }
  return best;
}

const titleCase = (s: string) =>
  s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, "and");

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// ── The parser ───────────────────────────────────────────────────────────────

const within = (n: number, lo: number, hi: number) => n >= lo && n <= hi;

export function parseQuery(raw: string, catalog: CatalogEntry[] = []): ParsedQuery {
  const patch = emptyPatch();
  const unsupported: string[] = [];
  const excludePhrases: string[] = [];

  let text = ` ${squash(raw)} `;

  /**
   * Runs `pattern` over the text, handing each match to `use` and blanking it.
   * A handler that returns false is declining the match: the text is left as
   * it was, for a later recogniser to read.
   */
  const consume = (pattern: RegExp, use: (m: RegExpExecArray) => void | boolean) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    text = text.replace(new RegExp(pattern.source, flags), (...args) => {
      // String.replace passes (match, ...groups, offset, input). Rebuild the
      // exec-style array the handlers expect.
      const groupCount = args.length - 2;
      const m = args.slice(0, groupCount) as unknown as RegExpExecArray;
      return use(m) === false ? (args[0] as string) : ` ${SEP} `;
    });
  };

  // 1 ── Conversation control ────────────────────────────────────────────────
  consume(RESET, () => {
    patch.reset = true;
  });

  const drop = (word: string | undefined) => {
    if (!word) return;
    const what = DROPPABLE[word];
    if (what === "price") {
      patch.price_max = null;
      patch.budget_priority = false;
    } else if (what === "daypart") patch.daypart = "all-day";
    else if (what === "variety") patch.variety = false;
    else if (what) patch.dropNutrients.push(what);
  };
  consume(DROP, (m) => drop(m[1]));
  consume(ANY, (m) => drop(m[1] ?? m[2]));

  // 2 ── Restaurant ──────────────────────────────────────────────────────────
  //
  // The catalog's own name and slug count as aliases, so a restaurant ingested
  // without any is still findable by what it is called.
  const known = catalog.map((entry) => ({
    slug: entry.slug,
    aliases: [...new Set([...entry.aliases.map(squash), squash(entry.name), entry.slug.replace(/-/g, " ")])],
  }));
  const directory = KNOWN_CHAINS.filter((c) => !catalog.some((e) => e.slug === c.slug));

  let restaurant: string | null = null;
  let unknownRestaurant: UnknownRestaurant | null = null;

  const blank = (alias: string) => {
    text = text.replace(
      new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}(?=$|[^a-z0-9])`),
      `$1 ${SEP} `
    );
  };

  const exact = findAlias(text, known);
  if (exact) {
    restaurant = exact.slug;
    blank(exact.alias);
  } else {
    const elsewhere = findAlias(text, directory);
    if (elsewhere) {
      const chain = directory.find((c) => c.slug === elsewhere.slug)!;
      unknownRestaurant = { name: chain.name, slug: chain.slug, known: true };
      blank(elsewhere.alias);
    } else {
      const tokens = text.trim().split(" ");
      const fuzzy = findFuzzyAlias(tokens, known);
      if (fuzzy) {
        restaurant = fuzzy.slug;
        blank(fuzzy.alias);
      } else {
        const fuzzyElsewhere = findFuzzyAlias(tokens, directory);
        if (fuzzyElsewhere) {
          const chain = directory.find((c) => c.slug === fuzzyElsewhere.slug)!;
          unknownRestaurant = { name: chain.name, slug: chain.slug, known: true };
          blank(fuzzyElsewhere.alias);
        }
      }
    }
  }

  // 3 ── Money ───────────────────────────────────────────────────────────────
  //
  // Before calories, always: "$8" must not survive to be read as a number of
  // anything else. Every price mentioned is a cap — nobody asks for an order
  // costing *at least* ten dollars — so "over $10" is consumed and ignored.
  const price = (qualifier: string | undefined, amount: string) => {
    const value = parseFloat(amount);
    if (!isOver(qualifier) && within(value, 1, 200)) patch.price_max = value;
  };
  const PRICE_LEAD = `(?:(${UNDER}|${OVER}|${ABOUT}|for|with|have|got|only|spend(?:ing)?) ?)?`;
  consume(new RegExp(`${PRICE_LEAD}\\$ ?(\\d{1,3}(?:\\.\\d{1,2})?)(?: (?:or less|max|budget))?`), (m) => price(m[1], m[2]));
  consume(new RegExp(`${PRICE_LEAD}(\\d{1,3}(?:\\.\\d{1,2})?) ?(?:dollars?|bucks?|usd)\\b(?: (?:or less|max|budget))?`), (m) => price(m[1], m[2]));

  // 4 ── Grams of a nutrient ─────────────────────────────────────────────────
  //
  // Unqualified, the direction is the one that makes sense for the nutrient:
  // "40g protein" is a floor, "30g carbs" is a ceiling.
  const limit = (
    qualifier: string | undefined,
    amount: string,
    word: string,
    plus = false
  ) => {
    const nutrient = NUTRIENT_OF[word.trim()];
    const value = parseFloat(amount);
    // Declined, not swallowed: "high protein under 700 calories" briefly looks
    // like "protein under 700", and must survive to be read as calories.
    if (!nutrient || !within(value, 0, LIMIT_MAX[nutrient])) return false;

    const asFloor = isOver(qualifier) || plus || (!isUnder(qualifier) && nutrient === "protein_g");
    patch.limits = patch.limits.filter((l) => l.nutrient !== nutrient);
    patch.limits.push({ nutrient, min: asFloor ? value : null, max: asFloor ? null : value });

    // A stated limit implies the matching lean, unless one was given outright.
    if (!patch.goals.some((g) => g.nutrient === nutrient)) {
      patch.goals.push({ nutrient, direction: asFloor ? "high" : "low" });
    }
  };
  const QUAL = `(?:(${UNDER}|${OVER}|${ABOUT}) ?)?`;
  consume(new RegExp(`${QUAL}(\\d{1,4}) ?(?:g|grams?|mg|milligrams?)(\\+)? ?(?:of )?${NUTR}\\b`), (m) => limit(m[1], m[2], m[4], Boolean(m[3])));
  consume(new RegExp(`(${UNDER}|${OVER}) ?(\\d{1,4})(\\+)? ?${NUTR}\\b`), (m) => limit(m[1], m[2], m[4], Boolean(m[3])));
  consume(new RegExp(`\\b${NUTR} ?(${UNDER}|${OVER}) ?(\\d{1,4}) ?(?:g|grams?|mg|milligrams?)?\\b(?! ?(?:${CAL}\\b|dollars?|bucks?))`), (m) => limit(m[2], m[3], m[1]));

  // 5 ── Calories ────────────────────────────────────────────────────────────
  //
  // The distinction the old parser lost: "under 800" is a constraint,
  // "around 800" is a target, and a bare "800 cal" is read as a target because
  // that is how people use it ("an 800 calorie lunch").
  const calories = (qualifier: string | undefined, amount: string) => {
    const value = parseInt(amount, 10);
    if (!within(value, 50, 5000)) return;
    if (isUnder(qualifier)) patch.calories = { target: null, min: null, max: value };
    else if (isOver(qualifier)) patch.calories = { target: null, min: value, max: null };
    else patch.calories = { target: value, min: null, max: null };
  };

  consume(new RegExp(`(?:between |from )?(\\d{2,4})(?:-| to | and )(\\d{2,4}) ?${CAL}\\b`), (m) => {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)].sort((x, y) => x - y);
    if (within(a, 50, 5000) && within(b, 50, 5000)) patch.calories = { target: null, min: a, max: b };
  });
  consume(new RegExp(`(${UNDER}|${OVER}|${ABOUT}) ?(\\d{2,4}) ?${CAL}\\b`), (m) => calories(m[1], m[2]));
  consume(new RegExp(`(\\d{2,4}) ?${CAL} (or less|or fewer|or under|or below|max|maximum|tops)\\b`), (m) => calories("under", m[1]));
  consume(new RegExp(`(\\d{2,4}) ?${CAL} (or more|or over|or above|min|minimum)\\b`), (m) => calories("over", m[1]));
  consume(new RegExp(`(\\d{2,4})\\+ ?${CAL}\\b`), (m) => calories("over", m[1]));
  consume(new RegExp(`(\\d{2,4}) ?(?:ish )?${CAL}\\b`), (m) => calories(undefined, m[1]));
  // No unit at all: three or four digits after a qualifier can only be
  // calories; one or two digits after "under" can only be dollars.
  consume(new RegExp(`(${UNDER}|${OVER}|${ABOUT}) ?(\\d{3,4})\\b(?! ?(?:g\\b|grams?\\b|mg\\b))`), (m) => calories(m[1], m[2]));
  consume(new RegExp(`(${UNDER}) ?(\\d{1,2}(?:\\.\\d{1,2})?)\\b(?! ?(?:g\\b|grams?\\b|mg\\b|pc\\b|pcs\\b|ct\\b|piece|count|items?\\b))`), (m) => price(m[1], m[2]));

  // 6 ── Things we know we can't answer ──────────────────────────────────────
  consume(UNSUPPORTED, (m) => {
    if (!unsupported.includes(m[1])) unsupported.push(m[1]);
  });

  // 7 ── Goals ───────────────────────────────────────────────────────────────
  for (const rule of GOAL_RULES) {
    consume(rule.pattern, () => {
      for (const goal of rule.goals) {
        patch.goals = patch.goals.filter((g) => g.nutrient !== goal.nutrient);
        patch.goals.push(goal);
      }
    });
  }

  // 8 ── Preferences and relative nudges ─────────────────────────────────────
  consume(BUDGET, () => {
    patch.budget_priority = true;
  });
  consume(VARIETY, () => {
    patch.variety = true;
  });
  consume(BREAKFAST, () => {
    patch.daypart = "breakfast";
  });
  consume(ALL_DAY, () => {
    patch.daypart = "all-day";
  });
  consume(LIGHTER, () => {
    patch.nudgeCalories = "down";
  });
  consume(BIGGER, () => {
    patch.nudgeCalories = "up";
  });

  // 9 ── "no fries", "without beans or rice" ─────────────────────────────────
  //
  // After the goals on purpose: "no carbs" and "no fat" were consumed above, so
  // whatever follows a "no" here is a thing, not a nutrient.
  consume(EXCLUDE, (m) => {
    for (const phrase of m[1].split(/\s+(?:or|and|nor)\s+/)) {
      const cleaned = phrase.trim();
      if (cleaned) excludePhrases.push(cleaned);
    }
  });

  // 10 ── What's left ────────────────────────────────────────────────────────
  const leftover = text
    .split(" ")
    .filter((token) => token === SEP || (/[a-z]/.test(token) && !STOPWORDS.has(token)));

  // Collapse runs of separators and trim them from the ends.
  const tidy: string[] = [];
  for (const token of leftover) {
    if (token === SEP && (tidy.length === 0 || tidy[tidy.length - 1] === SEP)) continue;
    tidy.push(token);
  }
  while (tidy[tidy.length - 1] === SEP) tidy.pop();

  // 11 ── Was that a restaurant we've never heard of? ────────────────────────
  //
  // Only asked when nothing matched. Words that aren't food and aren't noise
  // are, in a query this short, almost always somebody's name for a place.
  if (!restaurant && !unknownRestaurant) {
    const candidate = tidy.filter((t) => t !== SEP && !FOOD_WORDS.has(t) && t.length > 1);
    if (candidate.length > 0 && candidate.length <= 4) {
      const name = titleCase(candidate.join(" "));
      unknownRestaurant = { name, slug: slugify(name), known: false };
    }
  }

  return { restaurant, unknownRestaurant, patch, excludePhrases, leftover: tidy, unsupported };
}

export const LEFTOVER_SEPARATOR = SEP;
