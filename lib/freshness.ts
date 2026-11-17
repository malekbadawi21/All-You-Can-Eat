import type { SourceInfo } from "./db";

// ── How old is too old ───────────────────────────────────────────────────────
//
// Every figure in the app carries the date it was read from its source. This
// module turns that date into a judgement the UI and the CLI can both use.
//
// The thresholds are policy, not science. Chains reformulate and re-publish
// nutrition a few times a year at most, so a year is generous. Prices move far
// faster and were only ever national averages to begin with, so they are held
// to half that.

export const STALE_AFTER_DAYS: Record<SourceInfo["kind"], number> = {
  nutrition: 365,
  price: 180,
};

export interface Freshness {
  /** Whole days since the figures were read. */
  age_days: number;
  /** True once the figures are older than the policy allows for their kind. */
  stale: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function freshnessOf(
  source: Pick<SourceInfo, "kind" | "fetched_at">,
  now: Date = new Date()
): Freshness {
  const fetched = Date.parse(source.fetched_at);
  // An unreadable date is treated as stale: not knowing how old a number is
  // should never be reported as "fresh".
  if (Number.isNaN(fetched)) return { age_days: Number.POSITIVE_INFINITY, stale: true };

  const age_days = Math.max(0, Math.floor((now.getTime() - fetched) / DAY_MS));
  return { age_days, stale: age_days > STALE_AFTER_DAYS[source.kind] };
}
