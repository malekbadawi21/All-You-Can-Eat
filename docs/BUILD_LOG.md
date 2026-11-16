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
