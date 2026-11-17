import Link from "next/link";
import { getStreet } from "@/lib/street";

// Shown for any URL that isn't a page — including /restaurant/<something we
// don't have>. It lists what *is* on the street, so a bad link is one click
// from a good one.
export default async function NotFound() {
  const restaurants = await getStreet().catch(() => []);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#B7DCEC] px-4 py-10">
      <div className="w-full max-w-lg rounded-3xl border border-hairline bg-paper p-6 text-center shadow-[0_12px_48px_rgb(42_35_30/0.18)]">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">That&apos;s not on this street</h1>
        <p className="mt-2 text-ink-soft">We don&apos;t have a page at that address. These are the places we do have:</p>
        <ul className="mt-4 flex flex-wrap justify-center gap-1.5">
          {restaurants.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/restaurant/${r.slug}`}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-hairline bg-card py-1 pl-2.5 pr-3.5 text-sm font-bold text-ink hover:bg-sunk"
              >
                <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: r.identity.brand }} />
                {r.name}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-sm font-bold text-paper">
          Back to the street
        </Link>
      </div>
    </main>
  );
}
