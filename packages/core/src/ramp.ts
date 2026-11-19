import { costPerContract, GEMINI_TAKER_FEE_RATE, tradingFeeUsd } from "./fees";
import { isTradable } from "./normalize";
import { assemble, type LegSpec } from "./protect";
import type { Ladder, Quote } from "./types";
import { bucketOf } from "./zone";

/**
 * Ramp bets: the same idea as a single contract at your estimate, but with a slope instead of a
 * cliff. Both go to $0 far from the estimate; the ramp gives up some of the best case to pay part of
 * the stake back on near misses, one strike at a time.
 *
 * Built from equal amounts of the same contract on `steps` neighbouring strikes. Higher: YES on the
 * strike at or just below your price and the (steps − 1) strikes under it, so every strike the price
 * clears adds one step of payout. Lower: NO on the strike just above your price and the ones over it.
 * steps = 1 is the single contract (the cliff); more steps is a gentler slope.
 *
 * Stays near: a YES ramp below the price and a NO ramp above it. On a price ladder one of the two
 * sides always pays, so part of the stake always comes back ("guaranteed"); the rest is the bet.
 */

export type RampDirection = "higher" | "lower" | "around";

/** Strike indexes on one side, nearest the price first, skipping untradable ones. */
function sideStrikes(ladder: Ladder, price: number, side: "below" | "above"): number[] {
  const p = bucketOf(ladder, price); // strikes 0..p−1 are at or below the price, p.. are above it
  const out: number[] = [];
  if (side === "below") for (let i = p - 1; i >= 0; i--) isTradable(ladder, i) && out.push(i);
  else for (let i = p; i < ladder.strikes.length; i++) isTradable(ladder, i) && out.push(i);
  return out;
}

/** The most steps a ramp can have here (capped at `cap`). 0 if there is nothing to build. */
export function maxRampSteps(ladder: Ladder, price: number, direction: RampDirection, cap = 8): number {
  if (ladder.kind !== "threshold") return 0;
  const below = sideStrikes(ladder, price, "below").length;
  const above = sideStrikes(ladder, price, "above").length;
  const n = direction === "higher" ? below : direction === "lower" ? above : Math.min(below, above);
  return Math.min(cap, n);
}

/** One contract of each leg: the shape of the ramp before sizing. */
export function rampLegs(ladder: Ladder, price: number, direction: RampDirection, steps: number): LegSpec[] {
  const s = Math.max(1, Math.min(steps, maxRampSteps(ladder, price, direction, 99)));
  const yes = direction !== "lower" ? sideStrikes(ladder, price, "below").slice(0, s).map((i): LegSpec => ({ i, side: "yes", qty: 1 })) : [];
  const no = direction !== "higher" ? sideStrikes(ladder, price, "above").slice(0, s).map((i): LegSpec => ({ i, side: "no", qty: 1 })) : [];
  return [...yes, ...no];
}

const floorTo = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;

export interface RampInfo {
  direction: RampDirection;
  steps: number;
  /** Contracts of each leg. */
  qty: number;
  /** Paid back in every outcome (Stays near only: one side of the ramp always pays). */
  guaranteedUsd: number;
  /** What the market thinks you get back on average. */
  expectedBackMarket: number;
}

/** Sizes a ramp to `stakeUsd` (contracts + fees fit inside it; any remainder stays as cash). */
export function buildRamp(input: {
  ladder: Ladder;
  price: number;
  direction: RampDirection;
  steps: number;
  stakeUsd: number;
  feeRate?: number;
}): Quote & { ramp: RampInfo } {
  const { ladder, price, direction, stakeUsd } = input;
  const feeRate = input.feeRate ?? GEMINI_TAKER_FEE_RATE;
  if (ladder.kind !== "threshold") throw new Error("ramps need a price ladder");
  if (!(stakeUsd > 0)) throw new Error("stake must be positive");
  const unit = rampLegs(ladder, price, direction, input.steps);
  if (!unit.length) throw new Error("no tradable strikes on that side of the price");
  const ask = (l: LegSpec) => (l.side === "yes" ? ladder.instruments[l.i].yesAsk! : ladder.instruments[l.i].noAsk!);
  const unitCost = unit.reduce((a, l) => a + costPerContract(ask(l), feeRate), 0);
  const step = Math.max(0.01, ...unit.map((l) => ladder.instruments[l.i].qtyStep));
  const stakeBase = Math.round(stakeUsd * 1e6);
  const total = (q: number) =>
    unit.reduce((a, l) => a + Math.round(q * ask(l) * 1e6) + Math.round(tradingFeeUsd(q, ask(l), feeRate) * 1e6), 0);
  let qty = floorTo(stakeUsd / unitCost, step);
  while (qty > 0 && total(qty) > stakeBase) qty = floorTo(qty - step, step);
  const minQty = Math.max(0, ...unit.map((l) => ladder.instruments[l.i].minQty));
  if (qty < minQty) qty = 0;
  const quote = assemble(ladder, unit.map((l) => ({ ...l, qty })), stakeBase, feeRate);
  const legsMin = Math.min(...quote.payoutByBucket) - quote.cashUsd;
  return {
    ...quote,
    ramp: {
      direction,
      steps: direction === "around" ? unit.length / 2 : unit.length,
      qty,
      guaranteedUsd: Math.max(0, Math.round(legsMin * 100) / 100),
      expectedBackMarket: ladder.marketProb.reduce((a, p, j) => a + p * quote.payoutByBucket[j], 0),
    },
  };
}
