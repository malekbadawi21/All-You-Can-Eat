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
- `app/api/menu/route.ts` — API route that reads from local data and returns menu items for a given restaurant
- `data/restaurants.json` — nutrition data for Chick-fil-A, McDonald's, and Chipotle

**Data model decisions:**
- Fixed-menu restaurants (Chick-fil-A, McDonald's) use `type: "fixed"` with a flat list of `items`
- Build-your-own restaurants (Chipotle) use `type: "build-your-own"` with individual `components` (protein, rice, beans, toppings, salsa) and a `slots` section describing how a meal is constructed
- This distinction matters for the optimizer: fixed restaurants rank items, build-your-own restaurants find the best combination of ingredients

**What's next:**
1. Build the NLP keyword parser — takes a plain English query like "high protein low carb" and extracts the user's goals
2. Build the optimizer/scoring logic — ranks fixed items or builds an optimal combination based on those goals
3. Build the search UI on the homepage to connect it all together
