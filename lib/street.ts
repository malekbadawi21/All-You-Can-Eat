import { getAllRestaurants } from "./db";
import { identityFor, type StreetRestaurant } from "./restaurants";

// ── The street, as the page needs it ─────────────────────────────────────────
//
// Server-only: reads the restaurant list from the database and gives each one
// a storefront. A restaurant with a hand-authored identity keeps it; one
// without (anything dynamically ingested) gets a generated one. The result is
// plain data that can be handed to the client as props.

export async function getStreet(): Promise<StreetRestaurant[]> {
  const restaurants = await getAllRestaurants();
  return restaurants.map((r) => ({
    slug: r.slug,
    name: r.name,
    identity: identityFor(r.slug, r.identity),
  }));
}
