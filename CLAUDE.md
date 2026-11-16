@AGENTS.md

# How to work with the developer on this project

The person you're working with is learning software development by building this app. That means your job isn't just to write correct code — it's to help them understand what's happening and why. Follow these rules in every response:

**Explain before you act.** Before creating a file, running a command, or making a decision, explain in plain English what you're about to do, why it's needed, and how it fits into the bigger picture. Never write code first and explain later.

**Say why, not just what.** If you choose a folder structure, a file name, or an approach, tell them the reason behind that choice. "I'm putting this in `app/api/` because that's how Next.js knows it's a server route, not a page" is more useful than just creating the file.

**Be conversational, not like documentation.** Write like you're talking to someone smart who's new to this. Use analogies when something is abstract. "Think of this like a menu at a restaurant — the API route is the waiter, the data file is the kitchen" beats a wall of technical terms.

**One thing at a time.** Don't stack multiple unexplained changes. Do one thing, explain it, confirm it makes sense, then move on.

**Match this tone.** The developer described the ideal tone as: teaching, conversational, explains the why behind decisions, doesn't move too fast, treats the reader as someone who understands the goal but not always the implementation details.

---

# Where we are

**Start with `docs/STATUS.md`** — it is the live record of what is done and what is next, and it is kept current after every commit. `docs/decisions/` holds one short page per significant decision, and `docs/BUILD_LOG.md` walks through each phase file by file.

**What the product is:** you type "high protein Chick-fil-A around 800 calories", the camera flies down a low-poly 3D street to that restaurant's storefront, and the best real orders appear in its windows as menu boards. You can also roam the street and click any storefront.

**What's built:**
- **Data layer** (`lib/db/`) — libSQL. A local SQLite file by default (`data/ayce.db`, created and seeded on first request), a hosted Turso database when `TURSO_DATABASE_URL` is set, in-memory for tests. Schema lives in `db/migrations/`, the seven seed restaurants in `db/seed/*.json`.
- **Provenance** — every menu row points at a `sources` row saying where its figures came from, for which market, and when. A price cannot be stored without a source; unknown prices are `NULL`, never `0`.
- `lib/menuDocument.ts` — the one JSON format a restaurant arrives in, and its validator. The seed, the file importer and the ingestion adapter all use it.
- `lib/parseQuery.ts` — a keyword parser: text → a restaurant plus a `CriteriaPatch`
- `lib/criteria.ts` — what the user is asking for: constraints ("under 800"), targets ("around 800") and preferences ("high protein"), kept apart
- `lib/optimize.ts` — the engine: one `recommend(menu, criteria)` for both kinds of restaurant
- `lib/scoring.ts`, `lib/selectResults.ts` — how orders are ranked, and which handful are shown
- `lib/mealGrammar.ts` — the model of what shape an order has; see below
- `lib/searchResult.ts` — **the API's public shape**; start here before touching UI
- `app/api/search/route.ts`, `app/api/menu/route.ts` — the API surface
- **3D scene** (`app/components/scene/`) — React Three Fiber. One camera with four modes (home / roam / flying / focused) in `CameraRig.tsx`; the street is generated deterministically from a seeded PRNG in `cityLayout.ts`; storefront identity (colour, roofline, sign) is in `lib/restaurants.ts`. No logos anywhere — recognition comes from colour, form and name.
- **DOM layer** (`app/components/ui/`) — every input and message is ordinary DOM on top of the canvas.
- Vitest suite (`npm test`) and GitHub Actions CI running typecheck, lint, tests and build

**Two things about the 3D layer that will save you an afternoon:**
- Text in the scene is drawn on a 2D canvas and used as a texture (`signTexture.ts`, `boardTexture.ts`). drei's `<Text>` (troika) crashed the WebGL context here, silently. Don't reach for it.
- If `tsc` is clean but the canvas is blank, restart the dev server before debugging: Turbopack's HMR graph gets poisoned by some scene edits.

