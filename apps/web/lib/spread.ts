import type { Quote } from "@contour/core";

/**
 * Whether a position actually spreads the money put in across outcomes, or is one all-or-nothing
 * bet with part of the amount held back. Holding cash back lowers the risk, but it isn't a hedge,
 * and the screen should say which one the user is getting.
 *
 * Only the money put in is looked at: each outcome's payout minus the cash kept back (that cash
 * comes back in every outcome). One contract plus cash returns one of two things: nothing, or its
 * payout. So the test is how likely anything else is: the market's chance of the outcomes that
 * return neither (nearly) nothing nor the single most likely payout. Below MIN_OTHER the position
 * has little to no spread. Market odds are used so the label doesn't flip with the
 * "your forecast / market odds" toggle.
 */
const MIN_OTHER = 0.05;
const NOTHING = 0.05;

export interface Spread {
  /** True when what's put in is spread across outcomes (a hedge), false when it's (nearly) all-or-nothing. */
  spread: boolean;
  /** Money put in: contracts and fees. */
  atRisk: number;
  /** Money held back, which comes back in every outcome. */
  kept: number;
  stake: number;
  /** Market's chance of the in-between outcomes (the spread itself). */
  other: number;
}

export function spreadOf(quote: Pick<Quote, "payoutByBucket" | "cashUsd" | "stakeBase" | "legs">, marketProb: readonly number[]): Spread {
  const stake = quote.stakeBase / 1e6;
  const kept = Math.max(0, quote.cashUsd);
  const atRisk = Math.max(0, stake - kept);
  if (!quote.legs.length || atRisk < 0.01) return { spread: false, atRisk, kept, stake, other: 0 };

  // Group outcomes by what the money put in returns (to the nearest 1% of it, at least 50¢).
  const step = Math.max(0.5, atRisk * 0.01);
  let nothing = 0;
  const levels = new Map<number, number>();
  quote.payoutByBucket.forEach((p, j) => {
    const back = Math.max(0, p - kept);
    const chance = marketProb[j] ?? 0;
    if (back <= atRisk * NOTHING) nothing += chance;
    else levels.set(Math.round(back / step), (levels.get(Math.round(back / step)) ?? 0) + chance);
  });
  const main = Math.max(0, ...levels.values());
  const total = marketProb.reduce((a, b) => a + b, 0) || 1;
  const other = Math.max(0, (total - nothing - main) / total);
  return { spread: other >= MIN_OTHER, atRisk, kept, stake, other };
}
