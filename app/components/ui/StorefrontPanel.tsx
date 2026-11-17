"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { CriteriaChip } from "@/lib/criteria";
import type { StreetRestaurant } from "@/lib/restaurants";
import type { Provenance, SearchResponse } from "@/lib/searchResult";
import OrderCard from "./OrderCard";
import SearchField from "./SearchField";
import { announcementFor, monthYear, replyFor, suggestionsFor, type Turn } from "./conversation";

// ── Ordering at a restaurant ─────────────────────────────────────────────────
//
// The conversation. You say what you're after; the answer is a short reply and
// a stack of order cards; you say what to change — "cheaper", "no rice",
// "under 600 calories" — and it changes that and keeps the rest.
//
// What is in force is always visible as chips under the name, each removable,
// so the state of the conversation is never something you have to remember or
// scroll back to find.
//
// On a wide screen this is a panel docked to the right, with the storefront
// framed in the space beside it. On a phone it is a sheet that rises from the
// bottom and can be tucked down to look at the building.

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="note"
      className="flex gap-2.5 rounded-xl border border-[#E2C989] bg-[#FBF0D2] px-3 py-2.5 text-sm leading-snug text-[#4A3A12]"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 4.5v4.2M8 11v.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </p>
  );
}

function ProvenanceLine({ nutrition, price }: { nutrition: Provenance | null; price: Provenance | null }) {
  return (
    <footer className="px-1 pb-1 pt-2 text-xs leading-relaxed text-ink-soft">
      {nutrition && (
        <p>
          Nutrition:{" "}
          {nutrition.url ? (
            <a href={nutrition.url} className="underline underline-offset-2" target="_blank" rel="noreferrer">
              {nutrition.source}
            </a>
          ) : (
            nutrition.source
          )}
          , as of {monthYear(nutrition.fetched_at)}
          {nutrition.stale && " — this may be out of date"}.
        </p>
      )}
      {price ? (
        <p>
          Prices are approximate: {price.market.toLowerCase()}, {monthYear(price.fetched_at)}
          {price.stale && " — these may be out of date"}. Yours will differ.
        </p>
      ) : (
        <p>We don&apos;t have price data for this restaurant yet.</p>
      )}
    </footer>
  );
}

export interface StorefrontPanelProps {
  restaurant: StreetRestaurant;
  turns: Turn[];
  busy: boolean;
  onSend: (message: string) => void;
  onRemoveChip: (chip: CriteriaChip) => void;
  onBack: () => void;
  /** Where "back" goes: "Home" or "Street". */
  backLabel: string;
  /** Which order (by index) has the pointer or focus, for the window highlight. */
  onAttention: (index: number | null) => void;
  /** Phone only: whether the sheet is raised. */
  sheetOpen: boolean;
  onToggleSheet: () => void;
}

