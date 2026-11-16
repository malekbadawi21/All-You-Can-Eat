# Status

The shared record of where All You Can Eat stands. Updated after every commit
on `finish`. **If you are picking this up fresh, read this file and
`docs/decisions/` first.**

Last updated: 2026-11-16 · branch `finish` · nothing pushed

## How to run it

```bash
npm install
npm run dev          # http://localhost:3000 — creates and seeds data/ayce.db on first request
npm run check        # typecheck, lint, tests, build: exactly what CI runs
```

Use Node 22 (`.nvmrc`). This Mac also has a Homebrew Node 20 first on `PATH`;
both work now, but 22 is what CI runs.

## Phases

| # | Phase | State |
|---|---|---|
| 1 | Data layer: libSQL, migrations, seed files, provenance, real role/daypart/weight columns | **done** |
| 2 | Engine: every defect in the handoff table fixed test-first; constraints vs targets vs preferences; consistent results | **done** |
| 3 | Product experience: accessible DOM results, item detail, chat-style refinement, restaurant pages, touch, fallbacks, mobile | next |
| 4 | Dynamic ingestion and a street that works for N restaurants | pending |
| 5 | Review loop (Playwright screenshots, independent review), CI, README, deploy config | pending |

## What exists right now

- **Database** — `lib/db/` on libSQL. Local file by default, hosted Turso via
  `TURSO_DATABASE_URL`, in-memory for tests. Migrations in `db/migrations/`,
  seed documents in `db/seed/`, CLI in `scripts/db.ts`
  (`npm run db:setup | db:status`).
- **Provenance** — every menu row points at a `sources` row (name, market,
  fetched-at). A price cannot be stored without one.
- **Engine** — rewritten. `lib/parseQuery.ts` → `lib/search.ts` →
  `lib/optimize.ts` (`recommend()`) → `lib/selectResults.ts`. Goals are scored
  on density; constraints, targets and preferences are separate; both kinds of
  restaurant return 3–5 uniquely labelled orders. Every defect in the handoff
  table has a regression test (`lib/defects.test.ts`) and is fixed —
  compare `docs/defects-before.md` with `docs/defects-after.md`.
- **API** — `GET /api/search?q=…&restaurant=…&context=…`. Returns
  `{ restaurant, query, criteria, results, notices, data }`. `context` is the
  previous response's `criteria.canonical`, which is how a conversation
  continues with no server-side session.
- **Frontend** — still the `main` UI (3D street, fly-ins, three boards). It
  compiles against the new contract but does not use criteria, notices or
  results 4–5 yet. That is Phase 3.

## Decisions

See `docs/decisions/`. Each is one page: the choice, why, what was rejected.

## Open questions

Things where the source was unclear and I made the safest call. None block
shipping; each is something only you can settle.

1. **Nutrition source URLs.** The old code said only "from official restaurant
   nutrition pages". The seed records each nutrition source with `url: null`
   rather than guessing which page was used. If you have the URLs, add them to
   `sources.nutrition.url` in `db/seed/*.json` and run `npm run db:seed`.
2. **Fetch dates.** `fetched_at` is the date the figures were committed
   (2026-07-29 nutrition, 2026-08-07 prices), because the real retrieval dates
   were never recorded. Each source's notes say this.
3. **`fable-handoff-prompt.md`** is untracked at the repo root. I left it
   alone; commit it or delete it as you prefer.

## For Malek

_Filled in at the end: the exact steps to ship._
