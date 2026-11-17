# 0002 — One menu format, with provenance built in

**Status:** accepted · 2026-11-16

## The problem

Menu data lived as hardcoded arrays inside `lib/db.ts`. There was no record of
where any number came from, prices could not be "unknown", and the facts the
meal grammar needs (is this a main or a side? is it breakfast-only?) were
guessed from a single `category` word.

The project also needs dynamic ingestion, which means menus will arrive from
more than one place.

## The decision

**1. A restaurant is one JSON object — a `MenuDocument`** (`lib/menuDocument.ts`).
The seven seed restaurants are MenuDocuments in `db/seed/`. A file handed to the
importer is a MenuDocument. The USDA adapter produces a MenuDocument. All of
them go through the same validator and the same writer (`lib/db/write.ts`), so
"the seed" and "ingestion" are one code path.

**2. A document must say where its numbers came from.** `sources.nutrition` is
required. `sources.price` is required the moment any price is stated. Each
source records a name, a URL when one exists, the market it describes, the date
it was read, and how it got here.

**3. The database enforces it too.** Every menu row has a
`nutrition_source_id`, and a `CHECK` constraint makes `price` and
`price_source_id` null together or set together. Code that bypassed the
validator still could not store a price with no source.

**4. Unknown is `NULL`, never `0`.** `price` is nullable. A restaurant ingested
from a nutrition-only source has no prices, and the engine treats that as "no
price data" rather than "free".

**5. Role, daypart and portion weight are stored columns.** The classifier in
`lib/mealGrammar.ts` only *proposes* them when a document leaves them out; what
it proposes is written to the row, where a wrong guess is a one-line fix.

**6. Loading replaces, it doesn't merge.** A restaurant's whole menu is swapped
in one transaction. Every row of a restaurant therefore shares one fetch date,
which is what makes a single "as of" date per restaurant honest.

## Calls made about the existing data

The seed files were generated mechanically from the old arrays (a recorder
stood in for the database and captured every insert), so no figure was retyped.

What the old code recorded about its sources was two sentences: nutrition came
"from official restaurant nutrition pages", and prices were "US national
averages, audited August 2026" from aggregators that disagreed. So:

- Nutrition sources have **`url: null`**. The exact pages were never written
  down, and attaching a URL now would be claiming a provenance nobody recorded.
- `fetched_at` is the date the figures were **committed** (2026-07-29 for
  nutrition, 2026-08-07 for prices), and each source's `notes` says so.
- The Raising Cane's Sandwich Combo price is flagged `price_estimated`, because
  the old comments say no source published it.

These are listed under Open questions in `docs/STATUS.md`.

## Alternatives rejected

- **A provenance column on each row instead of a `sources` table.** Repeats the
  same five strings on forty rows and lets them drift apart.
- **Per-row sources mixed within one restaurant.** More flexible, but it would
  make "how fresh is this restaurant's data" unanswerable with one date.
