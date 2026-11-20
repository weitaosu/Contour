import { formatValue, paysIn, type Ladder, type Quote } from "@contour/core";

/**
 * What each position would make or lose at settlement, for every final outcome, as table rows.
 *
 * - Contour P&L: what all its YES/NO contracts pay in that outcome, plus the budget it didn't
 *   spend, minus the whole budget. Fees are already in it (they came out of the budget).
 * - Single contract P&L: the quote's benchmark contract (the best single contract for the same
 *   forecast), bought with the whole budget, as the takeaway line above the table assumes, so the
 *   two always agree. Winning contracts pay $1, losing ones $0, less the purchase cost and fee
 *   (any budget it can't spend comes back either way).
 * - Difference: Contour minus single. Positive means Contour does better there.
 *
 * Adjacent outcomes become one row when all three amounts match to the cent; any change starts a
 * new row. These are dollar results if it ends there, not how likely each one is.
 */

type Q = Omit<Quote, "raw">;

export interface ScenarioRow {
  /** First and last bucket index of the row (inclusive). */
  from: number;
  to: number;
  label: string;
  /** The three amounts, in dollars rounded to the cent. */
  a: number;
  b: number;
  diff: number;
}

export interface Benchmark {
  label: string;
  side: "yes" | "no";
  price: number;
  qty: number;
  fee: number;
  /** Contracts plus fee: what the single contract costs. */
  cost: number;
}

const cents = (x: number) => Math.round(x * 100) / 100;

/** A run of outcomes as a short scenario name: "Below $72", "$72–$74", "$80 or above". */
export function scenarioLabel(ladder: Ladder, a: number, b: number) {
  if (!ladder.cuts) return ladder.bucketLabels.slice(a, b + 1).join(", ");
  const fv = (v: number) => formatValue(v, ladder.unit);
  const lo = a === 0 ? null : fv(ladder.cuts[a - 1]);
  const hi = b === ladder.cuts.length ? null : fv(ladder.cuts[b]);
  const date = !!ladder.unit.date;
  if (lo && hi) return `${lo}–${hi}`;
  if (lo) return date ? `${lo} or later` : `${lo} or above`;
  if (hi) return date ? `Before ${hi}` : `Below ${hi}`;
  return "Any outcome";
}

/** Rows from three per-bucket series, merging neighbours whose amounts all match to the cent. */
function mergeRows(ladder: Ladder, a: number[], b: number[]): ScenarioRow[] {
  const rows: ScenarioRow[] = [];
  a.forEach((_, j) => {
    const ra = cents(a[j]);
    const rb = cents(b[j]);
    const rd = cents(b[j] - a[j]);
    const last = rows[rows.length - 1];
    if (last && last.a === ra && last.b === rb && last.diff === rd) last.to = j;
    else rows.push({ from: j, to: j, label: "", a: ra, b: rb, diff: rd });
  });
  for (const r of rows) r.label = scenarioLabel(ladder, r.from, r.to);
  return rows;
}

/** Contour's P&L per outcome, from its contracts: each pays $1 where it wins, plus unspent cash, less the budget. */
export function contourPnl(ladder: Ladder, quote: Q, budget: number) {
  return ladder.bucketLabels.map((_, j) => {
    const paid = quote.legs.reduce((s, l) => s + (paysIn(ladder, l.instrumentIndex, l.side, j) ? l.qty : 0), 0);
    return paid + quote.cashUsd - budget;
  });
}

/** The quote's benchmark contract as quoted: all of the budget on it (contracts + fee fit in the stake). */
export function benchmark(ladder: Ladder, quote: Q): (Benchmark & { index: number }) | null {
  const c = quote.comparison;
  if (!c || !(c.qty > 0)) return null;
  const index = ladder.instruments.findIndex((i) => i.symbol === c.symbol);
  if (index < 0) return null;
  return { index, label: c.label, side: c.side, price: c.price, qty: c.qty, fee: c.fee, cost: c.qty * c.price + c.fee };
}

/** The scenario table for a hedge: single contract vs Contour, per outcome. */
export function scenarioTable(ladder: Ladder, quote: Q, budget: number) {
  const one = benchmark(ladder, quote);
  if (!one || !quote.legs.length) return null;
  const single = ladder.bucketLabels.map((_, j) => (paysIn(ladder, one.index, one.side, j) ? one.qty : 0) - one.cost);
  const contour = contourPnl(ladder, quote, budget);
  return { benchmark: one, rows: mergeRows(ladder, single, contour) };
}

/**
 * Protection mode: the holding alone against the holding plus the strategy, per outcome. The
 * holding is valued at each range's midpoint (protect()'s `holdingChange`, against the market's
 * expected price), and the strategy adds its payout less what it cost.
 */
export function protectionTable(ladder: Ladder, quote: Q, cost: number, holdingChange: number[]) {
  const alone = holdingChange;
  const withIt = holdingChange.map((h, j) => h + quote.payoutByBucket[j] - cost);
  return mergeRows(ladder, alone, withIt);
}
