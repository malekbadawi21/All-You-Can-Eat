# 0006 — Search the all-day menu unless breakfast is asked for

**Status:** accepted · 2026-11-16

## The problem

The grammar already stopped a breakfast item sharing an order with a lunch
main. But breakfast-only orders still appeared in ordinary searches: "low carb
taco bell" returned two Breakfast Soft Tacos and a dessert. At two in the
afternoon that order cannot be placed.

## The decision

A search is for one menu or the other. `Criteria.daypart` is `"all-day"` unless
the query says breakfast, brunch or morning; then mains must be breakfast items
(sides and desserts from either menu are fine). If a restaurant has no
breakfast on record, the user is told and shown the all-day menu.

## Alternatives rejected

- **Use the visitor's local time.** Results would change by the hour with no
  visible reason, links would stop being reproducible, and tests would need a
  clock. The UI can offer a "Breakfast" chip instead, which is explicit.
- **Mix both and label them.** Doubles the result set to answer a question most
  searches aren't asking.
