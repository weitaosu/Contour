import { blend, likelyRange } from "./beliefs";
import { compile } from "./compile";
import { assemble, type LegSpec } from "./protect";
import type { Ladder, Quote } from "./types";

/**
 * "Don't protect against losing everything." The growth-optimal solver never lets an outcome pay
 * $0 (log utility treats losing it all as infinitely bad), so it keeps a floor: cash, and contracts
 * that pay a little in outcomes you think are unlikely. With protection off:
 *
 *  1. outcomes outside your likely range (the smallest run of outcomes holding `range` of your
 *     blended forecast) are treated as not happening, so nothing is spent on them;
 *  2. the solver picks contracts for what's left, at full trust;
 *  3. everything it kept as cash goes into those same contracts, in the same proportions.
 *
 * Outside the range the position can pay $0. Inside it, payouts rise, so more outcomes clear the
 * stake. At the market's odds the average is unchanged (less fees); the money moves from the tails
 * into the range.
 */
export function noFloor(input: { ladder: Ladder; belief: number[]; confidence: number; stakeUsd: number; range?: number }): Quote & {
  range: { from: number; to: number; mass: number };
} {
  const { ladder, belief, confidence, stakeUsd } = input;
  const mass = Math.min(0.999, Math.max(0.5, input.range ?? 0.9));
  const p = blend(belief, ladder.marketProb, confidence);
  const [a, b] = likelyRange(p, mass);
  const tiny = 1e-9;
  const kept = p.map((x, j) => (j >= a && j <= b ? x : tiny));
  const s = kept.reduce((x, y) => x + y, 0);
  const truncated = kept.map((x) => x / s);

  const base = compile({ ladder, belief: truncated, confidence: 1, stakeUsd });
  const range = { from: a, to: b, mass };
  if (!base.legs.length) return { ...base, range };

  // Put the cash into the same contracts, scaled up so contracts + fees use the whole stake.
  const specs: LegSpec[] = base.legs.map((l) => ({ i: l.instrumentIndex, side: l.side, qty: l.qty }));
  const invested = stakeUsd - base.cashUsd;
  const k = invested > 0 ? stakeUsd / invested : 1;
  const floor2 = (x: number) => Math.floor(x * 100 + 1e-9) / 100;
  for (const sp of specs) sp.qty = floor2(sp.qty * k);
  let out = assemble(ladder, specs, base.stakeBase, base.feeRate);
  for (let guard = 0; out.cashUsd < 0 && guard < 2000; guard++) {
    const big = specs.reduce((x, y) => (y.qty > x.qty ? y : x));
    big.qty = floor2(big.qty - 0.01);
    out = assemble(ladder, specs, base.stakeBase, base.feeRate);
  }
  const stake = out.stakeBase / 1e6;
  return {
    ...out,
    comparison: base.comparison,
    advice: base.advice,
    evUnderBelief: belief.reduce((x, q, j) => x + q * out.payoutByBucket[j], 0),
    probProfitBelief: belief.reduce((x, q, j) => x + (out.payoutByBucket[j] > stake + 1e-9 ? q : 0), 0),
    range,
  };
}
