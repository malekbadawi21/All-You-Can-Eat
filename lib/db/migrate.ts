import type { Client } from "@libsql/client";
import { MIGRATIONS } from "@/db/migrations";

// ── Applying migrations ──────────────────────────────────────────────────────
//
// The database keeps its own record of which migrations it has run, in a
// `_migrations` table. Running this is therefore always safe: it applies
// whatever is missing, in order, and does nothing if nothing is.
//
// This replaces `CREATE TABLE IF NOT EXISTS` at startup, which can create a
// schema but can never *change* one — the moment a column is added, every
// existing database silently keeps the old shape.

export interface MigrationReport {
  applied: string[];
  alreadyApplied: string[];
}

export async function runMigrations(client: Client): Promise<MigrationReport> {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
  );

  const done = new Set(
    (await client.execute("SELECT id FROM _migrations")).rows.map((r) => String(r.id))
  );

  const report: MigrationReport = { applied: [], alreadyApplied: [] };

  for (const migration of MIGRATIONS) {
    if (done.has(migration.id)) {
      report.alreadyApplied.push(migration.id);
      continue;
    }

    // One transaction per migration: the schema change and the record of it
    // land together or not at all, so a failure halfway leaves the database
    // exactly as it was rather than half-migrated and unrecorded.
    const tx = await client.transaction("write");
    try {
      await tx.executeMultiple(migration.sql);
      await tx.execute({
        sql: "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)",
        args: [migration.id, new Date().toISOString()],
      });
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw new Error(`Migration ${migration.id} failed: ${(error as Error).message}`);
    }

    report.applied.push(migration.id);
  }

  return report;
}

/** Whether the schema exists at all — the cheap check before querying. */
export async function isMigrated(client: Client): Promise<boolean> {
  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'restaurants'"
  );
  return result.rows.length > 0;
}
