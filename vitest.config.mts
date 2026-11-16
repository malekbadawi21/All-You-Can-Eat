import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the "@/..." import alias from tsconfig.json so tests import
  // modules the same way app code does. This used to require the
  // vite-tsconfig-paths plugin; Vite supports it natively now and warns if you
  // use the plugin instead.
  resolve: { tsconfigPaths: true },
  test: {
    // "node", not "jsdom". Next's official Vitest guide reaches for jsdom
    // because it assumes you're rendering React components. Everything under
    // lib/ is pure functions over plain arrays, so booting a fake browser for
    // each run would be pure overhead. Switch this to "jsdom" (and add
    // @vitejs/plugin-react + @testing-library/react) on the day we write the
    // first component test.
    environment: "node",
    // Each test file gets its own throwaway database: created in memory,
    // migrated and seeded on first use, gone when the file finishes. Nothing a
    // test does can leak into another file or into data/ayce.db.
    env: { TURSO_DATABASE_URL: ":memory:" },
    include: ["lib/**/*.test.ts", "__tests__/**/*.test.ts"],
  },
});
