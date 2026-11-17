import { classifyItem, type MealRole, type Daypart } from "./mealGrammar";
import type { StorefrontIdentity } from "./restaurants";

// ── The one format a menu arrives in ─────────────────────────────────────────
//
// A MenuDocument is a whole restaurant in one JSON object: who they are, where
// the numbers came from, and the menu itself. The seed files in db/seed/ are
// MenuDocuments. So is what the USDA adapter produces, and so is a file someone
// hands to `npm run ingest`. Everything that writes a restaurant to the
// database goes through the same validation and the same writer, which is what
// lets "the seed" and "dynamic ingestion" be one code path instead of two.
//
// The format's one firm opinion is about provenance: a document with no
// nutrition source is rejected, and so is a document that states prices
// without saying where they came from. There is no way to load a number into
// this app without also saying where it was read.

export interface SourceInput {
  /** Human-readable: "Chick-fil-A published nutrition information". */
  name: string;
  /** Where a reader can check the figures. Null only when none was recorded. */
  url?: string | null;
  /** What geography the figures describe: "US", "US national average". */
  market: string;
  /** When the figures were read from the source, as an ISO date. */
  fetched_at: string;
  /** How they got here: "manual-transcription", "usda-fdc-api", "file-import". */
  method: string;
  license?: string | null;
  notes?: string | null;
}

export interface NutritionInput {
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sodium_mg: number;
}

export interface MenuItemInput extends NutritionInput {
  name: string;
  /** Display grouping — "burger", "taco". Not used to judge meal structure. */
  category?: string;
  /** Left out, these three are inferred from the name and category. */
  role?: MealRole;
  daypart?: Daypart;
  portion_weight?: number;
  /** Null or absent means "we don't know", never "free". */
  price?: number | null;
  /** True when the price is interpolated rather than read from a source. */
  price_estimated?: boolean;
}

export interface ComponentInput extends NutritionInput {
  name: string;
  price?: number | null;
  price_estimated?: boolean;
  pick_counts?: Record<string, number>;
}

export interface SlotInput {
  name: string;
  required: boolean;
  pick: "1" | "many";
  count_from?: string;
  options: ComponentInput[];
}

export interface MenuDocument {
  restaurant: {
    slug: string;
    name: string;
    type: "fixed" | "build-your-own";
    /** Lower-case spellings the query parser should recognise. */
    aliases?: string[];
    /** Hand-authored storefront. Absent means one is generated from the slug. */
    identity?: StorefrontIdentity | null;
  };
  sources: {
    nutrition: SourceInput;
    price?: SourceInput | null;
  };
  items?: MenuItemInput[];
  slots?: SlotInput[];
}

