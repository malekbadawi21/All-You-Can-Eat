import Experience from "./components/Experience";
import { getStreet } from "@/lib/street";

// ── "/" — the street ─────────────────────────────────────────────────────────
//
// A server component: it reads the list of restaurants from the database and
// hands it to the client as props. That list decides what stands on the street,
// so it has to be current on every request — a restaurant ingested a minute
// ago should be there on reload — which is why this page opts out of being
// prerendered once at build time.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const restaurants = await getStreet();
  return <Experience restaurants={restaurants} initial={null} />;
}
