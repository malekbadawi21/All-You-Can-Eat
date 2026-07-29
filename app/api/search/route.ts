import { NextRequest, NextResponse } from "next/server";
import { parseQuery } from "@/lib/parseQuery";
import { getRestaurant, getMenuItems, getSlots } from "@/lib/db";
import { rankItems, recommendMeal, buildOrder, SlotSelection } from "@/lib/optimize";

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

  // ── Build-your-own (Chipotle) ─────────────────────────────────────────────
  //
  // Always return two options so users can make an informed choice:
  //   "Best nutrition match" — scored primarily on the user's stated goals
  //   "Best value"          — same goals, but price weighs in more heavily
  //
  // If both builds are identical (same components selected), return only one.

  const slots = getSlots(restaurant.id);

  const nutritionOrder = buildOrder(slots, goals, calorieTarget ?? undefined, false);
  const valueOrder     = buildOrder(slots, goals, calorieTarget ?? undefined, true);

  // Two builds are "the same" if every slot selects the same option IDs.
  const orderKey = (order: SlotSelection[]) =>
    order
      .flatMap((s) => s.selected.map((o) => o.id))
      .sort((a, b) => a - b)
      .join(",");

  const orderPrice = (order: SlotSelection[]) =>
    +order
      .reduce((sum, slot) => sum + slot.selected.reduce((s, o) => s + o.price, 0), 0)
      .toFixed(2);

  const options = [
    {
      label: "Best nutritional match",
      total_price: orderPrice(nutritionOrder),
      order: nutritionOrder,
    },
  ];

  if (orderKey(nutritionOrder) !== orderKey(valueOrder)) {
    options.push({
      label: "Best value",
      total_price: orderPrice(valueOrder),
      order: valueOrder,
    });
  }

  return NextResponse.json({
    restaurant: restaurant.name,
    query: q,
    goals,
    ...(calorieTarget ? { calorie_target: calorieTarget } : {}),
    budget_priority: budgetPriority,
    options,
  });
}
