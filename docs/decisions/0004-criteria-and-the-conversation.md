# 0004 — Criteria as a first-class value, and a stateless conversation

**Status:** accepted · 2026-11-16

## The problem

A search was four loose values (goals, one calorie number, a budget flag, an
unused variety flag). That could not express "under 800" as distinct from
"around 800", could not express a price cap, and had nowhere to keep state
between messages — the storefront search simply replaced the previous one.

## The decision

**`Criteria` (`lib/criteria.ts`) holds three kinds of statement apart**, because
the engine treats them differently:

- **constraints** — "under 800 cal", "under $8", "at least 40g protein", "no
  fries". Never crossed.
- **targets** — "around 800 cal". Aimed for.
- **preferences** — "high protein", "cheap", "variety". Used to rank.

**The parser returns a `CriteriaPatch`, not a `Criteria`.** A patch records what
*this message* said, with `undefined` meaning "didn't mention it". Applying a
patch replaces statements about the same thing and leaves the rest: "under 600"
after "around 800" changes the calories and keeps the protein goal.

**Criteria can be written as text the parser reads back to the same Criteria**
(`canonicalText`, tested as a round trip). The server returns that text as
`criteria.canonical`; the client sends it back as `context` with the next
message. So:

- the conversation needs **no session on the server** — it works on a
  serverless host with nothing shared between requests;
- a **link** restores a search exactly: `/restaurant/chipotle?q=high+protein,+under+800+cal`;
- **removing a chip** is just a search for the text without that phrase — the
  server precomputes it as `chip.without`.

**Menu words are resolved against the menu, not by the parser.** "nuggets" is a
requirement at Chick-fil-A and noise at Chipotle. The parser hands back what it
didn't understand; `lib/search.ts` matches it against the restaurant's actual
items and reports anything that matched nothing.

**`variety` is wired up** rather than deleted: it filters to orders with nothing
doubled.

## Alternatives rejected

- **Server-side sessions.** Needs storage and expiry, and breaks links.
- **Sending structured criteria as JSON from the client.** Makes the client
  responsible for merge rules, and a URL carrying JSON is not something a
  person can read or edit.
- **An LLM to parse.** Needs a key, costs money per search, and is not
  reproducible in tests. Every phrase the keyword parser understands is listed
  in one file.

## Known limits

The parser is English keywords. Quantities ("2 tacos") are ignored. A recognised
concept we hold no data for (sugar, allergens, vegan) is reported as
unsupported rather than silently dropped.
