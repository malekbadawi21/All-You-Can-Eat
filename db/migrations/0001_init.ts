// ── 0001: the whole schema ───────────────────────────────────────────────────
//
// Migrations are TypeScript modules exporting a SQL string, rather than loose
// .sql files, for one practical reason: a serverless bundle only contains what
// the bundler can see being imported. A .sql file read with `fs` at runtime has
// to be traced and copied by hand; a string in a module just comes along.
//
// What changed from the old schema in lib/db.ts, and why:
//
//   • `sources` is new. Every nutrition figure and every price now points at
//     the row describing where it came from, which market it describes and
//     when it was read. A price with no source cannot be stored at all — see
//     the CHECK constraints — so "never invent a number" is enforced by the
//     database rather than by remembering to be careful.
//
//   • `role`, `daypart` and `portion_weight` are real columns. They used to be
//     derived from `category` in code, which is why a 15-calorie "Side Salad"
//     filed under category `salad` counted as a full main course. `category`
//     stays, but only as a display grouping.
//
//   • `price` is nullable. A restaurant ingested from a nutrition-only source
//     has no prices, and the honest representation of "unknown" is NULL, not 0.
//
//   • `restaurants` carries aliases and a storefront identity, so the parser
//     and the 3D street can both work for any number of restaurants instead of
//     seven hardcoded ones.

export const id = "0001_init";

export const sql = /* sql */ `
CREATE TABLE sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT    NOT NULL CHECK (kind IN ('nutrition', 'price')),
  name        TEXT    NOT NULL,
  url         TEXT,
  market      TEXT    NOT NULL,
  fetched_at  TEXT    NOT NULL,
  method      TEXT    NOT NULL,
  license     TEXT,
  notes       TEXT
);

CREATE TABLE restaurants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL CHECK (type IN ('fixed', 'build-your-own')),
  aliases     TEXT    NOT NULL DEFAULT '[]',
  identity    TEXT,
  origin      TEXT    NOT NULL DEFAULT 'seed' CHECK (origin IN ('seed', 'import', 'ingested')),
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE menu_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id       INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL DEFAULT 0,
  name                TEXT    NOT NULL,
  category            TEXT    NOT NULL,
  role                TEXT    NOT NULL CHECK (role IN ('main', 'side', 'dessert')),
  daypart             TEXT    NOT NULL CHECK (daypart IN ('all-day', 'breakfast')),
  portion_weight      REAL    NOT NULL CHECK (portion_weight > 0),
  calories            INTEGER NOT NULL CHECK (calories >= 0),
  protein_g           REAL    NOT NULL CHECK (protein_g >= 0),
  fat_g               REAL    NOT NULL CHECK (fat_g >= 0),
  carbs_g             REAL    NOT NULL CHECK (carbs_g >= 0),
  sodium_mg           INTEGER NOT NULL CHECK (sodium_mg >= 0),
  price               REAL             CHECK (price IS NULL OR price >= 0),
  price_estimated     INTEGER NOT NULL DEFAULT 0,
  nutrition_source_id INTEGER NOT NULL REFERENCES sources(id),
  price_source_id     INTEGER          REFERENCES sources(id),
  CHECK ((price IS NULL) = (price_source_id IS NULL))
);

CREATE TABLE component_slots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  slot_name     TEXT    NOT NULL,
  required      INTEGER NOT NULL DEFAULT 0,
  pick          TEXT    NOT NULL CHECK (pick IN ('1', 'many')),
  count_from    TEXT
);

CREATE TABLE components (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id             INTEGER NOT NULL REFERENCES component_slots(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL DEFAULT 0,
  name                TEXT    NOT NULL,
  calories            INTEGER NOT NULL CHECK (calories >= 0),
  protein_g           REAL    NOT NULL CHECK (protein_g >= 0),
  fat_g               REAL    NOT NULL CHECK (fat_g >= 0),
  carbs_g             REAL    NOT NULL CHECK (carbs_g >= 0),
  sodium_mg           INTEGER NOT NULL CHECK (sodium_mg >= 0),
  price               REAL             CHECK (price IS NULL OR price >= 0),
  price_estimated     INTEGER NOT NULL DEFAULT 0,
  pick_counts         TEXT,
  nutrition_source_id INTEGER NOT NULL REFERENCES sources(id),
  price_source_id     INTEGER          REFERENCES sources(id),
  CHECK ((price IS NULL) = (price_source_id IS NULL))
);

CREATE TABLE ingestion_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_name TEXT    NOT NULL,
  slug           TEXT,
  adapter        TEXT    NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN ('ok', 'not_found', 'rejected', 'error')),
  message        TEXT,
  items_added    INTEGER NOT NULL DEFAULT 0,
  started_at     TEXT    NOT NULL,
  finished_at    TEXT    NOT NULL
);

CREATE INDEX menu_items_restaurant ON menu_items(restaurant_id, position);
CREATE INDEX component_slots_restaurant ON component_slots(restaurant_id, position);
CREATE INDEX components_slot ON components(slot_id, position);
`;
