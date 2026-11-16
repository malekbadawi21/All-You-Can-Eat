// ── Restaurants we know *of* ─────────────────────────────────────────────────
//
// Separate from the restaurants we have menus for (those live in the
// database). This is a plain directory of well-known chains, and it exists for
// one reason: when someone types "high protein wendys", the honest answer is
// "we don't have Wendy's yet", not "no restaurant found in your search".
//
// Telling those two apart needs a list of names to recognise. A chain here has
// no menu, no numbers and no storefront — only a name, the spellings people
// use for it, and a slug to give it if it is ever ingested.
//
// Names of businesses are facts, not brand assets; nothing here is a logo or
// trade dress.

export interface KnownChain {
  slug: string;
  name: string;
  /** Lower-case, apostrophes dropped, hyphens as spaces — see squash(). */
  aliases: string[];
}

export const KNOWN_CHAINS: KnownChain[] = [
  { slug: "wendys", name: "Wendy's", aliases: ["wendys", "wendy s"] },
  { slug: "burger-king", name: "Burger King", aliases: ["burger king", "burgerking", "bk"] },
  { slug: "subway", name: "Subway", aliases: ["subway"] },
  { slug: "kfc", name: "KFC", aliases: ["kfc", "kentucky fried chicken"] },
  { slug: "popeyes", name: "Popeyes", aliases: ["popeyes", "popeye s"] },
  { slug: "pizza-hut", name: "Pizza Hut", aliases: ["pizza hut", "pizzahut"] },
  { slug: "dominos", name: "Domino's", aliases: ["dominos", "domino s"] },
  { slug: "papa-johns", name: "Papa John's", aliases: ["papa johns", "papa john s"] },
  { slug: "little-caesars", name: "Little Caesars", aliases: ["little caesars", "little caesar s"] },
  { slug: "arbys", name: "Arby's", aliases: ["arbys", "arby s"] },
  { slug: "sonic", name: "Sonic", aliases: ["sonic", "sonic drive in"] },
  { slug: "jack-in-the-box", name: "Jack in the Box", aliases: ["jack in the box"] },
  { slug: "five-guys", name: "Five Guys", aliases: ["five guys", "5 guys"] },
  { slug: "in-n-out", name: "In-N-Out", aliases: ["in n out", "in and out", "innout"] },
  { slug: "shake-shack", name: "Shake Shack", aliases: ["shake shack", "shakeshack"] },
  { slug: "culvers", name: "Culver's", aliases: ["culvers", "culver s"] },
  { slug: "dairy-queen", name: "Dairy Queen", aliases: ["dairy queen", "dq"] },
  { slug: "carls-jr", name: "Carl's Jr.", aliases: ["carls jr", "carl s jr"] },
  { slug: "hardees", name: "Hardee's", aliases: ["hardees", "hardee s"] },
  { slug: "white-castle", name: "White Castle", aliases: ["white castle"] },
  { slug: "zaxbys", name: "Zaxby's", aliases: ["zaxbys", "zaxby s"] },
  { slug: "wingstop", name: "Wingstop", aliases: ["wingstop", "wing stop"] },
  { slug: "bojangles", name: "Bojangles", aliases: ["bojangles"] },
  { slug: "el-pollo-loco", name: "El Pollo Loco", aliases: ["el pollo loco"] },
  { slug: "del-taco", name: "Del Taco", aliases: ["del taco"] },
  { slug: "qdoba", name: "Qdoba", aliases: ["qdoba"] },
  { slug: "moes", name: "Moe's", aliases: ["moes", "moe s"] },
  { slug: "jimmy-johns", name: "Jimmy John's", aliases: ["jimmy johns", "jimmy john s"] },
  { slug: "jersey-mikes", name: "Jersey Mike's", aliases: ["jersey mikes", "jersey mike s"] },
  { slug: "firehouse-subs", name: "Firehouse Subs", aliases: ["firehouse subs", "firehouse"] },
  { slug: "panera", name: "Panera Bread", aliases: ["panera", "panera bread"] },
  { slug: "starbucks", name: "Starbucks", aliases: ["starbucks"] },
  { slug: "dunkin", name: "Dunkin'", aliases: ["dunkin", "dunkin donuts"] },
  { slug: "cava", name: "Cava", aliases: ["cava"] },
  { slug: "sweetgreen", name: "Sweetgreen", aliases: ["sweetgreen"] },
  { slug: "noodles-and-company", name: "Noodles & Company", aliases: ["noodles and company", "noodles company"] },
  { slug: "wawa", name: "Wawa", aliases: ["wawa"] },
  { slug: "dennys", name: "Denny's", aliases: ["dennys", "denny s"] },
  { slug: "ihop", name: "IHOP", aliases: ["ihop"] },
  { slug: "applebees", name: "Applebee's", aliases: ["applebees", "applebee s"] },
  { slug: "chilis", name: "Chili's", aliases: ["chilis", "chili s"] },
  { slug: "olive-garden", name: "Olive Garden", aliases: ["olive garden"] },
  { slug: "cracker-barrel", name: "Cracker Barrel", aliases: ["cracker barrel"] },
  { slug: "tgi-fridays", name: "TGI Fridays", aliases: ["tgi fridays", "tgi friday s", "fridays"] },
  { slug: "long-john-silvers", name: "Long John Silver's", aliases: ["long john silvers", "long john silver s"] },
  { slug: "krystal", name: "Krystal", aliases: ["krystal"] },
  { slug: "checkers", name: "Checkers", aliases: ["checkers", "rallys", "rally s"] },
  { slug: "smashburger", name: "Smashburger", aliases: ["smashburger"] },
];

export const chainBySlug = (slug: string): KnownChain | undefined =>
  KNOWN_CHAINS.find((c) => c.slug === slug);
