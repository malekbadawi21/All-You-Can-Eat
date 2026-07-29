@AGENTS.md

# How to work with the developer on this project

The person you're working with is learning software development by building this app. That means your job isn't just to write correct code — it's to help them understand what's happening and why. Follow these rules in every response:

**Explain before you act.** Before creating a file, running a command, or making a decision, explain in plain English what you're about to do, why it's needed, and how it fits into the bigger picture. Never write code first and explain later.

**Say why, not just what.** If you choose a folder structure, a file name, or an approach, tell them the reason behind that choice. "I'm putting this in `app/api/` because that's how Next.js knows it's a server route, not a page" is more useful than just creating the file.

**Be conversational, not like documentation.** Write like you're talking to someone smart who's new to this. Use analogies when something is abstract. "Think of this like a menu at a restaurant — the API route is the waiter, the data file is the kitchen" beats a wall of technical terms.

**One thing at a time.** Don't stack multiple unexplained changes. Do one thing, explain it, confirm it makes sense, then move on.

**Match this tone.** The developer described the ideal tone as: teaching, conversational, explains the why behind decisions, doesn't move too fast, treats the reader as someone who understands the goal but not always the implementation details.

---

# Where we are

**What's built:**
- Next.js project scaffolded with TypeScript and Tailwind
- `lib/db.ts` — SQLite (better-sqlite3) schema plus a seed of 7 restaurants: Chick-fil-A, McDonald's, Chipotle, Taco Bell, Panda Express, Raising Cane's, Whataburger
- `lib/parseQuery.ts` — keyword parser turning "high protein chick fil a around 800 calories" into goals, a restaurant slug, a calorie target and a budget flag
- `lib/optimize.ts` — ranking for fixed menus, calorie-targeted meal combinations, and a joint search over slots for build-your-own restaurants
- `lib/mealGrammar.ts` — the model of what shape an order has; see below
- `app/api/search/route.ts`, `app/api/menu/route.ts` — the API surface
- `app/page.tsx` + `app/components/` — homepage search UI and result rendering
- Vitest suite (`npm test`) and GitHub Actions CI running typecheck, lint, tests and build

**Data model decisions:**
- Fixed-menu restaurants use `type: "fixed"` with a flat list of `items`
- Build-your-own restaurants use `type: "build-your-own"` with individual `components` and a `slots` section describing how a meal is constructed
- This distinction matters for the optimizer: fixed restaurants rank items, build-your-own restaurants find the best combination of ingredients
- Coupled slots use `count_from` — picking "Bowl" at Panda Express fixes the entree slot to 1 pick, "Plate" to 2

**Why `lib/mealGrammar.ts` exists:**
The optimizer scores nutrition, which judges how *good* an order is but not whether it's an order a human would place. Left alone it returned things like "Egg White Grill + Icedream Cone + Grilled Chicken Sandwich" (breakfast and lunch cannot be bought at the same time) and five near-identical stacks of mains with no traditional main-plus-side anywhere. The grammar adds the missing concept of an order's *shape*, derived from the `category` column:
- **Hard rules** — same daypart, at least one main, caps on sides/desserts, a portion-weight ceiling. Only things that are impossible or that nobody orders.
- **Shape classification** — `classic` / `single` / `stack`, so results deliberately span several kinds of order instead of restating one.
- Stacking mains is **allowed on purpose**: two sandwiches is a real order, and excluding it would be the algorithm imposing taste.

Known limitation: `category` conflates daypart (`breakfast`), role (`side`) and form factor (`taco`), so role/daypart/weight are derived in code rather than stored. They should become real columns when the data layer is rebuilt for dynamic ingestion.

**What's next** (from the project goals doc):
1. **Per-restaurant pages** — `/restaurant/[slug]` routes reached from the homepage, each with quick high-protein / low-carb / low-fat sections
2. **Dynamic menu ingestion** — pre-populated backend plus a fallback that fetches restaurants not yet in the database, with freshness/provenance tracking. Note this needs a hosted database: `better-sqlite3` writes to `process.cwd()`, which won't work on a read-only serverless filesystem
3. **Pricing** — real cost data, price constraints ("under $10") as distinct from price preferences ("cheaper"), and cheaper options mixed into the result set as another stratum
