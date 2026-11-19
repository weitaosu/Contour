import { bucketMidpoints, marketMoments } from "./beliefs";
import { costPerContract, GEMINI_TAKER_FEE_RATE, tradingFeeUsd } from "./fees";
import { isReversed, isTradable, paysIn } from "./normalize";
import type { Ladder, Leg, Quote } from "./types";

/**
 * Strategies built directly from the ladder's contracts (no solver): a protective floor, a collar,
 * a covered call, and call/put spreads. A ladder of "price ≥ K" contracts is a strip of digital
 * options, so stacking them strike by strike rebuilds the payoff of a classic options strategy at
 * expiry, in one-strike steps, between the lowest and highest strikes Gemini lists.
 *
 * Why not the growth-optimal solver for protection? Maximizing E[log(holding + payout)] at market
 * odds buys no protection at all: insurance costs fees and spread on average, and log utility on a
 * modest holding won't pay for it. A floor is what people mean by protection, so it's built directly.
 */

const roundTo = (x: number, step: number) => Math.round(x / step) * step;
const floorTo = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;

/** One leg to buy: instrument index, side and contract quantity. */
interface LegSpec {
  i: number;
  side: "yes" | "no";
  qty: number;
}

/**
 * Prices a set of legs into a full quote: contract costs at the ask, Gemini's fee per order, cash,
 * and the payout per outcome. `stakeBase` null means "the stake is what the legs cost" (rounded up
 * to the cent); otherwise the legs must fit inside it and the remainder is cash.
 */
function assemble(ladder: Ladder, specs: LegSpec[], stakeBase: number | null, feeRate: number): Quote {
  const nB = ladder.marketProb.length;
  const legs: Leg[] = [];
  const payoutBase = new Array<number>(nB).fill(0);
  let spentBase = 0;
  let feeBase = 0;
  for (const { i, side, qty } of specs) {
    if (qty <= 0) continue;
    const ins = ladder.instruments[i];
    const q = Math.round(qty * 1e6) / 1e6;
    const price = (side === "yes" ? ins.yesAsk : ins.noAsk)!;
    const costBase = Math.round(q * price * 1e6);
    const fBase = Math.round(tradingFeeUsd(q, price, feeRate) * 1e6);
    spentBase += costBase;
    feeBase += fBase;
    const payBase = Math.round(q * 1e6);
    for (let j = 0; j < nB; j++) if (paysIn(ladder, i, side, j)) payoutBase[j] += payBase;
    legs.push({ symbol: ins.symbol, label: ins.label, side, strike: ladder.strikes[i] ?? null, instrumentIndex: i, price, qty: q, usd: costBase / 1e6, fee: fBase / 1e6, capped: false });
  }
  const totalBase = spentBase + feeBase;
  const stake = stakeBase ?? Math.max(10_000, Math.ceil(totalBase / 10_000) * 10_000);
  const cashBase = stake - totalBase;
  for (let j = 0; j < nB; j++) payoutBase[j] += cashBase;
  const payout = payoutBase.map((b) => b / 1e6);
  const q = ladder.marketProb;
  const profit = payoutBase.map((b) => b > stake);
  const probProfit = q.reduce((a, p, j) => a + (profit[j] ? p : 0), 0);
  return {
    legs,
    cashUsd: cashBase / 1e6,
    feesUsd: feeBase / 1e6,
    feeRate,
    payoutByBucket: payout,
    scheduleBase: payoutBase,
    stakeBase: stake,
    minPayout: Math.min(...payout),
    maxPayout: Math.max(...payout),
    evUnderBelief: q.reduce((a, p, j) => a + p * payout[j], 0),
    evUnderMarket: q.reduce((a, p, j) => a + p * payout[j], 0),
    probProfitBelief: probProfit,
    probProfitMarket: probProfit,
    // These positions can pay nothing in some outcomes, so log growth of the position alone isn't meaningful.
    expectedLogGrowth: 0,
    advice: legs.length ? "trade" : "no_edge",
    comparison: null,
    maxAbsorbableStakeUsd: null,
    raw: { weights: [], instruments: [], payoutByBucket: payout, expectedLogGrowth: 0, iterations: 0, converged: true },
  };
}

// ---------------------------------------------------------------------------------------------
// Protect what I hold: floor, collar, covered call
// ---------------------------------------------------------------------------------------------

