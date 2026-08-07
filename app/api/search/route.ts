import { NextRequest, NextResponse } from "next/server";
import { parseQuery } from "@/lib/parseQuery";
import { getRestaurant, getMenuItems, getSlots } from "@/lib/db";
import { rankItems, recommendMeal, buildOrders } from "@/lib/optimize";

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q");

  if (!q) {
    return NextResponse.json(
      { error: "Missing required query param: q" },
      { status: 400 }
    );
  }

  const { restaurant: slug, goals, calorieTarget, budgetPriority } = parseQuery(q);

  if (!slug) {
    return NextResponse.json(
      {
        error:
          "No restaurant found in query. Try something like 'high protein from Chick-fil-A'.",
      },
      { status: 400 }
    );
  }

  const restaurant = getRestaurant(slug);
  if (!restaurant) {
    return NextResponse.json(
      { error: `Restaurant '${slug}' not found in database.` },
      { status: 404 }
    );
  }

  if (restaurant.type === "fixed") {
    const items = getMenuItems(restaurant.id);

    if (calorieTarget) {
      const recommendations = recommendMeal(
        items,
        goals,
        calorieTarget,
        3,
        budgetPriority
      );
      return NextResponse.json({
        restaurant: restaurant.name,
        query: q,
        goals,
        calorie_target: calorieTarget,
        budget_priority: budgetPriority,
        recommendations,
      });
    }

    return NextResponse.json({
      restaurant: restaurant.name,
      query: q,
      goals,
      budget_priority: budgetPriority,
      top_results: rankItems(items, goals, budgetPriority).slice(0, 10),
    });
  }

  // ── Build-your-own (Chipotle, Panda Express, Raising Cane's) ──────────────
  //
  // Returns up to three builds that satisfy the same query in different ways —
  // see BUILD_STRATEGIES in lib/optimize.ts:
  //   "Best match"   — the strongest answer to the question as asked
  //   "Balanced"     — nearly as strong, with less repetition
  //   "Most variety" — every component different, at some cost to the goal
  //
  // Which of these is "right" depends on the person, not the data. Repeating a
  // component is often the smart play (three Texas Toasts cost 420 calories
  // less than three fries for the same protein, which is what pays for a bigger
  // box of chicken) — but it isn't what everyone wants to eat.

  const slots = getSlots(restaurant.id);
  const options = buildOrders(slots, goals, calorieTarget ?? undefined, budgetPriority);

  return NextResponse.json({
    restaurant: restaurant.name,
    query: q,
    goals,
    ...(calorieTarget ? { calorie_target: calorieTarget } : {}),
    budget_priority: budgetPriority,
    options,
  });
}
