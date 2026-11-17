import { createClient, type Client } from "@libsql/client";

// ── Where the database lives ─────────────────────────────────────────────────
//
// One driver, three places it can point:
//
//   hosted   TURSO_DATABASE_URL=libsql://…  (+ TURSO_AUTH_TOKEN)
//            A Turso database, reached over HTTP. This is production: it works
//            from a serverless function, which has no writable disk.
//
//   file     file:data/ayce.db — the default on your own machine. A plain
//            SQLite file, no account, no network. `npm run dev` just works.
//
//   memory   :memory: — used by the tests, and as the last resort on a
//            serverless host with no database configured. Seeded on start,
//            gone when the process ends.
//
// libSQL is SQLite with a network protocol, so all three speak the same SQL
// and the rest of the app cannot tell them apart. That is the whole reason for
// choosing it over Postgres here: the hosted database and the zero-setup local
// one are the same engine. See docs/decisions/0002-libsql.md.

export type DatabaseMode = "hosted" | "file" | "memory";

export interface DatabaseTarget {
  url: string;
  authToken?: string;
  mode: DatabaseMode;
}

const DEFAULT_FILE_URL = "file:data/ayce.db";

export function resolveTarget(env: NodeJS.ProcessEnv = process.env): DatabaseTarget {
  const url = env.TURSO_DATABASE_URL?.trim();

  if (url) {
    if (url === ":memory:" || url.startsWith("file::memory:")) return { url: ":memory:", mode: "memory" };
    if (url.startsWith("file:")) return { url, mode: "file" };
    return { url, authToken: env.TURSO_AUTH_TOKEN?.trim() || undefined, mode: "hosted" };
  }

  // A serverless filesystem is read-only, so the local file would fail on the
  // first write. An in-memory database keeps an unconfigured deploy working —
  // seeded, searchable, just unable to remember an ingested restaurant.
  if (env.VERCEL) return { url: ":memory:", mode: "memory" };

  return { url: DEFAULT_FILE_URL, mode: "file" };
}

interface Connection {
  client: Client;
  target: DatabaseTarget;
}

// Kept on globalThis so Next's dev-mode module reloading doesn't open a new
// connection (and, in memory mode, a new empty database) on every edit.
const globalForDb = globalThis as unknown as { __ayceDb?: Connection };

export function getConnection(): Connection {
  if (!globalForDb.__ayceDb) {
    const target = resolveTarget();
    globalForDb.__ayceDb = {
      target,
      client: createClient({ url: target.url, authToken: target.authToken }),
    };
  }
  return globalForDb.__ayceDb;
}

/** For scripts and tests that need a database of their own. */
export function openDatabase(target: DatabaseTarget): Client {
  return createClient({ url: target.url, authToken: target.authToken });
}
