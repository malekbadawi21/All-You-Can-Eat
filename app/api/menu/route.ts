import { NextRequest, NextResponse } from "next/server";
import { getAllRestaurants, getMenu } from "@/lib/db";

// ── GET /api/menu?restaurant=<slug> ──────────────────────────────────────────
//
// The raw menu for one restaurant, with the sources its figures came from.
// The search endpoint answers "what should I order"; this one answers "what is
// there", and is what lets anyone check a recommendation against the data.

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("restaurant");

  if (!query) {
    return NextResponse.json(
      { error: "Missing required query param: restaurant" },
      { status: 400 }
    );
  }

  const menu = await getMenu(query.toLowerCase().trim());

  if (!menu) {
    const available = (await getAllRestaurants()).map((r) => r.slug);
    return NextResponse.json(
      { error: "Restaurant not found.", available },
      { status: 404 }
    );
  }

  const { restaurant, items, slots, sources } = menu;

  return NextResponse.json({
    restaurant: { name: restaurant.name, slug: restaurant.slug, type: restaurant.type },
    sources,
    ...(restaurant.type === "fixed" ? { count: items.length, items } : { slots }),
  });
}
