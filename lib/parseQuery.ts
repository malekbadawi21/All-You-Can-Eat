export type NutrientKey = "calories" | "protein_g" | "fat_g" | "carbs_g" | "sodium_mg";
export type Direction = "high" | "low";

export interface Goal {
  nutrient: NutrientKey;
  direction: Direction;
}

export interface ParsedQuery {
  restaurant: string | null;
  goals: Goal[];
  calorieTarget: number | null;
  budgetPriority: boolean;
  variety: boolean;
}

const GOAL_KEYWORDS: { triggers: string[]; goal: Goal }[] = [
  {
    triggers: ["high protein", "protein", "muscle", "gains", "bulking"],
    goal: { nutrient: "protein_g", direction: "high" },
  },
  {
    triggers: ["low carb", "low carbs", "keto", "no carbs", "no carb"],
    goal: { nutrient: "carbs_g", direction: "low" },
  },
  {
    triggers: ["low calorie", "low cal", "low calories", "diet", "light", "cutting"],
    goal: { nutrient: "calories", direction: "low" },
  },
  {
    triggers: ["low fat", "lean", "no fat"],
    goal: { nutrient: "fat_g", direction: "low" },
  },
  {
    triggers: ["low sodium", "low salt", "heart healthy"],
    goal: { nutrient: "sodium_mg", direction: "low" },
  },
];

const KNOWN_RESTAURANTS: { triggers: string[]; slug: string }[] = [
  { triggers: ["chick-fil-a", "chick fil a", "chickfila", "cfa"], slug: "chick-fil-a"   },
  { triggers: ["mcdonald's", "mcdonalds", "mcd", "mickey d's"],   slug: "mcdonalds"     },
  { triggers: ["chipotle"],                                        slug: "chipotle"      },
  { triggers: ["taco bell", "tacobell", "tb"],                     slug: "taco-bell"     },
  { triggers: ["panda express", "pandaexpress", "panda"],          slug: "panda-express" },
  { triggers: ["raising cane's", "raising canes", "cane's", "canes"], slug: "raising-canes" },
  { triggers: ["whataburger"],                                     slug: "whataburger"   },
];

const BUDGET_KEYWORDS = [
  "cheapest", "cheap", "budget", "affordable", "on a budget", "best value",
  "save money", "inexpensive", "low cost", "low price",
];

const VARIETY_KEYWORDS = [ 
  "variety", "mix it up", "switch it up",
];

export function parseQuery(raw: string): ParsedQuery {
  const query = raw.toLowerCase().trim().replace(/\s+/g, " ");

  let restaurant: string | null = null;
  for (const entry of KNOWN_RESTAURANTS) {
    if (entry.triggers.some((t) => query.includes(t))) {
      restaurant = entry.slug;
      break;
    }
  }

  const seenNutrients = new Set<NutrientKey>();
  const goals: Goal[] = [];

  for (const entry of GOAL_KEYWORDS) {
    if (entry.triggers.some((t) => query.includes(t))) {
      if (!seenNutrients.has(entry.goal.nutrient)) {
        seenNutrients.add(entry.goal.nutrient);
        goals.push(entry.goal);
      }
    }
  }

  const calorieTarget = parseCalorieTarget(query);
  const budgetPriority = BUDGET_KEYWORDS.some((kw) => query.includes(kw));
  const variety = VARIETY_KEYWORDS.some((kw) => query.includes(kw));

  return { restaurant, goals, calorieTarget, budgetPriority, variety };
}

// Extracts a calorie target from phrases like:
//   "around 600 calories", "600 cal", "~700", "500 to 700 cal"
function parseCalorieTarget(query: string): number | null {
  // Range: "500-700 cal" or "500 to 700 calories" → average
  const rangeMatch = query.match(
    /(\d{3,4})\s*(?:-|to)\s*(\d{3,4})\s*cal(?:ories?)?/
  );
  if (rangeMatch) {
    const avg = (parseInt(rangeMatch[1]) + parseInt(rangeMatch[2])) / 2;
    if (avg >= 100 && avg <= 5000) return Math.round(avg);
  }

  // Exact with unit: "600 calories" or "600 cal"
  const exactMatch = query.match(/(\d{3,4})\s*cal(?:ories?)?/);
  if (exactMatch) {
    const val = parseInt(exactMatch[1]);
    if (val >= 100 && val <= 5000) return val;
  }

  // Qualified without unit: "around 600", "about 700", "~600"
  const approxMatch = query.match(/(?:around|about|~)\s*(\d{3,4})/);
  if (approxMatch) {
    const val = parseInt(approxMatch[1]);
    if (val >= 100 && val <= 5000) return val;
  }

  return null;
}
