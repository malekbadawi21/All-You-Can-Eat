"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import type { StreetRestaurant } from "@/lib/restaurants";
import type { SearchError } from "@/lib/searchResult";
import SearchField from "./SearchField";

// ── The front door ───────────────────────────────────────────────────────────
//
// One box that takes the whole question — restaurant and criteria together —
// plus two ways in that need no typing: the list of restaurants on the street,
// and a walk down it.
//
// The restaurant list is real links (<a href="/restaurant/…">). With
// JavaScript they are intercepted and the camera flies there; without it, or
// on a middle-click, they are ordinary navigation to a page that is rendered
// on the server. Either way every storefront is reachable from here by
// keyboard, which the 3D street by itself could never promise.

const EXAMPLES = [
  "high protein Chick-fil-A around 800 calories",
  "cheapest burger under 500 calories at McDonald's",
  "keto Chipotle bowl, no rice",
];

export interface HomeError {
  message: string;
  code?: SearchError["code"];
  /** For unknown_restaurant: what was asked for. */
  requested?: SearchError["requested"];
}

export interface HomePanelProps {
  restaurants: StreetRestaurant[];
  busy: boolean;
  error: HomeError | null;
  onSearch: (query: string) => void;
  onVisit: (slug: string) => void;
  onExplore: () => void;
  /** False when the 3D street isn't available, so there is nothing to walk. */
  canExplore: boolean;
  /** Offered when a restaurant we don't have can be looked up. */
  onIngest?: (requested: NonNullable<SearchError["requested"]>) => void;
  ingesting?: boolean;
}

export default function HomePanel({
  restaurants,
  busy,
  error,
  onSearch,
  onVisit,
  onExplore,
  canExplore,
  onIngest,
  ingesting = false,
}: HomePanelProps) {
  const [query, setQuery] = useState("");

  // Let the browser handle anything that isn't a plain left click, so
  // "open in new tab" works the way links are supposed to.
  const visit = (slug: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onVisit(slug);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center overflow-y-auto px-4 pb-6 pt-[max(1.5rem,5vh)]">
      <header className="text-center">
        <h1 className="text-[2.6rem] font-extrabold leading-none tracking-tight text-ink [text-shadow:0_2px_0_rgb(255_253_249/0.55)] min-[900px]:text-6xl">
          All You Can Eat
        </h1>
        <p className="mt-2 text-lg font-semibold text-ink [text-shadow:0_1px_0_rgb(255_253_249/0.6)]">
          Say what you&apos;re after. We&apos;ll walk you to the door.
        </p>
      </header>

      <div className="pointer-events-auto mt-5 w-full max-w-2xl rounded-3xl border border-hairline bg-paper/95 p-3 shadow-[0_12px_48px_rgb(42_35_30/0.18)] backdrop-blur-sm min-[900px]:p-4">
        <SearchField
          label="What are you after, and where?"
          placeholder="high protein Chick-fil-A under 700 calories"
          action="Find food"
          busy={busy}
          onSubmit={onSearch}
          size="large"
          value={query}
          onChange={setQuery}
        />

        {error && (
          <div role="alert" className="mt-3 rounded-xl border border-[#E2B3A8] bg-[#FBE9E4] px-3.5 py-3 text-[0.95rem] leading-snug text-[#5E1F14]">
            <p className="font-semibold">{error.message}</p>
            {error.code === "unknown_restaurant" && error.requested?.can_ingest && onIngest && (
              <button
                type="button"
                onClick={() => onIngest(error.requested!)}
                aria-disabled={ingesting}
                className="mt-2 inline-flex min-h-11 items-center rounded-full bg-ink px-4 text-sm font-bold text-paper aria-disabled:opacity-60"
              >
                {ingesting ? "Looking it up…" : `Look up ${error.requested.name}`}
              </button>
            )}
            {error.code !== undefined && (
              <p className="mt-1">These are the restaurants on the street right now.</p>
            )}
          </div>
        )}

        <div className="mt-3 px-1">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">Try</h2>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(example);
                    onSearch(example);
                  }}
                  className="-mx-2 inline-flex min-h-10 items-center rounded-lg px-2 text-left text-[0.95rem] font-medium text-ink underline decoration-ink/25 underline-offset-4 transition-colors hover:decoration-ink min-[900px]:min-h-8"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <nav aria-label="Restaurants on the street" className="mt-3 border-t border-hairline px-1 pt-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-ink-soft">On this street</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {restaurants.map((r) => (
              <li key={r.slug}>
                <a
                  href={`/restaurant/${r.slug}`}
                  onClick={visit(r.slug)}
                  style={{ "--brand": r.identity.brand } as CSSProperties}
                  className="inline-flex min-h-10 items-center gap-2 rounded-full border border-hairline bg-card py-1 pl-2.5 pr-3.5 text-sm font-bold text-ink transition-colors hover:bg-sunk"
                >
                  <span aria-hidden="true" className="h-3 w-3 rounded-full bg-brand" />
                  {r.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {canExplore && (
        <button
          type="button"
          onClick={onExplore}
          className="pointer-events-auto mt-4 inline-flex min-h-12 items-center gap-2 rounded-full border border-hairline bg-paper/95 px-6 text-base font-bold text-ink shadow-[0_8px_30px_rgb(42_35_30/0.18)] backdrop-blur-sm transition-transform active:scale-[0.97]"
        >
          Walk the street
          <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
            <path d="M2 6h8M6.5 2.5L10 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
