"use client";

import { useState, useRef } from "react";
import {
  Drumstick,
  UtensilsCrossed,
  Soup,
  Flame,
  CookingPot,
  Sandwich,
  Beef,
  Search,
  Plus,
} from "lucide-react";
import GoalChip from "./components/GoalChip";
import OrderResults from "./components/OrderResults";
import type { SearchResponse, SearchError } from "@/lib/searchResult";

// The server's own failures (SearchError) carry a machine-readable code. A
// network failure never reaches the server, so it has no code to carry — it is
// the client's own error state, not one of the API's.
type ClientError = { error: string };
type SearchResult = SearchResponse | SearchError | ClientError;

const RESTAURANT_COLORS: Record<string, string> = {
  "Chick-fil-A":   "#DD0031",
  "McDonald's":    "#D97706",
  Chipotle:        "#A21F1F",
  "Taco Bell":     "#702082",
  "Panda Express": "#C8102E",
  "Raising Cane's":"#CA8A04",
  Whataburger:     "#EA580C",
};

const RESTAURANTS = [
  { name: "Chick-fil-A",    Icon: Drumstick,       query: "high protein chick-fil-a"    },
  { name: "Chipotle",       Icon: Soup,             query: "high protein chipotle"       },
  { name: "McDonald's",     Icon: Sandwich,         query: "high protein mcdonalds"      },
  { name: "Taco Bell",      Icon: Flame,            query: "high protein taco bell"      },
  { name: "Panda Express",  Icon: CookingPot,       query: "high protein panda express"  },
  { name: "Raising Cane's", Icon: UtensilsCrossed,  query: "high protein raising canes"  },
  { name: "Whataburger",    Icon: Beef,             query: "high protein whataburger"    },
];

const EXAMPLES = [
  "high protein chick-fil-a",
  "keto chipotle around 700 cal",
  "lean mcdonalds ~500 cal",
  "cheapest high protein chipotle",
];

