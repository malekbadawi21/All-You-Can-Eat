# Build log

One entry per phase: what the approach was, why, what was rejected, and a
file-by-file walkthrough — written so you could redo it yourself. Decisions
that deserve their own page are in `docs/decisions/` and linked from here.

---

## Phase 0 — Taking stock

**What I did before changing anything.** Read the whole repo, ran the checks,
and queried the real search route with every query in the handoff's defect
table to see the actual output.

**What I found that the handoff didn't mention.** `npm test` failed 12 of 67.
The cause was not the code: this Mac has two Node installs (Homebrew's 20 first
on `PATH`, and 22 in `/usr/local/bin`), and `better-sqlite3` is a native module
that had been compiled for 22. Under Node 20 it refuses to load, which takes
down every test and every API request that touches the database. On Node 22
everything passed. The fix came for free in Phase 1 (see ADR 0001).

**Repo clutter removed.** The stale `claude/blissful-babbage-3848de` branch was
fully merged into `main`, so `git branch -d` (the safe form, which refuses to
delete unmerged work) removed it. Its worktree under `.claude/worktrees/` was a
clean checkout of an old commit and was removed with `git worktree remove`.
It had also been making ESLint lint a second copy of the project.

---

## Phase 1 — The data layer

**Goal.** Get off a local SQLite file that cannot run on Vercel, without making
the project harder to run on a laptop — and, while the data layer is open, fix
the two modelling problems that everything later depends on: no provenance, and
`category` doing three jobs at once.

**The approach, in one paragraph.** Swap `better-sqlite3` for libSQL, which is
SQLite that can also be reached over the network (ADR 0001). Move the menu data
out of code and into one JSON document per restaurant, and make every way of
loading a menu go through one validator and one writer (ADR 0002). Give role,
daypart and portion weight real columns. Change no engine behaviour yet — the
existing 67 tests are the proof that the swap was clean.

**How the seed data was moved without retyping it.** The old menus were arrays
inside a function. Rather than copy 190 rows by hand, a throwaway script
replaced `better-sqlite3` with a fake that recorded every `INSERT` the old seed
code performed, ran the old seed against it, and wrote the recordings out as
JSON. Every number in `db/seed/` is therefore byte-for-byte what the old code
would have inserted.

### File by file

- **`db/migrations/0001_init.ts`** — the schema, as a SQL string in a module
  (so it gets bundled; a loose `.sql` file would not be). New: a `sources`
  table; `role` / `daypart` / `portion_weight` columns; nullable `price`; and
  the `CHECK ((price IS NULL) = (price_source_id IS NULL))` that makes a
  sourceless price impossible to store.
- **`db/migrations/index.ts`** — the ordered list. Add a file, append it here.
- **`db/seed/*.json`, `db/seed/index.ts`** — the seven restaurants. Imported,
  not read from disk, so a serverless build carries them.
