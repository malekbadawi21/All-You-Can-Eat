import type { Criteria } from "./criteria";
import { MEAL_SHAPES, SHAPE_LABELS } from "./mealGrammar";
import type { ScoredCandidate } from "./optimize";
import { withinReachOf, type CaloriePlan } from "./scoring";

// ── Choosing what to show ────────────────────────────────────────────────────
//
// Scoring ranks every candidate; this decides which handful to return. They
// are different problems. The top five by score are five takes on one idea —
// whichever item best serves the goal appears in all of them.
//
// So the result set is built from *strata*: named positions, each filled by
// the best candidate that fits its description.
//
//   Best match        the highest score, full stop
//   another shape     fixed menus: a classic main-and-side, a lone main, a
//                     double-up — whichever the best match isn't
//   Most variety      builds: nothing doubled, when the best match doubles up
//   Switch it up      builds: a different backbone
//   Budget pick       noticeably cheaper than anything above it
//   Lighter option    noticeably fewer calories than anything above it
//
// Every label is used at most once, both kinds of restaurant return up to
// five, and the first three are the ones worth putting in the windows. That
// replaces "five results with repeated labels on fixed menus, three on
// build-your-own".
//
// Two rules hold for every stratum after the first:
//
//   • It must be a different idea — different mains, or a substantially
//     different build — not the best match with the beans swapped.
//   • It must be within reach of the best match on the stated goals
//     (scoring.withinReachOf). An alternative may be worse; it may not be so
//     much worse that it contradicts the question. This is what stops a 31g
//     "Most variety" sitting next to a 114g "Best match".

export interface Ranked {
  label: string;
  candidate: ScoredCandidate;
}

export interface SelectOptions {
  kind: "meal" | "build";
  criteria: Criteria;
  plan: CaloriePlan;
  /** True when no order met the hard constraints and these are near misses. */
  closest: boolean;
  limit: number;
}

/** How many results one main item may appear in. See the note on distinct(). */
const MAX_MAIN_APPEARANCES = 2;

/** Builds sharing this fraction of their backbone, or more, are the same idea. */
const MAX_BUILD_OVERLAP = 0.5;

function overlap(a: Set<number>, b: Set<number>): number {
  let shared = 0;
  for (const id of a) if (b.has(id)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

export function selectResults(pool: ScoredCandidate[], options: SelectOptions): Ranked[] {
  if (pool.length === 0) return [];

  const { kind, criteria, plan, closest, limit } = options;
  const byMerit = [...pool].sort((a, b) => b.merit - a.merit);
  const best = byMerit[0];

  const chosen: Ranked[] = [];
  const taken = new Set<ScoredCandidate>();
  const mainAppearances = new Map<string, number>();

  const take = (label: string, candidate: ScoredCandidate) => {
    chosen.push({ label, candidate });
    taken.add(candidate);
    for (const main of new Set(candidate.mains)) {
      mainAppearances.set(main, (mainAppearances.get(main) ?? 0) + 1);
    }
  };

  /**
   * Is this a different idea from everything already chosen?
   *
   * Fixed menus: different mains, and no single main in more than two results
   * ("Double Quarter Pounder alone" and "…with fries" are both worth offering;
   * the same burger in all five is the defect this exists to prevent).
   *
   * Builds: at most half the backbone in common with any chosen build, which
   * is what rejects a one-component swap as a "different" option.
   */
  const distinct = (c: ScoredCandidate) => {
    if (kind === "meal") {
      if (chosen.some((r) => r.candidate.signature === c.signature)) return false;
      return c.mains.every((m) => (mainAppearances.get(m) ?? 0) < MAX_MAIN_APPEARANCES);
    }
    return chosen.every((r) => overlap(r.candidate.core, c.core) < MAX_BUILD_OVERLAP);
  };

  const worthy = (c: ScoredCandidate) =>
    !taken.has(c) &&
    distinct(c) &&
    withinReachOf(c.totals, best.totals, criteria.goals);

  const fill = (label: string, fits: (c: ScoredCandidate) => boolean) => {
    if (chosen.length >= limit) return;
    const pick = byMerit.find((c) => worthy(c) && fits(c));
    if (pick) take(label, pick);
  };

  take(closest ? "Closest match" : "Best match", best);

  // ── Structural alternatives ───────────────────────────────────────────────
  if (kind === "meal") {
    for (const shape of MEAL_SHAPES) {
      if (shape !== best.shape) fill(SHAPE_LABELS[shape], (c) => c.shape === shape);
    }
  } else {
    // "Most variety" is the one stratum allowed to overlap heavily with the
    // best match, because that is what it is: the same combo with three
    // different sides instead of three of one. It must still be a different
    // build with strictly more different things in it.
    if (best.repeats && chosen.length < limit) {
      const varied = byMerit.find(
        (c) =>
          !taken.has(c) &&
          !c.repeats &&
          c.core.size > best.core.size &&
          withinReachOf(c.totals, best.totals, criteria.goals)
      );
      if (varied) take("Most variety", varied);
    }
    fill("Switch it up", () => true);
  }

  // ── Cheaper ───────────────────────────────────────────────────────────────
  //
  // "Noticeably": at least 15% under the best match and under everything
  // already shown. A pick that saves a quarter isn't a budget pick.
  if (best.totals.price !== null) {
    const floor = Math.min(...chosen.map((r) => r.candidate.totals.price ?? Infinity));
    fill(
      "Budget pick",
      (c) =>
        c.totals.price !== null &&
        c.totals.price <= best.totals.price! * 0.85 &&
        c.totals.price <= floor * 0.92
    );
  }

  // ── Lighter ───────────────────────────────────────────────────────────────
  //
  // Not offered when the user named a calorie target or a range: they have
  // already said how much they want to eat.
  const statedSize = plan.explicitTarget || (plan.hardMin !== null && plan.hardMax !== null);
  if (!statedSize) {
    const floor = Math.min(...chosen.map((r) => r.candidate.totals.calories));
    fill(
      "Lighter option",
      (c) => c.totals.calories <= best.totals.calories * 0.8 && c.totals.calories <= floor * 0.95
    );
  }

  // A short list is worse than a slightly repetitive one: three windows want
  // three orders. Top up with the next best thing that is still a different
  // idea.
  if (chosen.length < 3) fill("Also good", () => true);
  if (chosen.length < 3) fill("Another way", () => true);

  return chosen;
}
