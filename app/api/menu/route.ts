import { NextRequest, NextResponse } from "next/server";
import {
  getRestaurant,
  getAllRestaurants,
  getMenuItems,
  getSlots,
} from "@/lib/db";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("restaurant");

  if (!query) {
    return NextResponse.json(
      { error: "Missing required query param: restaurant" },
      { status: 400 }
    );
  }

  const slug = query.toLowerCase().trim();
  const restaurant = getRestaurant(slug);

  if (!restaurant) {
    const available = getAllRestaurants().map((r) => r.name);
    return NextResponse.json(
      { error: `Restaurant not found. Available: ${available.join(", ")}` },
      { status: 404 }
    );
  }

  if (restaurant.type === "fixed") {
    const items = getMenuItems(restaurant.id);
    return NextResponse.json({
      restaurant: restaurant.name,
      type: restaurant.type,
      count: items.length,
      items,
    });
  }

  // build-your-own (e.g. Chipotle)
  const slots = getSlots(restaurant.id);
  return NextResponse.json({
    restaurant: restaurant.name,
    type: restaurant.type,
    slots,
  });
}
