import { NextRequest, NextResponse } from "next/server";
import { parseQuery } from "@/lib/parseQuery";
import { getRestaurant, getAllRestaurants, getMenuItems, getSlots } from "@/lib/db";
import { recommendMeal, buildOrders } from "@/lib/optimize";
import {
  fromMealCombination,
  fromBuildOption,
  type SearchResponse,
  type SearchError,
} from "@/lib/searchResult";

// Long enough for any real request ("high protein low carb order at chick fil a
// around 800 calories" is 62), short enough that the combinatorial search can
// never be handed something pathological.
const MAX_QUERY_LENGTH = 200;

const fail = (error: SearchError, status: number) =>
  NextResponse.json(error, { status });

export async function GET(request: NextRequest) {
  // ── Validate the input before anything touches the database ───────────────
  const raw = request.nextUrl.searchParams.get("q");

  if (raw === null || raw.trim() === "") {
    return fail(
      {
        error: "Missing required query param: q",
        code: "missing_query",
      },
      400
    );
  }

  if (raw.length > MAX_QUERY_LENGTH) {
    return fail(
      {
        error: `Query is too long (${raw.length} characters, max ${MAX_QUERY_LENGTH}).`,
        code: "query_too_long",
      },
      400
    );
  }

  const q = raw.trim();
  const { restaurant: slug, goals, calorieTarget, budgetPriority } = parseQuery(q);

  if (!slug) {
    return fail(
      {
        error:
          "No restaurant found in your search. Try something like 'high protein from Chick-fil-A'.",
        code: "no_restaurant",
        available: getAllRestaurants().map((r) => r.name),
      },
      400
    );
  }

  const restaurant = getRestaurant(slug);
  if (!restaurant) {
    return fail(
      {
        error: `We don't have ${slug} yet.`,
        code: "unknown_restaurant",
        available: getAllRestaurants().map((r) => r.name),
      },
      404
    );
  }

  // ── One response shape, whichever data model the restaurant uses ──────────
  //
  // Fixed menus rank combinations of menu items; build-your-own restaurants
  // search across slots. Both produce "orders you could place", so both are
  // mapped into OrderResult and the caller doesn't have to care which happened.
  //
  // Note there is no separate no-calorie-target branch any more. It used to
  // return a flat list of the ten best individual items, which meant the meal
  // grammar — shapes, labels, combinations — only ever activated if the user
  // typed a calorie number. Since the homepage's restaurant buttons search
  // without one, the primary path was the one path with none of that work in
  // it. recommendMeal() now handles an absent target the same way buildOrders()
  // always has: bound the calories, drop calorie proximity from the score.

  const results =
    restaurant.type === "fixed"
      ? recommendMeal(
          getMenuItems(restaurant.id),
          goals,
          calorieTarget ?? undefined,
          3,
          budgetPriority
        ).map(fromMealCombination)
      : buildOrders(
          getSlots(restaurant.id),
          goals,
          calorieTarget ?? undefined,
          budgetPriority
        ).map(fromBuildOption);

  const response: SearchResponse = {
    restaurant: {
      name: restaurant.name,
      slug: restaurant.slug,
      type: restaurant.type,
    },
    query: q,
    goals,
    calorie_target: calorieTarget,
    budget_priority: budgetPriority,
    results,
  };

  return NextResponse.json(response);
}