export interface ProtectInput {
  ladder: Ladder;
  /** How much of the underlying the user holds (e.g. 10 SOL). */
  units: number;
  /**
   * Protection starts below this price (a strike). NO on "$K or above" pays $1 if the price ends
   * below $K, so `units` of NO on every strike from the floor down pays `units` dollars for each
   * dollar the price falls below the floor, down to the lowest strike. Omit for a covered call.
   */
  floor?: number | null;
  /**
   * Give up gains above this price, up to the ladder's top strike. Built from NO contracts above the
   * cap: they pay back $1 each unless the price rises past them, which is the "premium" of selling
   * the upside. With a floor it's a collar; without one it's a covered call.
   */
  cap?: number;
  feeRate?: number;
  /** Smallest leg worth placing; smaller pieces merge into the next strike up (slightly over-covering). */
  minLegUsd?: number;
}

export interface ProtectionInfo {
  units: number;
  /** null for a covered call (no protection below). */
  floor: number | null;
  /** Gains above this are given up, up to `capTop` (collar and covered call). */
  cap: number | null;
  capTop: number | null;
  /** With a cap: what comes back if the price ends below the cap (and above the floor, if any). */
  backInMiddle: number | null;
  /** Lowest strike the floor reaches: below this, protection stops growing. null without a floor. */
  coveredDownTo: number | null;
  /** Reference price the holding is valued against (the market's expected price). */
  reference: number;
  /** Change in the holding's value per outcome vs the reference, at each bucket's midpoint. */
  holdingChange: number[];
}

export function protect(input: ProtectInput): Quote & { protection: ProtectionInfo } {
  const { ladder, units } = input;
  const floor = input.floor ?? null;
  const feeRate = input.feeRate ?? GEMINI_TAKER_FEE_RATE;
  // Lower than the solver's $1: these need one leg per strike to keep their staircase shape, and
  // Gemini's own minimum is 0.01 contracts. The cost is a cent of rounded-up fee per extra order.
  const minLegUsd = input.minLegUsd ?? 0.1;
  if (ladder.kind !== "threshold" || !ladder.cuts || isReversed(ladder)) throw new Error("protection needs a price ladder");
  if (!(units > 0)) throw new Error("units must be positive");
  const cuts = ladder.cuts;
  const mids = bucketMidpoints(ladder);

  // Target payout per outcome: units × the drop below the floor (at each range's midpoint), plus,
  // with a cap, units × (top − max(price, cap)): money that comes back unless the price rises past
  // the cap, i.e. the gains above the cap, given up, up to the ladder's top strike.
  const top = cuts[cuts.length - 1];
  const cap = input.cap !== undefined && input.cap > (floor ?? -Infinity) && input.cap < top ? input.cap : null;
  if (floor === null && cap === null) throw new Error("need a floor, a cap, or both");
  const target = mids.map((m) => (floor === null ? 0 : units * Math.max(0, floor - m)) + (cap === null ? 0 : units * Math.max(0, top - Math.max(m, cap))));
  // Instrument i (strike cuts[i]) NO pays in buckets 0..i, so its size is the step between targets.
  const want = cuts.map((_, i) => Math.max(0, target[i] - target[i + 1]));

  // Untradable strikes hand their size to the next strike up (which pays in a superset of outcomes).
  for (let i = 0; i < want.length; i++) {
    if (want[i] > 0 && !isTradable(ladder, i)) {
      if (i + 1 < want.length) want[i + 1] += want[i];
      want[i] = 0;
    }
  }
  // Round to the quantity step, then merge legs under the minimum upward.
  const qty = want.map((w, i) => (w > 0 ? roundTo(w, ladder.instruments[i].qtyStep) : 0));
  let carry = 0;
  let lastKept = -1;
  for (let i = 0; i < qty.length; i++) {
    if (qty[i] <= 0 && carry <= 0) continue;
    if (!isTradable(ladder, i)) continue;
    qty[i] += carry;
    carry = 0;
    const price = ladder.instruments[i].noAsk!;
    if (qty[i] * price < minLegUsd || qty[i] < ladder.instruments[i].minQty) {
      carry = qty[i];
      qty[i] = 0;
    } else lastKept = i;
  }
  if (carry > 0 && lastKept >= 0) qty[lastKept] += carry;

  const quote = assemble(ladder, qty.map((q, i) => ({ i, side: "no" as const, qty: q })), null, feeRate);
  const reference = marketMoments(ladder).mean;
  const floorLegs = floor === null ? [] : quote.legs.filter((l) => (l.strike ?? Infinity) <= floor);
  return {
    ...quote,
    protection: {
      units,
      floor,
      cap,
      capTop: cap === null ? null : top,
      backInMiddle: cap === null ? null : (() => {
        const j = mids.findIndex((m) => m > (floor ?? -Infinity) && m < cap);
        return j >= 0 ? quote.payoutByBucket[j] : null;
      })(),
      coveredDownTo: floor === null ? null : cuts[floorLegs.length ? Math.min(...floorLegs.map((l) => l.instrumentIndex)) : 0],
      reference,
      holdingChange: mids.map((m) => units * (m - reference)),
    },
  };
}

