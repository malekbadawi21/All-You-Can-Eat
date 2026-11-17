# 0003 — Score goals on density, and give every search a meal size

**Status:** accepted · 2026-11-16

## The problem

The two halves of the old engine scored goals differently, and both ways were
wrong in a way the defect table shows.

- **Fixed menus averaged a per-item score.** Each item was scored against the
  goal on its own and the order's score was the mean. A small low-carb dessert
  has a good low-carb score, so adding it *raised* the average while making the
  order worse. That is how Cinnabon Delights got into "low carb taco bell".
- **Build-your-own compared totals.** Every ingredient has some protein, so the
  highest-protein order was simply the biggest: a 1,310 calorie burrito with
  double rice and double beans for "cheapest high protein chipotle".

## The decision

**1. A goal is scored on density: grams per 100 calories of the whole order**
(`lib/scoring.ts`). "High protein" does not mean "eat more"; it means "of what
I eat, make a lot of it protein". Density says exactly that and is unaffected
by how big the order is.

**2. How big the order should be is a separate question, and every search has
an answer to it** — the calorie plan:

| The user said | Hard bounds | Aim for |
|---|---|---|
| "around 800" | none | 800, window 680–920 |
| "under 800" | ≤ 800 | an ordinary meal if one fits; undershooting is cheap |
| "at least 900" | ≥ 900 | a little above it |
| "500–700" | both | the middle |
| nothing | none | 700, window 350–1050 |
| "low calorie" / "bulking", no number | none | 450 / 1000 |

Without the last three rows, density alone picks the smallest, leanest thing on
the board every time.

**3. Hard and soft are kept apart.** A hard bound the user stated is never
crossed; if nothing satisfies it the user is told (`lib/notices.ts`) and shown
the nearest misses, labelled "Closest match". The soft window is only a
preference: when nothing lands in it, the nearest orders are used — and if the
user had named the number, they are told that too.

**4. Normalising uses the 2nd–98th percentile, not min and max.** One freak
candidate (two orders of grilled nuggets is 19g of protein per 100 calories)
otherwise sets the top of the scale alone and squashes every ordinary order
into an indistinguishable band at the bottom.

**5. With no goal stated**, there is a mild default (protein density, low
weight) so results aren't arbitrary, and two small priors: toward a main with a
side, and away from double portions that are only there because doubling is
free.

## Alternatives rejected

- **Totals inside a calorie window.** Works when the user names a target and
  falls apart when they don't: "high" goals drift to the top of whatever window
  is assumed, "low" goals to the bottom.
- **Fixed absolute scales for ranking** (protein 0–20g/100 cal mapped to 0–1).
  Stable and comparable, but real orders occupy a narrow slice of that range,
  so the differences between them are swamped by price. Absolute scales *are*
  used where one order has to be judged alone: deciding whether one more
  topping helps, and whether an alternative is good enough to show.
- **Leaving "low calorie" as a quantity to minimise.** It returns a four-piece
  nugget, or — before the data fix — a lone 15 calorie side salad. Read as "a
  light meal", it returns meals.

## What it costs

There are tuning constants (`weightsFor`, the windows, the priors). Each is
named and commented where it lives, and the tests assert the *behaviour* they
produce, never the constants themselves.
