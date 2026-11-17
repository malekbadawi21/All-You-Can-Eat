import { SEED_DOCUMENTS } from "@/db/seed";
import type { Menu } from "../db";
import { classifyItem } from "../mealGrammar";
import type { MenuDocument, SourceInput } from "../menuDocument";

// ── Real menus, without a database ───────────────────────────────────────────
//
// The engine is a pure function of a menu, so its tests don't need SQLite —
// they need the menus. These are built straight from the seed documents, using
// the same rules the database writer applies, so a test here sees exactly the
// data production does.
//
// The earlier fixtures were hand-copied slices of two menus. That kept tests
// independent of the data, but every real defect so far has been a property of
// the *whole* menu (a Side Salad filed as a main, a breakfast taco weighted as
// a full main), and a slice chosen in advance is precisely what doesn't contain
// the item nobody thought about.

const source = (kind: "nutrition" | "price", s: SourceInput) => ({
  kind,
  name: s.name,
  url: s.url ?? null,
  market: s.market,
  fetched_at: s.fetched_at,
  method: s.method,
  notes: s.notes ?? null,
});

export function menuFromDocument(doc: MenuDocument, restaurantId = 1): Menu {
  let nextId = restaurantId * 1000;

  return {
    restaurant: {
      id: restaurantId,
      name: doc.restaurant.name,
      slug: doc.restaurant.slug,
      type: doc.restaurant.type,
      aliases: doc.restaurant.aliases ?? [],
      identity: doc.restaurant.identity ?? null,
      origin: "seed",
      position: restaurantId,
    },
    items: (doc.items ?? []).map((item) => {
      const guess = classifyItem(item.name, item.category);
      return {
        id: nextId++,
        name: item.name,
        category: item.category ?? guess.category,
        role: item.role ?? guess.role,
        daypart: item.daypart ?? guess.daypart,
        portion_weight: item.portion_weight ?? guess.weight,
        calories: item.calories,
        protein_g: item.protein_g,
        fat_g: item.fat_g,
        carbs_g: item.carbs_g,
        sodium_mg: item.sodium_mg,
        price: item.price ?? null,
        ...(item.price_estimated ? { price_estimated: true } : {}),
      };
    }),
    slots: (doc.slots ?? []).map((slot) => ({
      slot_name: slot.name,
      required: slot.required,
      pick: slot.pick,
      ...(slot.count_from ? { count_from: slot.count_from } : {}),
      options: slot.options.map((option) => ({
        id: nextId++,
        name: option.name,
        calories: option.calories,
        protein_g: option.protein_g,
        fat_g: option.fat_g,
        carbs_g: option.carbs_g,
        sodium_mg: option.sodium_mg,
        price: option.price ?? null,
        ...(option.price_estimated ? { price_estimated: true } : {}),
        ...(option.pick_counts ? { pick_counts: option.pick_counts } : {}),
      })),
    })),
    sources: {
      nutrition: source("nutrition", doc.sources.nutrition),
      price: doc.sources.price ? source("price", doc.sources.price) : null,
    },
  };
}

export const SEED_MENUS: Menu[] = SEED_DOCUMENTS.map((doc, i) => menuFromDocument(doc, i + 1));

export function menuOf(slug: string): Menu {
  const menu = SEED_MENUS.find((m) => m.restaurant.slug === slug);
  if (!menu) throw new Error(`No seed menu for "${slug}"`);
  return menu;
}

export const CATALOG = SEED_MENUS.map((m) => ({
  slug: m.restaurant.slug,
  name: m.restaurant.name,
  aliases: m.restaurant.aliases,
}));