/** Covered call: earn on what you hold by giving up gains above `cap` (no floor). */
export function coveredCall(input: { ladder: Ladder; units: number; cap: number; feeRate?: number }) {
  return protect({ ladder: input.ladder, units: input.units, cap: input.cap, feeRate: input.feeRate });
}

// ---------------------------------------------------------------------------------------------
// Spreads: "the further it moves my way, the more I make, up to a limit"
// ---------------------------------------------------------------------------------------------

export interface SpreadInput {
  ladder: Ladder;
  /** up: a call spread (YES on each strike above `from` up to `to`); down: a put spread (NO on each strike from `from` up to below `to`). */
  direction: "up" | "down";
  /** Lower price of the spread (a strike). */
  from: number;
  /** Upper price of the spread (a strike). */
  to: number;
  stakeUsd: number;
  feeRate?: number;
}

export interface SpreadInfo {
  direction: "up" | "down";
  from: number;
  to: number;
  /** Dollars paid per one-strike step the price moves into the spread. */
  perStep: number;
  /** Number of steps (legs) in the spread. */
  steps: number;
}

/**
 * A vertical spread from one contract per strike, all the same size. Up: YES on "$K or above" for
 * each strike K in (from, to], so every strike the price ends above adds a step, up to `to`. Down:
 * NO on each strike K in [from, to), so every strike it ends below adds a step, down to `from`.
 * The size is the most that fits in the stake with fees; what doesn't fit stays as cash.
 */
export function spread(input: SpreadInput): Quote & { spread: SpreadInfo } {
  const { ladder, direction, stakeUsd } = input;
  const feeRate = input.feeRate ?? GEMINI_TAKER_FEE_RATE;
  if (ladder.kind !== "threshold" || !ladder.cuts || isReversed(ladder)) throw new Error("spreads need a price ladder");
  if (!(stakeUsd > 0)) throw new Error("stake must be positive");
  const from = Math.min(input.from, input.to);
  const to = Math.max(input.from, input.to);
  const side = direction === "up" ? ("yes" as const) : ("no" as const);
  const idx = ladder.strikes
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => (direction === "up" ? s > from && s <= to : s >= from && s < to) && isTradable(ladder, i))
    .map(({ i }) => i);
  const asks = idx.map((i) => (side === "yes" ? ladder.instruments[i].yesAsk! : ladder.instruments[i].noAsk!));
  const step = Math.max(0.01, ...idx.map((i) => ladder.instruments[i].qtyStep));
  const minQty = Math.max(0, ...idx.map((i) => ladder.instruments[i].minQty));
  const stakeBase = Math.round(stakeUsd * 1e6);
  let q = idx.length ? floorTo(stakeUsd / asks.reduce((a, p) => a + costPerContract(p, feeRate), 0), step) : 0;
  // Fees round up per order: step down until contracts + fees fit in the stake.
  const total = (x: number) => idx.reduce((a, _, k) => a + Math.round(x * asks[k] * 1e6) + Math.round(tradingFeeUsd(x, asks[k], feeRate) * 1e6), 0);
  while (q > 0 && total(q) > stakeBase) q = floorTo(q - step, step);
  if (q < minQty) q = 0;
  const quote = assemble(ladder, idx.map((i) => ({ i, side, qty: q })), stakeBase, feeRate);
  return { ...quote, spread: { direction, from, to, perStep: q, steps: q > 0 ? idx.length : 0 } };
}

// ---------------------------------------------------------------------------------------------
// Choices offered in the UI
// ---------------------------------------------------------------------------------------------

/** Strikes that make sensible floors: tradable NO, at or below the market's expected price. */
export function floorChoices(ladder: Ladder, max = 6): number[] {
  if (ladder.kind !== "threshold" || !ladder.cuts || isReversed(ladder)) return [];
  const center = marketMoments(ladder).mean;
  return ladder.strikes
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i > 0 && s <= center && isTradable(ladder, i))
    .map(({ s }) => s)
    .slice(-max);
}

/** Strikes that make sensible caps: tradable NO, above the expected price, below the top strike. */
export function capChoices(ladder: Ladder, max = 6): number[] {
  if (ladder.kind !== "threshold" || !ladder.cuts || isReversed(ladder)) return [];
  const center = marketMoments(ladder).mean;
  const n = ladder.strikes.length;
  return ladder.strikes
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i < n - 1 && s > center && isTradable(ladder, i))
    .map(({ s }) => s)
    .slice(0, max);
}

/** "SOL price on November 20" → "SOL". */
export function underlyingName(ladder: Ladder): string {
  return /^(.+?)\s+price\b/i.exec(ladder.title)?.[1] ?? "it";
}