export interface ValidationResult {
  /** Problems that make the document unusable. Empty means it can be loaded. */
  errors: string[];
  /** Things worth a human's attention that don't block loading. */
  warnings: string[];
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ROOFS = ["hip", "flat", "gable", "pagoda", "aframe"];

/** Generous ceilings — their job is to catch a misplaced decimal, not to judge food. */
const LIMITS: Record<keyof NutritionInput, number> = {
  calories: 4000,
  protein_g: 300,
  fat_g: 300,
  carbs_g: 600,
  sodium_mg: 12000,
};

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function checkSource(label: string, s: SourceInput | null | undefined, errors: string[]) {
  if (!s || typeof s !== "object") {
    errors.push(`${label}: missing`);
    return;
  }
  if (!isText(s.name)) errors.push(`${label}.name: required`);
  if (!isText(s.market)) errors.push(`${label}.market: required`);
  if (!isText(s.method)) errors.push(`${label}.method: required`);
  if (!isText(s.fetched_at) || !ISO_DATE.test(s.fetched_at) || Number.isNaN(Date.parse(s.fetched_at))) {
    errors.push(`${label}.fetched_at: must be an ISO date, got ${JSON.stringify(s.fetched_at)}`);
  }
  if (s.url != null && !/^https?:\/\/\S+$/.test(s.url)) {
    errors.push(`${label}.url: must be an http(s) URL or null`);
  }
}

function checkNutrition(
  label: string,
  n: NutritionInput,
  errors: string[],
  warnings: string[]
) {
  for (const key of Object.keys(LIMITS) as (keyof NutritionInput)[]) {
    const v = n[key];
    if (!isNum(v) || v < 0) errors.push(`${label}.${key}: must be a number ≥ 0`);
    else if (v > LIMITS[key]) errors.push(`${label}.${key}: ${v} is implausibly large`);
  }
  if ([n.calories, n.protein_g, n.fat_g, n.carbs_g].every(isNum) && n.calories >= 100) {
    // Atwater factors: 4 kcal per gram of protein or carbohydrate, 9 per gram
    // of fat. Labels round, and fibre and sugar alcohols count for less, so
    // this only flags gaps too large to be rounding.
    const implied = 4 * n.protein_g + 4 * n.carbs_g + 9 * n.fat_g;
    const off = Math.abs(implied - n.calories) / n.calories;
    if (off > 0.3) {
      warnings.push(
        `${label}: stated ${n.calories} cal but macros imply ~${Math.round(implied)} — worth re-checking against the source`
      );
    }
  }
}

function checkPrice(label: string, price: unknown, errors: string[]) {
  if (price == null) return;
  if (!isNum(price) || price < 0 || price > 200) {
    errors.push(`${label}.price: must be a number between 0 and 200, or null`);
  }
}

export function validateMenuDocument(doc: MenuDocument): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!doc || typeof doc !== "object") return { errors: ["document is not an object"], warnings };

  const r = doc.restaurant;
  if (!r || typeof r !== "object") {
    errors.push("restaurant: missing");
    return { errors, warnings };
  }
  if (!isText(r.slug) || !SLUG.test(r.slug)) errors.push("restaurant.slug: must be lower-case kebab-case");
  if (!isText(r.name) || r.name.length > 60) errors.push("restaurant.name: required, at most 60 characters");
  if (r.type !== "fixed" && r.type !== "build-your-own") errors.push('restaurant.type: must be "fixed" or "build-your-own"');
  if (r.aliases && (!Array.isArray(r.aliases) || r.aliases.some((a) => !isText(a) || a !== a.toLowerCase()))) {
    errors.push("restaurant.aliases: must be lower-case strings");
  }
  if (r.identity) {
    const i = r.identity;
    for (const key of ["brand", "trim", "ink"] as const) {
      if (!HEX.test(i[key] ?? "")) errors.push(`restaurant.identity.${key}: must be a #RRGGBB colour`);
    }
    if (!ROOFS.includes(i.roof)) errors.push(`restaurant.identity.roof: must be one of ${ROOFS.join(", ")}`);
    for (const key of ["width", "depth", "height"] as const) {
      if (!isNum(i[key]) || i[key] < 4 || i[key] > 20) errors.push(`restaurant.identity.${key}: must be between 4 and 20`);
    }
  }

  checkSource("sources.nutrition", doc.sources?.nutrition, errors);
  if (doc.sources?.price) checkSource("sources.price", doc.sources.price, errors);

  const items = doc.items ?? [];
  const slots = doc.slots ?? [];
  let anyPrice = false;

  if (r.type === "fixed") {
    if (items.length === 0) errors.push("items: a fixed-menu restaurant needs at least one item");
    if (slots.length > 0) errors.push("slots: not allowed on a fixed-menu restaurant");
    const seen = new Set<string>();
    items.forEach((item, idx) => {
      const label = `items[${idx}]${isText(item?.name) ? ` (${item.name})` : ""}`;
      if (!isText(item?.name)) return void errors.push(`${label}.name: required`);
      if (seen.has(item.name)) errors.push(`${label}: duplicate item name`);
      seen.add(item.name);
      checkNutrition(label, item, errors, warnings);
      checkPrice(label, item.price, errors);
      if (item.price != null) anyPrice = true;
      if (item.role && !["main", "side", "dessert"].includes(item.role)) errors.push(`${label}.role: invalid`);
      if (item.daypart && !["all-day", "breakfast"].includes(item.daypart)) errors.push(`${label}.daypart: invalid`);
      if (item.portion_weight != null && (!isNum(item.portion_weight) || item.portion_weight <= 0 || item.portion_weight > 2)) {
        errors.push(`${label}.portion_weight: must be between 0 and 2`);
      }
    });
    if (items.length > 0 && !items.some((i) => (i.role ?? classifyItem(i.name, i.category).role) === "main")) {
      errors.push("items: no item is a main, so no order could ever be built");
    }
  } else if (r.type === "build-your-own") {
    if (slots.length === 0) errors.push("slots: a build-your-own restaurant needs at least one slot");
    if (items.length > 0) errors.push("items: not allowed on a build-your-own restaurant");
    const names = new Set(slots.map((s) => s?.name));
    if (names.size !== slots.length) errors.push("slots: slot names must be unique");
    slots.forEach((slot, sIdx) => {
      const label = `slots[${sIdx}]${isText(slot?.name) ? ` (${slot.name})` : ""}`;
      if (!isText(slot?.name)) return void errors.push(`${label}.name: required`);
      if (typeof slot.required !== "boolean") errors.push(`${label}.required: must be true or false`);
      if (slot.pick !== "1" && slot.pick !== "many") errors.push(`${label}.pick: must be "1" or "many"`);
      if (slot.count_from && !names.has(slot.count_from)) errors.push(`${label}.count_from: no slot named "${slot.count_from}"`);
      if (!Array.isArray(slot.options) || slot.options.length === 0) {
        return void errors.push(`${label}.options: needs at least one option`);
      }
      slot.options.forEach((option, oIdx) => {
        const oLabel = `${label}.options[${oIdx}]${isText(option?.name) ? ` (${option.name})` : ""}`;
        if (!isText(option?.name)) return void errors.push(`${oLabel}.name: required`);
        checkNutrition(oLabel, option, errors, warnings);
        checkPrice(oLabel, option.price, errors);
        if (option.price != null) anyPrice = true;
        for (const target of Object.keys(option.pick_counts ?? {})) {
          if (!names.has(target)) errors.push(`${oLabel}.pick_counts: no slot named "${target}"`);
        }
      });
    });
  }

  if (anyPrice && !doc.sources?.price) {
    errors.push("sources.price: required because the document states prices — a price needs a source");
  }

  return { errors, warnings };
}

/** Throws with every problem listed, so a bad file is fixed in one pass. */
export function assertValidMenuDocument(doc: MenuDocument): string[] {
  const { errors, warnings } = validateMenuDocument(doc);
  if (errors.length > 0) {
    const who = doc?.restaurant?.slug ?? "menu document";
    throw new Error(`Invalid ${who}:\n  - ${errors.join("\n  - ")}`);
  }
  return warnings;
}