**The search API contract** (`lib/searchResult.ts`):
`GET /api/search?q=…&restaurant=…&context=…`. Every search answers in the same shape, whatever the restaurant, however it was phrased, first message or fifth:
```
{ restaurant: { name, slug, type }, query,
  criteria: { goals, calories: { target, min, max }, price_max, limits,
              budget_priority, variety, daypart, include, exclude,
              canonical, summary, chips },
  results: OrderResult[],      // 0–5, unique labels, best first
  notices: { code, message }[], // what couldn't be done, and why
  data: { nutrition, price } }  // where the numbers came from, how old
```
An `OrderResult` is `{ id, label, kind: "meal" | "build", shape, items[], total_*, price_estimated }`. Notes for anyone building on it:
- `criteria` is everything in force, not just what this message said. `criteria.canonical` is text the parser reads back to the same criteria — send it as `context` on the next request and the conversation continues with no session on the server. A chip's `without` is the canonical text minus that chip.
- `label` says why an order is in the list ("Best match", "Classic meal", "Budget pick"); `shape` says what it is (classic / single / stack / build).
- `items[].quantity` — nutrition and price on an item are for one; totals multiply.
- `items[].group` is the slot name on build-your-own restaurants; `items[].role` is main / side / dessert on fixed menus.
- Prices can be `null` (a restaurant with no price data). Never treat null as zero.
- **Scores are deliberately not exposed.** They aren't comparable across restaurants and would mislead if displayed.
- Errors carry a machine-readable `code` — branch on the code, never on the prose. `unknown_restaurant` (we don't carry it) is distinct from `no_restaurant` (none was named).
- `__tests__/searchRoute.test.ts` is the contract. Change the shape and that test together.

**How a search flows:** `lib/parseQuery.ts` (what did they say?) → `lib/search.ts` (what does that mean on this menu?) → `lib/optimize.ts` `recommend()` (enumerate, constrain, size, score) → `lib/selectResults.ts` (a best match plus real alternatives). `lib/searchService.ts` is the only step that touches the database. `lib/criteria.ts` and `lib/scoring.ts` hold the vocabulary and the ranking; read their header comments first.

**Data model decisions:**
- Fixed-menu restaurants use `type: "fixed"` with a flat list of `items`
- Build-your-own restaurants use `type: "build-your-own"` with `slots`, each holding the options that can fill it
- This distinction matters for the optimizer: fixed restaurants rank combinations of items, build-your-own restaurants find the best combination of ingredients
- Coupled slots use `count_from` — picking "Bowl" at Panda Express fixes the entree slot to 1 pick, "Plate" to 2
- Every item stores its own `role` (main / side / dessert), `daypart` (all-day / breakfast) and `portion_weight`. `category` is a display grouping and nothing more.

**Why `lib/mealGrammar.ts` exists:**
The optimizer scores nutrition, which judges how *good* an order is but not whether it's an order a human would place. Left alone it returned things like "Egg White Grill + Icedream Cone + Grilled Chicken Sandwich" (breakfast and lunch cannot be bought at the same time) and five near-identical stacks of mains with no traditional main-plus-side anywhere. The grammar adds the missing concept of an order's *shape*:
- **Hard rules** — same daypart, at least one main, caps on sides/desserts, a portion-weight ceiling. Only things that are impossible or that nobody orders.
- **Shape classification** — `classic` / `single` / `stack` (shown as "Classic meal" / "No sides" / "Double up"), so results deliberately span several kinds of order instead of restating one.
- Stacking mains is **allowed on purpose**: two sandwiches is a real order, and excluding it would be the algorithm imposing taste.

**Prices** are US national averages audited August 2026. Always show them as approximate — fast food pricing varies by over a dollar between markets, and the Raising Cane's Sandwich Combo is flagged `price_estimated` because no source publishes it.

**Editing seed data:** edit the JSON in `db/seed/`, then reload it:
```
npm run db:seed
```
(`npm run db:status` shows what's loaded, where it came from and how old it is.)

**How work gets done here** — the loop that found every real bug so far:
1. Query the running API and read the actual output. Predictions about what's broken have been wrong more often than right; the breakfast-plus-lunch and 36-nuggets defects were both found this way, not by reading code.
2. Capture the defect as a failing test, with an assertion message that prints the offending order.
3. Fix it.
4. Re-run the same live queries and compare. Green tests are not evidence the site improved.
5. `npm run check` before committing — typecheck, lint with zero warnings, tests, build. That's exactly what CI runs.

**Commits:** the only author is Malek. No `Co-Authored-By` trailers and no AI footers in commit messages.
