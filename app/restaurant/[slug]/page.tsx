import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Experience from "@/app/components/Experience";
import { runSearch } from "@/lib/searchService";
import { getStreet } from "@/lib/street";

// ── "/restaurant/[slug]" — one storefront, linkable ──────────────────────────
//
//   /restaurant/chipotle                         what we'd order there
//   /restaurant/chipotle?q=high protein, no rice  that exact search
//
// The search runs here, on the server, so the orders are in the HTML that
// arrives: the page is readable before any JavaScript has run, by a screen
// reader, a crawler, or a browser with no WebGL. The client then takes over
// the same state and carries on the conversation from it.
//
// `q` is the canonical criteria text the API hands back (criteria.canonical),
// which is what makes a link restore a search exactly.
//
// In this version of Next, `params` and `searchParams` are Promises.

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

async function load(props: PageProps) {
  const { slug } = await props.params;
  const q = first((await props.searchParams).q).slice(0, 200);

  const restaurants = await getStreet();
  const restaurant = restaurants.find((r) => r.slug === slug);
  if (!restaurant) return null;

  let outcome = await runSearch({ q, restaurant: slug });
  // A query that can't be answered (it names a chain we don't carry, say)
  // shouldn't break the page for a restaurant we do have. Fall back to the
  // plain menu.
  if (outcome.status !== 200) outcome = await runSearch({ q: "", restaurant: slug });
  if (outcome.status !== 200) return null;

  return { slug, q, restaurants, restaurant, response: outcome.body };
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const data = await load(props);
  if (!data) return { title: "Not on this street — All You Can Eat" };

  const { restaurant, response } = data;
  const what = response.criteria.summary;
  const best = response.results[0];

  return {
    title: what
      ? `${restaurant.name}: ${what} — All You Can Eat`
      : `What to order at ${restaurant.name} — All You Can Eat`,
    description: best
      ? `${best.label}: ${best.items.map((i) => (i.quantity > 1 ? `${i.quantity}× ` : "") + i.name).join(", ")} — ${best.total_calories} calories, ${Math.round(best.total_protein_g)}g protein.`
      : `Orders worth placing at ${restaurant.name}, ranked against your goals.`,
  };
}

export default async function RestaurantPage(props: PageProps) {
  const data = await load(props);
  if (!data) notFound();

  // "?q=what about taco bell" on Chipotle's page: the answer belongs to another
  // restaurant, so send the visitor to that restaurant's own URL.
  if (data.response.restaurant.slug !== data.slug) {
    redirect(`/restaurant/${data.response.restaurant.slug}`);
  }

  return (
    <Experience
      restaurants={data.restaurants}
      initial={{ slug: data.slug, response: data.response, said: data.q || null }}
    />
  );
}
