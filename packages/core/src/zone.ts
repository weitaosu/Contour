import { bucketMidpoints } from "./beliefs";
import { costPerContract, GEMINI_TAKER_FEE_RATE } from "./fees";
import { isTradable, paysIn } from "./normalize";
import { assemble, type LegSpec } from "./protect";
import type { Ladder, Quote } from "./types";

/**
 * Win-zone bets: "I win if it lands in this run of outcomes, and I lose what I put at risk otherwise."
 *
 * A zone is a run of adjacent buckets [lo, hi]. On a price ladder it takes at most two contracts:
 * YES on the strike at its lower edge (pays in every bucket from lo up) and NO on the strike at its
 * upper edge (pays in every bucket up to hi). Together they pay $2 inside the zone and $1 outside,
 * so the $1 always comes back and only the rest is at risk. On a bucket ladder (weather ranges) it is
 * YES on each bucket in the zone.
 *
 * Widening the zone raises the win rate and lowers the reward-to-risk; narrowing does the opposite.
 * At the market's prices they trade off at about (1 − win rate) / win rate, less spread and fees.
 */

export type ZoneDirection = "higher" | "lower" | "around";

export interface ZoneOption {
  /** First and last bucket in the zone (inclusive). */
  lo: number;
  hi: number;
  legs: { i: number; side: "yes" | "no" }[];
  /** All-in cost (asks + fees) of one unit: one contract of each leg. */
  costPerUnit: number;
  /** What one unit pays back outside the zone (0, or 1 for a two-contract range). */
  backOutside: number;
  /** What one unit pays inside the zone. */
  backInside: number;
  /** The market's chance the outcome lands in the zone. */
  winRate: number;
  /** Profit if it lands in the zone per dollar at risk, at the asks with fees. */
  rewardToRisk: number;
  /** Edge values on the outcome axis: null where the zone is open-ended. */
  from: number | null;
  to: number | null;
}

function legsFor(ladder: Ladder, lo: number, hi: number): { i: number; side: "yes" | "no" }[] | null {
  const nB = ladder.marketProb.length;
  if (lo < 0 || hi >= nB || lo > hi || (lo === 0 && hi === nB - 1)) return null;
  const legs: { i: number; side: "yes" | "no" }[] = [];
  if (ladder.kind === "threshold") {
    if (lo > 0) legs.push({ i: lo - 1, side: "yes" }); // instrument lo−1 is the strike at the zone's lower edge
    if (hi < nB - 1) legs.push({ i: hi, side: "no" }); // instrument hi is the strike just above the zone
  } else if (ladder.kind === "buckets") {
    for (let i = lo; i <= hi; i++) legs.push({ i, side: "yes" });
  } else return null;
  return legs.every((l) => isTradable(ladder, l.i)) ? legs : null;
}

function priceOption(ladder: Ladder, lo: number, hi: number, feeRate: number): ZoneOption | null {
  const legs = legsFor(ladder, lo, hi);
  if (!legs) return null;
  const nB = ladder.marketProb.length;
  const askOf = (l: { i: number; side: "yes" | "no" }) => (l.side === "yes" ? ladder.instruments[l.i].yesAsk! : ladder.instruments[l.i].noAsk!);
  const costPerUnit = legs.reduce((a, l) => a + costPerContract(askOf(l), feeRate), 0);
  const per = Array.from({ length: nB }, (_, j) => legs.reduce((a, l) => a + (paysIn(ladder, l.i, l.side, j) ? 1 : 0), 0));
  const backOutside = Math.min(...per);
  const backInside = Math.max(...per);
  const risk = costPerUnit - backOutside;
  const reward = backInside - costPerUnit;
  if (!(risk > 0) || !(reward > 0)) return null; // nothing to win after costs, or a stale (crossed) quote
  const cuts = ladder.cuts ?? [];
  return {
    lo,
    hi,
    legs,
    costPerUnit,
    backOutside,
    backInside,
    winRate: ladder.marketProb.slice(lo, hi + 1).reduce((a, b) => a + b, 0),
    rewardToRisk: reward / risk,
    from: lo > 0 ? (cuts[lo - 1] ?? null) : null,
    to: hi < nB - 1 ? (cuts[hi] ?? null) : null,
  };
}

/** The bucket a value falls in: the number of cut points at or below it. */
export function bucketOf(ladder: Ladder, value: number): number {
  const cuts = ladder.cuts ?? [];
  let b = 0;
  while (b < cuts.length && cuts[b] <= value) b++;
  return b;
}

/**
 * Every zone the ladder offers for a price and direction, ordered from the biggest payout (lowest
 * win rate) to the safest (highest win rate), plus the one to start on.
 *
 *  - higher: win if it ends at the price or above. The first stop's line is the strike at or just
 *            below the price; safer moves it further down, so you also win a little below your price.
 *  - lower:  win if it ends below the price. Safer moves the line further up.
 *  - around: win if it ends near the price. Safer widens it by one outcome at a time, on whichever
 *            side keeps it centred on the price.
 */
