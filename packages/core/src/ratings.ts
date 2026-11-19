import type { Ladder } from "./types";

/**
 * "Rate the market's outcomes": instead of drawing a curve, the user says which ranges are more or
 * less likely than the market thinks. Ranges are grouped so each holds a similar share of the
 * market's chance, and each rating scales that range's market probability.
 */

export interface OutcomeGroup {
  /** First and last bucket (inclusive). */
  lo: number;
  hi: number;
  marketProb: number;
}

/** Splits the buckets into at most `n` contiguous ranges holding roughly equal market probability. */
export function groupByMass(ladder: Ladder, n = 5): OutcomeGroup[] {
  const q = ladder.marketProb;
  const groups: OutcomeGroup[] = [];
  let lo = 0;
  let cum = 0;
  let mass = 0;
  for (let j = 0; j < q.length; j++) {
    cum += q[j];
    mass += q[j];
    const remainingBuckets = q.length - 1 - j;
    const remainingGroups = n - groups.length - 1;
    const target = (groups.length + 1) / n;
    if (j === q.length - 1 || (cum >= target - 1e-9 && remainingBuckets >= 1 && remainingGroups >= 1) || remainingBuckets < remainingGroups) {
      if (j === q.length - 1 || remainingGroups >= 1) {
        groups.push({ lo, hi: j, marketProb: mass });
        lo = j + 1;
        mass = 0;
      }
    }
  }
  return groups;
}

/** How much one step of rating moves a range's probability (×e^0.5 ≈ 1.65 more likely, ×0.61 less). */
export const RATING_STEP = 0.5;

/**
 * Belief from ratings: each bucket's market probability times exp(rating × step) for its range
 * (rating −2..2, 0 = "about right"), renormalized. All zeros returns the market itself.
 */
export function fromRatings(ladder: Ladder, groups: readonly OutcomeGroup[], ratings: readonly number[], step = RATING_STEP): number[] {
  const q = ladder.marketProb;
  const out = q.slice();
  groups.forEach((g, k) => {
    const f = Math.exp((ratings[k] ?? 0) * step);
    for (let j = g.lo; j <= g.hi; j++) out[j] = q[j] * f;
  });
  const s = out.reduce((a, b) => a + b, 0);
  return out.map((x) => x / s);
}