export default function Home() {
  const [query, setQuery]     = useState("");
  const [result, setResult]   = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef  = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res  = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ error: "Network error — please try again." });
    } finally {
      setLoading(false);
    }
  }

  function handleExample(q: string) {
    setQuery(q);
    runSearch(q);
    inputRef.current?.focus();
  }

  function handleRestaurant(q: string) {
    setQuery(q);
    runSearch(q);
    searchRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function resetSearch() {
    setResult(null);
    setQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const accentColor =
    result && "restaurant" in result
      ? (RESTAURANT_COLORS[result.restaurant.name] ?? "#059669")
      : "#059669";

  const hasResults = result && !loading;

  return (
    <div className="min-h-screen" style={{ background: "#F5F4F0" }}>

      {/* ── Sticky nav ─────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-20 border-b border-stone-200 bg-white/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button
            onClick={resetSearch}
            className="text-xl font-extrabold tracking-tight hover:opacity-70 transition-opacity"
            style={{ color: "#059669" }}
          >
            AYCE
          </button>
          <span className="text-sm font-medium text-stone-400 hidden sm:block">
            All You Can Eat
          </span>
        </div>
      </nav>

      {/* ── Hero banner ─────────────────────────────────────────────────────── */}
      <section
        className="w-full flex items-center justify-center"
        style={{ minHeight: "260px", background: "#111827" }}
      >
        <div className="text-center px-6 py-20">
          <h1 className="text-5xl sm:text-7xl font-extrabold text-white tracking-tighter leading-[0.95]">
            All You Can Eat
          </h1>
          <p
            className="text-base sm:text-lg font-normal mt-4 max-w-lg mx-auto"
            style={{ color: "#9CA3AF" }}
          >
            Smart nutrition picks for any fast food goal
          </p>
        </div>
      </section>

      {/* ── Search bar — floats out of the hero ─────────────────────────────── */}
      <div ref={searchRef} className="max-w-3xl mx-auto px-6 -mt-7 relative z-10">
        <div className="bg-white rounded-2xl shadow-2xl border border-stone-200">
          <form onSubmit={(e) => { e.preventDefault(); runSearch(query); }}>
            <div className="flex items-center focus-within:ring-2 focus-within:ring-emerald-300 rounded-2xl transition-all">
              <span className="pl-5 shrink-0 text-stone-400">
                <Search className="h-5 w-5" />
              </span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="What would you like to eat?"
                className="flex-1 py-5 px-4 bg-transparent text-stone-900 placeholder:text-stone-400 text-base focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="m-2 px-7 py-3 text-white rounded-xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0 active:scale-95"
                style={{ background: "#059669" }}
                onMouseEnter={(e) => { if (!loading && query.trim()) (e.target as HTMLButtonElement).style.background = "#047857"; }}
                onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.background = "#059669"; }}
              >
                {loading ? "…" : "Search"}
              </button>
            </div>
          </form>
        </div>

        {/* Editorial example links */}
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 items-baseline px-1">
          <span className="text-sm italic text-stone-400 select-none">e.g.</span>
          {EXAMPLES.map((q) => (
            <button
              key={q}
              onClick={() => handleExample(q)}
              className="text-sm text-stone-500 hover:text-stone-900 underline underline-offset-2 decoration-stone-300 hover:decoration-stone-700 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* ── Explore Menus grid (hidden once results are showing) ─────────────── */}
      {!loading && !hasResults && (
        <section className="max-w-5xl mx-auto px-6 pt-14 pb-20">
          <h2 className="text-2xl font-extrabold text-stone-900 tracking-tight mb-6">Explore Menus</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {RESTAURANTS.map((r) => (
              <button
                key={r.name}
                onClick={() => handleRestaurant(r.query)}
                className="group flex flex-col items-center justify-center gap-4 rounded-2xl border border-stone-200 bg-white p-8 text-center transition-all hover:border-emerald-200 hover:bg-emerald-50/40 hover:scale-[1.03] hover:shadow-lg active:scale-[0.97] shadow-sm"
                style={{ minHeight: "180px" }}
              >
                <r.Icon
                  size={36}
                  strokeWidth={1.5}
                  className="transition-transform duration-300 group-hover:scale-110"
                  style={{ color: "#059669" }}
                />
                <span className="text-base font-bold tracking-tight text-stone-800">
                  {r.name}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 group-hover:text-stone-600 transition-colors">
                  Explore →
                </span>
              </button>
            ))}

            {/* Coming soon placeholder */}
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-stone-200 p-8 text-center"
              style={{ minHeight: "180px" }}
            >
              <Plus size={28} strokeWidth={1.5} className="text-stone-300" />
              <span className="text-sm font-semibold text-stone-300">More coming soon</span>
            </div>
          </div>
        </section>
      )}

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {(loading || hasResults) && (
        <section className="max-w-4xl mx-auto px-6 pb-24 pt-10">

          {loading && (
            <div className="flex flex-col items-center py-20 gap-4">
              <div className="w-10 h-10 border-[3px] border-stone-200 border-t-emerald-500 rounded-full animate-spin" />
              <p className="text-stone-500 font-medium">Crunching the numbers…</p>
            </div>
          )}

          {hasResults && "error" in result && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-red-700 font-medium text-sm">
              {result.error}
            </div>
          )}

          {hasResults && "restaurant" in result && (
            <div className="anim-up">
              {/* Back button */}
              <button
                onClick={resetSearch}
                className="group flex items-center gap-1.5 text-sm font-semibold text-stone-500 hover:text-emerald-600 transition-colors mb-5"
              >
                <span className="group-hover:-translate-x-1 transition-transform inline-block">←</span>
                Back to Explore
              </button>

              {/* Restaurant header card */}
              <div className="flex items-center gap-4 mb-6 p-5 bg-white rounded-2xl border border-stone-200 shadow-sm">
                <div className="w-1.5 h-12 rounded-full shrink-0" style={{ backgroundColor: accentColor }} />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-0.5">
                    Top picks at
                  </p>
                  <h2 className="text-2xl font-extrabold text-stone-900 leading-none">
                    {result.restaurant.name}
                  </h2>
                  {result.calorie_target && (
                    <p className="text-sm text-stone-500 mt-1">Around {result.calorie_target} calories</p>
                  )}
                </div>
              </div>

              {/* Detected goals */}
              {(result.goals.length > 0 || result.budget_priority) && (
                <div className="flex flex-wrap gap-2 mb-6 items-center">
                  <span className="text-sm font-medium text-stone-400">Goals:</span>
                  {result.goals.map((g) => (
                    <GoalChip key={g.nutrient} goal={g} />
                  ))}
                  {result.budget_priority && (
                    <span className="inline-flex items-center gap-1 px-4 py-2 rounded-full text-sm font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                      Budget-friendly
                    </span>
                  )}
                </div>
              )}

              <OrderResults results={result.results} accentColor={accentColor} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
