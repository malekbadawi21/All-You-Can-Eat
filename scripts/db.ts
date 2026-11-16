import { loadEnvConfig } from "@next/env";

// ── Database CLI ─────────────────────────────────────────────────────────────
//
//   npm run db:migrate   apply any migrations the database hasn't run
//   npm run db:seed      (re)load the seven seed restaurants
//   npm run db:setup     both, in that order — the one command a new database needs
//   npm run db:status    what's in there, where it came from, and how old it is
//
// Which database these touch is decided exactly the way the app decides it
// (lib/db/client.ts): TURSO_DATABASE_URL if set, otherwise the local file.
// The environment is loaded the way Next loads it, so a .env.local that works
// for `npm run dev` works here too.

loadEnvConfig(process.cwd());

async function main() {
  // Imported after the environment is loaded, because the connection reads
  // its target from process.env the moment it is first used.
  const { getConnection, runMigrations, writeMenuDocument, getAllRestaurants, getMenu, invalidateCache } =
    await import("@/lib/db");
  const { SEED_DOCUMENTS } = await import("@/db/seed");
  const { freshnessOf } = await import("@/lib/freshness");

  const command = process.argv[2];
  const { client, target } = getConnection();

  // Print where we're pointed, without ever echoing a credential.
  const where =
    target.mode === "hosted" ? `hosted database at ${new URL(target.url).host}` : target.url;
  console.log(`Database: ${where}\n`);

  if (target.mode === "file") {
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(target.url.replace(/^file:/, "")), { recursive: true });
  }

  const migrate = async () => {
    const report = await runMigrations(client);
    if (report.applied.length === 0) console.log("Migrations: nothing to apply.");
    else console.log(`Migrations applied: ${report.applied.join(", ")}`);
  };

  const seed = async () => {
    for (const [position, doc] of SEED_DOCUMENTS.entries()) {
      const report = await writeMenuDocument(client, doc, { origin: "seed", position });
      console.log(
        `  ${report.replaced ? "replaced" : "added   "} ${report.slug.padEnd(16)} ${report.rows} rows`
      );
      for (const warning of report.warnings) console.log(`           ⚠ ${warning}`);
    }
    invalidateCache();
    console.log(`Seeded ${SEED_DOCUMENTS.length} restaurants.`);
  };

  const status = async () => {
    await runMigrations(client);
    const restaurants = await getAllRestaurants();
    if (restaurants.length === 0) {
      console.log("No restaurants. Run `npm run db:setup`.");
      return;
    }
    for (const r of restaurants) {
      const menu = (await getMenu(r.slug))!;
      const size =
        r.type === "fixed"
          ? `${menu.items.length} items`
          : `${menu.slots.length} slots, ${menu.slots.reduce((n, s) => n + s.options.length, 0)} options`;
      console.log(`${r.name}  (${r.slug}, ${r.type}, ${r.origin}) — ${size}`);
      for (const source of [menu.sources.nutrition, menu.sources.price]) {
        if (!source) continue;
        const { age_days, stale } = freshnessOf(source);
        console.log(
          `    ${source.kind.padEnd(9)} ${source.fetched_at.slice(0, 10)}  ${String(age_days).padStart(4)}d old${stale ? "  STALE" : ""}  ${source.name} [${source.market}]`
        );
      }
      if (!menu.sources.price) console.log("    price     none on record");
    }
  };

  switch (command) {
    case "migrate":
      await migrate();
      break;
    case "seed":
      await migrate();
      await seed();
      break;
    case "setup":
      await migrate();
      await seed();
      break;
    case "status":
      await status();
      break;
    default:
      console.error("Usage: tsx scripts/db.ts <migrate|seed|setup|status>");
      process.exitCode = 1;
  }

  client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
