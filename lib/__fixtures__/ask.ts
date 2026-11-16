import { parseQuery } from "../parseQuery";
import { searchMenu } from "../search";
import type { OrderResult, SearchResponse } from "../searchResult";
import { CATALOG, menuOf } from "./seedMenus";

// Test helpers that read like the product: ask a restaurant a question, get
// the response the API would give. Everything goes through the real parser and
// the real engine against the real seed menus — only the database and HTTP are
// left out.

/** One question at one restaurant. `context` continues a conversation. */
export function ask(slug: string, text: string, context?: string | null): SearchResponse {
  return searchMenu(menuOf(slug), {
    parsed: parseQuery(text, CATALOG),
    query: text,
    context,
    now: new Date("2026-11-16T12:00:00Z"),
  });
}

/** Several messages in a row at one restaurant, each building on the last. */
export function converse(slug: string, ...messages: string[]): SearchResponse {
  let response: SearchResponse | null = null;
  for (const message of messages) {
    response = ask(slug, message, response?.criteria.canonical ?? null);
  }
  return response!;
}

/** "2x Crunchy Taco + Chips" — for assertion messages that show the order. */
export const describeOrder = (r: OrderResult) =>
  `[${r.label}] ${r.total_calories} cal, ${r.total_protein_g}p ${r.total_carbs_g}c ${r.total_fat_g}f, $${r.total_price}: ` +
  r.items.map((i) => (i.quantity > 1 ? `${i.quantity}x ` : "") + i.name).join(" + ");

export const describeAll = (response: SearchResponse) =>
  response.results.map(describeOrder).join("\n");

export const FIXED = ["chick-fil-a", "mcdonalds", "taco-bell", "whataburger"] as const;
export const BUILD = ["chipotle", "panda-express", "raising-canes"] as const;
export const ALL = [...FIXED, ...BUILD] as const;

/** Every item name in an order, repeated by quantity. */
export const namesIn = (r: OrderResult) =>
  r.items.flatMap((i) => Array.from({ length: i.quantity }, () => i.name));

export const density = (r: OrderResult, key: "total_protein_g" | "total_carbs_g" | "total_fat_g") =>
  (r[key] / r.total_calories) * 100;
