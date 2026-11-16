# 0001 — libSQL (Turso) for the database

**Status:** accepted · 2026-11-16

## The problem

The app stored its data with `better-sqlite3`, writing a file under
`process.cwd()`. A Vercel function has a read-only filesystem, so that file
could never be written in production. The project also needs somewhere for
dynamically ingested restaurants to be saved, which rules out "bundle a
read-only file with the build".

Two constraints shape the choice:

- It has to run on a free tier, on serverless.
- It has to run on a laptop with **no account, no key and no network** —
  `git clone && npm install && npm run dev` must be a complete setup.

## The decision

Use **libSQL** through `@libsql/client`, pointed at one of three places by a
single environment variable (`lib/db/client.ts`):

| Mode | When | URL |
|---|---|---|
| hosted | production | `TURSO_DATABASE_URL=libsql://…` + `TURSO_AUTH_TOKEN` |
| file | your machine (the default) | `file:data/ayce.db` |
| memory | tests; an unconfigured serverless deploy | `:memory:` |

libSQL is SQLite with a network protocol bolted on. The hosted database and the
local file are the same engine speaking the same SQL, so there is one schema,
one set of queries and one set of migrations. Nothing in the app can tell which
mode it is in.

## Why not the alternatives

- **Postgres (Neon, Supabase).** A fine database, but there is no zero-setup
  local Postgres. Local development would need Docker or an account, or a
  second driver for local work — and then the thing you test is not the thing
  you ship.
- **Keep `better-sqlite3`, bundle the file read-only.** Works for the seven
  seeded restaurants and makes ingestion impossible.
- **A JSON file in blob storage.** No transactions, no constraints. The
  `CHECK` that makes "a price must have a source" unbreakable would be gone.

## What it costs

- Every database call is now `async`. The old API was synchronous because the
  old driver was; a network database cannot be.
- Each query to the hosted database is a network round trip. `lib/db/index.ts`
  keeps a one-minute read cache so a search costs zero round trips once warm.

## A side effect worth knowing

`better-sqlite3` is a native module compiled against one specific Node version.
This machine has Node 20 (Homebrew) and Node 22 (`/usr/local/bin`) installed,
and the module had been built for 22 — so under Node 20 every API request
failed with `NODE_MODULE_VERSION` errors and 12 of the 67 tests failed. libSQL's
native part uses N-API, which is stable across Node versions, so that whole
class of failure is gone. `.nvmrc` pins 22 anyway, to match CI.
