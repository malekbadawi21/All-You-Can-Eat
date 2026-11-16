"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

// ── The 2D layer ─────────────────────────────────────────────────────────────
//
// Every search bar, button and message in the app lives here, in ordinary DOM
// on top of the canvas. Nothing in this file knows about three.js.
//
// Text input stays out of the 3D layer on purpose: a real <input> can be
// tabbed to, styled, and — critically — will raise the keyboard on a phone.
// The same field expressed as geometry does none of those things.

const EXAMPLES = [
  "high protein 800 calorie Chick-fil-A",
  "cheapest burger under 500 calories McDonald's",
  "keto Chipotle around 700 cal",
];

function SearchField({
  value,
  onChange,
  onSubmit,
  placeholder,
  busy,
  autoFocus,
  accent = "#059669",
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  busy: boolean;
  autoFocus?: boolean;
  accent?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex items-center gap-2 rounded-2xl bg-white/95 shadow-2xl ring-1 ring-black/5 backdrop-blur px-2 focus-within:ring-2 focus-within:ring-emerald-400 transition">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent px-4 py-4 text-stone-900 placeholder:text-stone-400 focus:outline-none text-base"
          // The canvas listens for WASD to drive the camera. Without this,
          // typing "waffle" would walk you down the street.
          onKeyDown={(e) => e.stopPropagation()}
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="shrink-0 rounded-xl px-6 py-3 font-bold text-white text-sm transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: accent }}
        >
          {busy ? "…" : "Find food"}
        </button>
      </div>
    </form>
  );
}

export interface OverlayProps {
  mode: "home" | "roam" | "flying" | "focused";
  busy: boolean;
  errorMessage: string | null;
  /** Names the API suggests when it couldn't identify a restaurant. */
  available?: string[];
  focusedName: string | null;
  focusedAccent: string;
  onHomeSearch: (query: string) => void;
  onStorefrontSearch: (criteria: string) => void;
  onExplore: () => void;
  onBack: () => void;
}

/**
 * The storefront search field, with its own draft text.
 *
 * Split out so the parent can give it a `key` per restaurant: React discards
 * the old instance and its state, which clears the box on arrival for free.
 * The alternative — resetting the value from an effect — makes an extra render
 * pass on every visit and is what `react-hooks/set-state-in-effect` warns about.
 */
function StorefrontSearch({
  restaurantName,
  accent,
  busy,
  onSubmit,
}: {
  restaurantName: string;
  accent: string;
  busy: boolean;
  onSubmit: (criteria: string) => void;
}) {
  const [criteria, setCriteria] = useState("");

  return (
    <>
      <p className="mb-2 text-center text-white font-bold drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
        Ordering at {restaurantName}
      </p>
      <SearchField
        value={criteria}
        onChange={setCriteria}
        onSubmit={() => onSubmit(criteria)}
        // No restaurant needed here — you're standing in front of it.
        placeholder="high protein · under 600 calories · cheapest"
        busy={busy}
        accent={accent}
      />
    </>
  );
}

export default function Overlay({
  mode,
  busy,
  errorMessage,
  available,
  focusedName,
  focusedAccent,
  onHomeSearch,
  onStorefrontSearch,
  onExplore,
  onBack,
}: OverlayProps) {
  const [homeQuery, setHomeQuery] = useState("");

  return (
    // The wrapper ignores pointer events so the canvas underneath stays
    // clickable and draggable; each control switches them back on for itself.
    <div className="pointer-events-none fixed inset-0 z-10 select-none">
      {/* ── Home ──────────────────────────────────────────────────────────── */}
      {mode === "home" && (
        <div className="absolute inset-x-0 top-0 flex flex-col items-center px-6 pt-[7vh]">
          <h1 className="text-white text-5xl sm:text-6xl font-extrabold tracking-tight drop-shadow-[0_3px_12px_rgba(0,0,0,0.35)] text-center">
            All You Can Eat
          </h1>
          <p className="mt-2 text-white/90 font-medium drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)] text-center">
            Tell us what you&apos;re after and we&apos;ll walk you to the door.
          </p>

          <div className="pointer-events-auto mt-6 w-full max-w-2xl">
            <SearchField
              value={homeQuery}
              onChange={setHomeQuery}
              onSubmit={() => onHomeSearch(homeQuery)}
              placeholder="high protein 800 calorie Chick-fil-A"
              busy={busy}
              autoFocus
            />

            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1.5 justify-center">
              <span className="text-white/70 text-sm italic">try</span>
              {EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setHomeQuery(q);
                    onHomeSearch(q);
                  }}
                  className="text-sm text-white/90 underline underline-offset-4 decoration-white/40 hover:decoration-white transition"
                >
                  {q}
                </button>
              ))}
            </div>

            {errorMessage && (
              <div className="mt-4 rounded-xl bg-white/95 px-4 py-3 text-sm text-red-700 shadow-lg">
                {errorMessage}
                {available && available.length > 0 && (
                  <span className="block mt-1 text-stone-600">
                    On this street: {available.join(", ")}.
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={onExplore}
            className="pointer-events-auto mt-8 rounded-full bg-white/90 px-7 py-3 font-bold text-stone-800 shadow-xl ring-1 ring-black/5 transition hover:bg-white active:scale-95"
          >
            Explore the street →
          </button>
        </div>
      )}

      {/* ── Free roam ─────────────────────────────────────────────────────── */}
      {mode === "roam" && (
        <>
          <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-black/55 px-5 py-2.5 text-sm font-medium text-white backdrop-blur">
            <kbd className="font-bold">WASD</kbd> or arrows to walk ·{" "}
            <span className="font-bold">drag</span> to look ·{" "}
            <span className="font-bold">click a restaurant</span> to visit
          </div>
          <button
            onClick={onBack}
            className="pointer-events-auto absolute left-6 top-6 rounded-full bg-white/90 px-5 py-2.5 font-bold text-stone-800 shadow-xl ring-1 ring-black/5 transition hover:bg-white active:scale-95"
          >
            ← Home
          </button>
        </>
      )}

      {/* ── At a storefront ───────────────────────────────────────────────── */}
      {mode === "focused" && (
        <>
          <button
            onClick={onBack}
            className="pointer-events-auto absolute left-6 top-6 rounded-full bg-white/90 px-5 py-2.5 font-bold text-stone-800 shadow-xl ring-1 ring-black/5 transition hover:bg-white active:scale-95"
          >
            ← Back
          </button>

          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center px-6 pb-8">
            <div className="pointer-events-auto w-full max-w-2xl">
              {focusedName && (
                <StorefrontSearch
                  // Keyed by restaurant: arriving somewhere new remounts the
                  // field, so the previous search isn't left sitting in it.
                  key={focusedName}
                  restaurantName={focusedName}
                  accent={focusedAccent}
                  busy={busy}
                  onSubmit={onStorefrontSearch}
                />
              )}
              {errorMessage && (
                <div className="mt-3 rounded-xl bg-white/95 px-4 py-3 text-sm text-red-700 shadow-lg">
                  {errorMessage}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