export default function StorefrontPanel({
  restaurant,
  turns,
  busy,
  onSend,
  onRemoveChip,
  onBack,
  backLabel,
  onAttention,
  sheetOpen,
  onToggleSheet,
}: StorefrontPanelProps) {
  const latest = turns[turns.length - 1];
  // The response whose criteria and orders are on show: the newest one that
  // actually arrived. While a new request is in flight the previous answer
  // stays put, so the panel never empties and jumps.
  const settled: SearchResponse | undefined = [...turns].reverse().find((t) => t.response)?.response;
  const chips = settled?.criteria.chips ?? [];

  const logRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Bring the newest exchange to the top of the scroll area as it arrives.
  useEffect(() => {
    const log = logRef.current;
    const node = latestRef.current;
    if (!log || !node || turns.length < 2) return;
    // Measured, not read from offsetTop: that is relative to the nearest
    // positioned ancestor, which is the whole panel rather than the scroll area.
    const top = node.getBoundingClientRect().top - log.getBoundingClientRect().top + log.scrollTop;
    log.scrollTo({ top: Math.max(0, top - 4), behavior: "smooth" });
  }, [turns.length, latest?.status]);

  // Arriving at a restaurant moves focus to its name, so a keyboard or
  // screen-reader user lands in the panel that just appeared rather than
  // being left on a control that no longer exists.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [restaurant.slug]);

  const style = {
    "--brand": restaurant.identity.brand,
    "--brand-ink": restaurant.identity.ink,
  } as CSSProperties;

  return (
    <aside
      aria-label={`Ordering at ${restaurant.name}`}
      style={style}
      className={`pointer-events-auto fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl border border-hairline bg-paper shadow-[0_-8px_40px_rgb(42_35_30/0.18)] transition-[height] duration-300 ease-out min-[900px]:inset-x-auto min-[900px]:bottom-4 min-[900px]:right-4 min-[900px]:top-4 min-[900px]:!h-auto min-[900px]:w-[27.5rem] min-[900px]:rounded-3xl min-[900px]:shadow-[0_12px_48px_rgb(42_35_30/0.2)] ${
        sheetOpen ? "h-[62dvh]" : "h-[10.25rem]"
      }`}
    >
      {/* Phone only: tuck the sheet down to see the building, or raise it. */}
      <button
        type="button"
        onClick={onToggleSheet}
        aria-expanded={sheetOpen}
        className="flex min-h-7 w-full shrink-0 items-center justify-center rounded-t-3xl min-[900px]:hidden"
      >
        <span aria-hidden="true" className="h-1.5 w-11 rounded-full bg-ink/20" />
        <span className="sr-only">{sheetOpen ? "Lower the panel to see the storefront" : "Raise the panel to see the orders"}</span>
      </button>

      <header className="shrink-0 px-4 pb-3 min-[900px]:px-5 min-[900px]:pt-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="-ml-1 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-card px-3.5 text-sm font-bold text-ink transition-colors hover:bg-sunk"
          >
            <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3">
              <path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {backLabel}
          </button>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="min-w-0 flex-1 truncate text-2xl font-extrabold leading-tight tracking-tight text-ink outline-none"
          >
            {restaurant.name}
          </h1>
          <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-full bg-brand ring-2 ring-card" />
        </div>

        {chips.length > 0 && (
          // Tucked away with the sheet on a phone: lowered, the sheet is just
          // the name and the message box, and the building has the screen.
          <ul
            aria-label="What you've asked for"
            className={`mt-3 flex-wrap gap-1.5 min-[900px]:flex ${sheetOpen ? "flex" : "hidden"}`}
          >
            {chips.map((chip) => (
              <li key={chip.id}>
                <button
                  type="button"
                  onClick={() => onRemoveChip(chip)}
                  aria-label={`Remove: ${chip.label}`}
                  className="group inline-flex min-h-9 items-center gap-1.5 rounded-full bg-ink px-3 text-sm font-semibold text-paper transition-opacity hover:opacity-85"
                >
                  {chip.label}
                  <svg aria-hidden="true" viewBox="0 0 10 10" className="h-2.5 w-2.5 opacity-70 group-hover:opacity-100">
                    <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </header>

      {/* Announced once per answer. Kept apart from the visible log, which
          would otherwise be read out card by card as it re-renders. */}
      <p className="sr-only" role="status" aria-live="polite">
        {latest ? announcementFor(latest, restaurant.name) : ""}
      </p>

      <div
        ref={logRef}
        className={`quiet-scroll min-h-0 flex-1 overflow-y-auto border-t border-hairline px-4 py-3 min-[900px]:px-5 ${
          sheetOpen ? "" : "hidden min-[900px]:block"
        }`}
      >
        <div className="flex flex-col gap-3">
          {turns.map((turn, index) => {
            const isLatest = index === turns.length - 1;
            const shown = isLatest ? (turn.response ?? settled) : undefined;

            return (
              <div key={turn.id} ref={isLatest ? latestRef : undefined} className="flex flex-col gap-2.5">
                {(turn.said || turn.action) && (
                  <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-[0.95rem] font-semibold leading-snug text-brand-ink">
                    <span className="sr-only">You: </span>
                    {turn.said ?? turn.action}
                  </p>
                )}

                <p
                  className={`max-w-[92%] text-[0.95rem] leading-snug ${
                    turn.status === "error" ? "font-semibold text-danger" : isLatest ? "text-ink" : "text-ink-soft"
                  }`}
                >
                  {turn.status === "loading" ? (
                    <span className="thinking text-ink-soft">
                      Checking the kitchen<span>.</span>
                      <span>.</span>
                      <span>.</span>
                    </span>
                  ) : (
                    replyFor(turn, restaurant.name)
                  )}
                </p>

                {isLatest && shown && (
                  <div className={`flex flex-col gap-2.5 ${turn.status === "loading" ? "opacity-50" : ""}`}>
                    {turn.status === "ok" &&
                      shown.notices.map((notice) => <Notice key={notice.code + notice.message}>{notice.message}</Notice>)}

                    <ol aria-label={`Orders at ${restaurant.name}`} className="flex flex-col gap-2.5">
                      {shown.results.map((result, i) => (
                        <li key={result.id}>
                          <OrderCard
                            result={result}
                            goals={shown.criteria.goals}
                            windowNumber={i < 3 ? i + 1 : undefined}
                            onAttention={(active) => onAttention(active && i < 3 ? i : null)}
                          />
                        </li>
                      ))}
                    </ol>

                    <ProvenanceLine nutrition={shown.data.nutrition} price={shown.data.price} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-hairline px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2.5 min-[900px]:px-5 min-[900px]:pb-5">
        <ul
          aria-label="Suggestions"
          className={`quiet-scroll -mx-4 mb-2.5 flex gap-1.5 overflow-x-auto px-4 pb-1 min-[900px]:mx-0 min-[900px]:flex-wrap min-[900px]:overflow-visible min-[900px]:px-0 ${
            sheetOpen ? "" : "hidden min-[900px]:flex"
          }`}
        >
          {suggestionsFor(settled).map((text) => (
            <li key={text} className="shrink-0">
              <button
                type="button"
                onClick={() => onSend(text)}
                className="inline-flex min-h-9 items-center rounded-full border border-hairline bg-card px-3 text-sm font-semibold text-ink transition-colors hover:bg-sunk"
              >
                {text}
              </button>
            </li>
          ))}
        </ul>

        <SearchField
          label={`Tell ${restaurant.name} what you're after`}
          placeholder={chips.length > 0 ? "Change something: cheaper, no rice…" : "High protein, under 600 calories…"}
          action="Send"
          busy={busy}
          onSubmit={onSend}
          clearOnSubmit
        />
      </div>
    </aside>
  );
}
