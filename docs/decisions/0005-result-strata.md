# 0005 — Results are named strata: one best match, then real alternatives

**Status:** accepted · 2026-11-16

## The problem

Fixed menus returned five results with repeated labels ("Classic meal" twice,
"Double up" twice). Build-your-own returned three ("Best match", "Balanced",
"Most variety"). The UI showed the first three of either. And the "variety"
position was filled regardless of merit — 31g of protein beside 114g.

## The decision

Both kinds of restaurant return **up to five results with unique labels**, built
the same way (`lib/selectResults.ts`):

| Label | Filled by |
|---|---|
| **Best match** | the highest score |
| Classic meal / No sides / Double up | fixed menus: the best order of each shape the best match *isn't* |
| Most variety | builds: nothing doubled, when the best match doubles up |
| Switch it up | builds: a different backbone |
| Budget pick | at least 15% cheaper than the best match and cheaper than everything above |
| Lighter option | at least 20% fewer calories (not offered when a calorie target was named) |

Each result also carries `shape` (classic / single / stack / build), so the
best match can still say what kind of order it is.

Two rules apply to every stratum after the first:

1. **A different idea.** Fixed menus: different mains, and no main in more than
   two results. Builds: less than half the backbone in common. Nutritionally
   identical options (Chipotle's Bowl and Salad; black and pinto beans) count as
   the same component, so swapping one is not a different order.
2. **Within reach of the best match** on the stated goals (55% of its density
   for a "high" goal; 1.8× for a "low" one). An alternative may be worse. It may
   not contradict the question.

A stratum with no candidate that passes is simply left out. If fewer than three
survive, the next-best different ideas top it up.

## Why not keep the old labels

"Balanced" described the engine's internals (a variety weight of 0.45), not
anything a person choosing lunch would recognise. "Just the main" was wrong for
three tacos. The new labels each say what distinguishes that order from the one
above it.

## Alternatives rejected

- **Top N by score.** Five takes on one idea.
- **Always fill every stratum.** That is the 31g-next-to-114g defect.