- **`lib/menuDocument.ts`** — the `MenuDocument` type and its validator.
  Errors block loading; warnings (calories that don't match the macros) don't.
- **`lib/db/client.ts`** — decides where the database is: hosted, file or
  memory. The only file that reads `TURSO_DATABASE_URL`.
- **`lib/db/migrate.ts`** — applies pending migrations, one transaction each,
  recording them in `_migrations`.
- **`lib/db/write.ts`** — `writeMenuDocument()`, the single way a menu gets
  into the database. Validates, replaces the old menu in one transaction, and
  batches the inserts so a hosted database sees a few round trips, not forty.
- **`lib/db/index.ts`** — the read API (`getAllRestaurants`, `getMenu`), the
  public types, `ensureReady()` (auto-setup for local and in-memory databases
  only), and a one-minute read cache.
- **`lib/freshness.ts`** — turns a `fetched_at` into "N days old, stale or not".
- **`lib/mealGrammar.ts`** — now reads `role`, `daypart` and `portion_weight`
  off the item. The old category table stays as `classifyItem()`, which
  proposes those facts for an item that arrives without them.
- **`scripts/db.ts`** — `npm run db:migrate | db:seed | db:setup | db:status`.
- **`__tests__/dataLayer.test.ts`** — tests the promises above against a real
  in-memory database: migrations are idempotent, a sourceless price is rejected
  by the validator *and* by raw SQL, a reload replaces instead of duplicating.
- **`app/api/search/route.ts`, `app/api/menu/route.ts`** — `await` the new
  async calls. No behaviour change.
- **Deleted:** `lib/db.ts` (replaced), `data/restaurants.json` (nothing
  imported it).

**What I rejected.** Postgres (no zero-setup local mode), keeping the data in
code (no provenance, no ingestion), and per-row merging on reload (needs an
identity for "the same item" that survives a rename).

---

## Phase 2 — The engine

**Goal.** Fix every defect in the handoff's table, test-first, and remove the
causes rather than the symptoms: `category` doing three jobs, "under" parsed as
"around", two optimisers with different rules.

**How it was done.** The workflow from `CLAUDE.md`, literally:

1. Ran all eighteen queries through the real route and saved the output
   (`docs/defects-before.md`). Every defect reproduced, plus two new ones.
2. Wrote the tests (`lib/defects.test.ts`), one group per defect, each printing
   the offending order when it fails.
3. Rewrote the engine.
4. Ran the same queries again (`docs/defects-after.md`) and read the output as
   a person would. That step found problems no test had been written for yet —
   a Bowl-for-Salad swap offered as a "different" order, a dessert used to pad a
   low-calorie meal, thirty-two nuggets after a portion weight was lowered — and
   each became a test before it was fixed.

**Rewrite or patch?** Rewrite, but not of the ideas. The meal grammar is
untouched in spirit; the joint search over build slots, the coupled slots, the
condiment phase and the diversity rules are all still there. What changed is
that there is now **one** pipeline (`recommend()`) with five steps shared by
both kinds of restaurant, where there were two optimisers that had drifted
apart. Every behaviour the old tests protected is re-asserted in
`lib/optimize.test.ts` against the new engine, with the original reasoning kept
in the comments.

**The three ideas that fixed most of the table.** Each has its own ADR.

- **Density, not totals or per-item averages** (ADR 0003). Fixes the Chipotle
  burrito and the Taco Bell dessert in one move.
- **Constraints, targets and preferences are different things** (ADR 0004).
  Fixes "under 800" and "under $8", and gives the conversation a memory.
- **Results are strata with a quality bar** (ADR 0005). Fixes the repeated
  labels, the 5-versus-3 inconsistency and the 31g "Most variety".

**The data fixes.** Seventeen rows in `db/seed/*.json` were reclassified, which
is what the new columns are for: Side Salad and the hash browns became sides,
the Cinnamon Roll a dessert, the breakfast taco got a taco's portion weight,
and the small burgers 0.75. Nugget portions stayed at a full main: lowering
them is exactly what produced 36 nuggets last time, and it did again when I
tried it.

**A bug the tests found in my own parser.** "high protein under 700 calories"
came back with *no criteria at all*. The gram-limit recogniser saw "protein
under 700", decided 700g of protein was implausible, and discarded the match —
taking the calorie ceiling with it. Recognisers can now decline a match and
leave the text for the next one. It was only visible through the API, because
every parser test happened to put a restaurant name between the two phrases.

### File by file

- **`lib/criteria.ts`** — `Criteria`, `CriteriaPatch`, `applyPatch()`, and the
  canonical text / chips that make a conversation stateless.
- **`lib/parseQuery.ts`** — rewritten. A sequence of recognisers, each consuming
  the span it understood; order is the design. Word boundaries everywhere
  ("tb" no longer matches "meatball"), typo tolerance for long names, restaurant
  aliases from the catalog instead of a hardcoded list.
- **`lib/chains.ts`** — a directory of chains we know *of*, so "wendys" is
  `unknown_restaurant` rather than `no_restaurant`.
- **`lib/menuTerms.ts`** — matches "no fries" / "with nuggets" to a menu:
  whole words, light stemming, longest phrase first.
- **`lib/scoring.ts`** — density, the calorie plan, weights, percentile
  normalising, and the fixed scales used to judge one order alone.
- **`lib/optimize.ts`** — `recommend(menu, criteria)`: enumerate, constrain,
  size, score, select. Fixed-menu enumeration, build enumeration with coupled
  slots, greedy condiments, twin removal, constraint diagnosis.
- **`lib/selectResults.ts`** — the strata.
- **`lib/notices.ts`** — the codes for "what we couldn't do".
- **`lib/search.ts`** — pure glue: resolves menu words, applies the patch on top
  of the context, builds the response. Also `inferRestaurant()` ("big mac" →
  McDonald's).
- **`lib/searchService.ts`** — the only part of a search that touches the
  database; decides which restaurant and returns a status and a body.
- **`lib/searchResult.ts`** — the contract: `criteria`, `results`, `notices`,
  `data`. Items gained `quantity`; prices are nullable.
- **`app/api/search/route.ts`** — now a ten-line HTTP wrapper taking `q`,
  `restaurant` and `context`.
- **`lib/mealGrammar.ts`** — the single-main label is now "No sides", which is
  true of three tacos as well as of one burger.
- **Tests** — `lib/defects.test.ts` (the table), `lib/optimize.test.ts`
  (everything the old suites protected), `lib/search.test.ts` (conversation,
  menu words, notices, provenance), `lib/parseQuery.test.ts`,
  `lib/pricing.test.ts`, `__tests__/searchRoute.test.ts` (the contract).
  `lib/__fixtures__/seedMenus.ts` builds real menus from the seed documents so
  engine tests need no database; `ask.ts` makes a test read like a question.
- **Deleted:** `lib/buildOrder.test.ts` and the two hand-copied fixture files,
  all superseded.

**What I rejected.** Enumerating condiments exhaustively (577,500 builds at
Chipotle; greedy gets the same answers in 5ms). Using the visitor's clock for
breakfast (ADR 0006). An LLM parser (needs a key; not reproducible).
