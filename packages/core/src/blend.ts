import { GEMINI_TAKER_FEE_RATE } from "./fees";
import { assemble, type LegSpec } from "./protect";
import type { Ladder, Quote } from "./types";

/**
 * Mix a solved position with the single best contract for the same stake: t = 1 is the position as
 * solved (spread out), t = 0 is everything on the single contract (`quote.comparison`). Payouts add
 * linearly, so t of each solved leg plus (1 − t) of the single contract costs the same stake and pays
 * t × one + (1 − t) × the other in every outcome. The endpoints match exactly; Gemini's per-order fee
 * rounding can shave a cent or two in between, which comes out of the cash.
 */
export function blendWithSingle(
  ladder: Ladder,
  quote: Pick<Quote, "legs" | "comparison" | "stakeBase" | "feeRate" | "advice">,
  t: number,
  belief?: readonly number[],
): Quote {
  const tt = Math.min(1, Math.max(0, t));
  const feeRate = quote.feeRate ?? GEMINI_TAKER_FEE_RATE;
  const cmp = quote.comparison;
  const cmpIndex = cmp ? ladder.instruments.findIndex((i) => i.symbol === cmp.symbol) : -1;
  const floor2 = (x: number) => Math.floor(x * 100 + 1e-9) / 100;

  const merged = new Map<string, LegSpec>();
  const add = (i: number, side: "yes" | "no", qty: number) => {
    if (qty <= 0) return;
    const k = `${i}:${side}`;
    const m = merged.get(k);
    if (m) m.qty += qty;
    else merged.set(k, { i, side, qty });
  };
  if (tt > 0 || cmpIndex < 0) for (const l of quote.legs) add(l.instrumentIndex, l.side, l.qty * (cmpIndex < 0 ? 1 : tt));
  if (cmp && cmpIndex >= 0 && tt < 1) add(cmpIndex, cmp.side, cmp.qty * (1 - tt));
  const specs = [...merged.values()].map((s) => ({ ...s, qty: floor2(s.qty) }));

  let out = assemble(ladder, specs, quote.stakeBase, feeRate);
  // Rounded-up fees can overshoot the stake by a cent or two mid-way: trim the biggest leg until it fits.
  for (let guard = 0; out.cashUsd < 0 && guard < 500; guard++) {
    const big = specs.reduce((a, b) => (b.qty > a.qty ? b : a));
    big.qty = floor2(big.qty - 0.01);
    out = assemble(ladder, specs, quote.stakeBase, feeRate);
  }

  const stake = quote.stakeBase / 1e6;
  const p = belief ?? ladder.marketProb;
  return {
    ...out,
    comparison: cmp,
    advice: quote.advice,
    evUnderBelief: p.reduce((a, x, j) => a + x * out.payoutByBucket[j], 0),
    probProfitBelief: p.reduce((a, x, j) => a + (out.payoutByBucket[j] > stake + 1e-9 ? x : 0), 0),
  };
}