export function zoneOptions(
  ladder: Ladder,
  price: number,
  direction: ZoneDirection,
  feeRate = GEMINI_TAKER_FEE_RATE,
): { options: ZoneOption[]; start: number } {
  if (!ladder.cuts || ladder.kind === "categorical") return { options: [], start: 0 };
  const nB = ladder.marketProb.length;
  const spans: [number, number][] = [];
  const cuts = ladder.cuts;
  // Higher always wins at the price and above: its line sits at or below the price, and safer moves
  // it further down (room below your price). Lower mirrors it: the line sits above the price.
  if (direction === "higher") for (let lo = nB - 1; lo >= 1; lo--) cuts[lo - 1] <= price && spans.push([lo, nB - 1]);
  else if (direction === "lower") for (let hi = 0; hi <= nB - 2; hi++) cuts[hi] > price && spans.push([0, hi]);
  else {
    // Grow one outcome at a time, always adding the neighbour whose middle is closest to the price,
    // so the band stays centred on it but the win rate moves in single-bucket steps (widening both
    // sides at once jumps ~20 points per stop on a $1 ladder, and far more on a sparse one).
    const mids = bucketMidpoints(ladder);
    let lo = bucketOf(ladder, price);
    let hi = lo;
    spans.push([lo, hi]);
    while (lo > 0 || hi < nB - 1) {
      const left = lo > 0 ? Math.abs(mids[lo - 1] - price) : Infinity;
      const right = hi < nB - 1 ? Math.abs(mids[hi + 1] - price) : Infinity;
      if (left <= right) lo--;
      else hi++;
      if (lo === 0 && hi === nB - 1) break;
      spans.push([lo, hi]);
    }
  }
  const options = spans.map(([lo, hi]) => priceOption(ladder, lo, hi, feeRate)).filter((o): o is ZoneOption => o !== null);
  options.sort((a, b) => a.winRate - b.winRate);
  // Drop any zone a safer one beats on payout too (uneven spreads make a few of these): every stop
  // left on the slider trades some win rate for a strictly better reward-to-risk.
  const kept: ZoneOption[] = [];
  let bestRr = -Infinity;
  for (let k = options.length - 1; k >= 0; k--) {
    if (options[k].rewardToRisk > bestRr) {
      kept.unshift(options[k]);
      bestRr = options[k].rewardToRisk;
    }
  }
  options.splice(0, options.length, ...kept);
  if (!options.length) return { options, start: 0 };

  // Higher/lower start right at the price (the first, riskiest stop); around starts nearest a coin flip.
  let start = 0;
  if (direction === "around") options.forEach((o, k) => Math.abs(o.winRate - 0.5) < Math.abs(options[start].winRate - 0.5) && (start = k));
  return { options, start };
}

export interface ZoneInfo {
  option: ZoneOption;
  /** Units bought (contracts of each leg). */
  units: number;
  /** What you put in (the escrow stake) and the most you can lose. */
  depositUsd: number;
  riskUsd: number;
  /** Profit if it lands in the zone. */
  winUsd: number;
}

const floorTo = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;

/**
 * Sizes a zone so the most you can lose is about `riskUsd`, and prices it into a full quote (legs at
 * the asks, Gemini fees per order, payout per outcome) that the escrow and desk already understand.
 */
export function buildZone(input: { ladder: Ladder; option: ZoneOption; riskUsd: number; feeRate?: number }): Quote & { zone: ZoneInfo } {
  const { ladder, option, riskUsd } = input;
  const feeRate = input.feeRate ?? GEMINI_TAKER_FEE_RATE;
  if (!(riskUsd > 0)) throw new Error("risk must be positive");
  const step = Math.max(0.01, ...option.legs.map((l) => ladder.instruments[l.i].qtyStep));
  const minQty = Math.max(0, ...option.legs.map((l) => ladder.instruments[l.i].minQty));
  let units = floorTo(riskUsd / (option.costPerUnit - option.backOutside), step);
  const build = (u: number) =>
    assemble(ladder, option.legs.map((l): LegSpec => ({ i: l.i, side: l.side, qty: u })), null, feeRate);
  let quote = build(units);
  // Fees round up per order: step down until the real risk fits.
  while (units > step && quote.stakeBase / 1e6 - quote.minPayout > riskUsd + 1e-9) {
    units = floorTo(units - step, step);
    quote = build(units);
  }
  if (units < minQty) units = 0;
  if (units === 0) quote = build(0);
  const depositUsd = quote.stakeBase / 1e6;
  return {
    ...quote,
    zone: {
      option,
      units,
      depositUsd,
      riskUsd: Math.round((depositUsd - quote.minPayout) * 100) / 100,
      winUsd: Math.round((quote.maxPayout - depositUsd) * 100) / 100,
    },
  };
}

/**
 * Cap the other end of a one-sided zone by also buying the opposite contract there: "SOL at $73 or
 * above" plus NO on "$77 or above" wins only between $73 and $77. You lose if it overshoots, so the
 * win rate drops, but the NO pays back $1 in every other outcome, so the reward-to-risk rises.
 *
 * Returns the capped versions of `base` from the farthest cap (closest to the uncapped bet) to the
 * nearest one (biggest payout). The zone always keeps the bucket the price falls in. Caps that a
 * farther cap beats on payout too are dropped.
 */
export function capOptions(
  ladder: Ladder,
  base: ZoneOption,
  price: number,
  direction: "higher" | "lower",
  feeRate = GEMINI_TAKER_FEE_RATE,
): ZoneOption[] {
  if (ladder.kind !== "threshold") return [];
  const nB = ladder.marketProb.length;
  const p = bucketOf(ladder, price);
  const out: ZoneOption[] = [];
  if (direction === "higher") for (let hi = nB - 2; hi >= Math.max(p, base.lo); hi--) out.push(priceOption(ladder, base.lo, hi, feeRate)!);
  else for (let lo = 1; lo <= Math.min(p, base.hi); lo++) out.push(priceOption(ladder, lo, base.hi, feeRate)!);
  const kept: ZoneOption[] = [];
  let bestRr = base.rewardToRisk;
  for (const o of out) {
    if (o && o.rewardToRisk > bestRr) {
      kept.push(o);
      bestRr = o.rewardToRisk;
    }
  }
  return kept;
}
