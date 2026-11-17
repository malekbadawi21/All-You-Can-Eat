import { NextRequest, NextResponse } from "next/server";
import { runSearch } from "@/lib/searchService";

// ── GET /api/search ──────────────────────────────────────────────────────────
//
//   q           what the user typed
//   restaurant  slug of the storefront they're standing at (optional)
//   context     `criteria.canonical` from the previous response (optional)
//
// With only `q`, the restaurant has to be named in the text: this is the home
// page's one-box search. With `restaurant`, `q` is criteria only ("under 600
// calories") and may even be empty. With `context`, the message is applied on
// top of what was already in force — "cheaper", "no rice" — which is how the
// in-restaurant conversation keeps its thread without the server storing one.
//
// The response shape is defined in lib/searchResult.ts. This file is only the
// HTTP wrapper; the work is in lib/searchService.ts.

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const outcome = await runSearch({
    q: params.get("q"),
    restaurant: params.get("restaurant"),
    context: params.get("context"),
  });

  return NextResponse.json(outcome.body, { status: outcome.status });
}
