/**
 * Quality checks for every market Contour lists: is the market curve faithful to Gemini's prices, and
 * does each one-tap outlook build a position that says what the user picked? Pure (no I/O), so the
 * sweep script, tests and (later) the desk's market list can all run the same rules.
 *
 * Run the sweep over live Gemini: pnpm --filter @contour/desk qc
 */
import { blend, bucketMidpoints, marketMoments } from "./beliefs";
import { compile } from "./compile";
import { costPerContract, GEMINI_TAKER_FEE_RATE } from "./fees";
import { formatValue, isTradable, MAX_RELIABLE_SPREAD, MIN_QUOTED, paysIn, thresholdSurvival } from "./normalize";
import { anyViewTrades, moreLikelyBelief, OUTLOOK_KEYS, OUTLOOK_PRESETS, outlookBelief, outlookStart } from "./outlooks";
import type { Instrument, Ladder, Quote } from "./types";

export type Severity = "error" | "warn" | "info";

export interface QcRule {
  id: string;
  severity: Severity;
  area: "market" | "position";
  title: string;
  /** What is measured, and the threshold. */
  check: string;
  /** Why a failure matters to the user. */
  why: string;
}

export const QC_RULES: QcRule[] = [
  // ---- The market: is the curve faithful to Gemini's prices? ----
  {
    id: "contradictory-quotes",
    severity: "error",
    area: "market",
    title: "Prices contradict each other",
    check: "On a threshold ladder, a higher strike's price (its chance to finish above) is over 10 points above a lower strike's.",
    why: "One underlying can't be likelier to finish above 58.5 than above 46.5. The curve has to bend the prices to fit, and every outlook then 'finds edge' in the contradiction.",
  },
  {
    id: "free-money",
    severity: "error",
    area: "market",
    title: "Free money at the asks",
    check: "Two strikes (or a full set of outcomes) cost less, fees included, than the $1 they are guaranteed to pay together.",
    why: "Real books don't leave this. It means stale or indicative prices, and the solver chases it whatever the user's view.",
  },
  {
    id: "phantom-quotes",
    severity: "warn",
    area: "market",
    title: "Locked quotes counted as real",
    check: "A strike the curve treats as a tight two-sided quote has bid = ask (yes ask + no ask = $1 exactly).",
    why: "A locked book can't rest on an exchange. These are Gemini's indicative (last-trade) prices with no orders behind them, yet the normalizer treats them as its best evidence.",
  },
  {
    id: "phantom-only",
    severity: "error",
    area: "market",
    title: "Listed only thanks to locked quotes",
    check: `Without the locked quotes, fewer than ${MIN_QUOTED} strikes have real two-sided prices.`,
    why: "The market would be rejected as too thin if only real orders counted.",
  },
  {
    id: "curve-off-quotes",
    severity: "error",
    area: "market",
    title: "Market curve doesn't match the prices",
    check: "The curve's chance for a contract sits more than 5 points outside its own quote: above the ask or below the bid, including one-sided quotes.",
    why: "The dashed curve, 'market expects', the outlooks and the five numbers are all built on the curve. If it ignores the prices, everything downstream is wrong.",
  },
  {
    id: "odds-pileup",
    severity: "error",
    area: "market",
    title: "Odds piled up far from any price",
    check: "One outcome holds over 25% of the curve although the nearest strike the curve is built from is 2+ strikes away.",
    why: "Flat extrapolation, one-sided bounds and the running minimum push missing probability into one bucket (often 'Below X' or 'X or above'): a spike nothing in the market supports.",
  },
  {
    id: "center-in-hole",
    severity: "error",
    area: "market",
    title: "'Market expects' lands where the market sees ~0%",
    check: "The bucket holding the curve's mean has under a tenth of the curve's peak density (chance per unit, so narrow buckets aren't penalised).",
    why: "The headline number and every outlook are centered there, so Higher and Lower are relative to a value the market itself rules out.",
  },
  {
    id: "multimodal",
    severity: "warn",
    area: "market",
    title: "Market curve has several humps",
    check: "The curve's density has more than one peak at least a quarter as tall as the highest.",
    why: "Totals, prices and temperatures are single-humped in practice; several humps usually mean the curve was rebuilt from bad quotes.",
  },
  {
    id: "bucket-sum",
    severity: "warn",
    area: "market",
    title: "Outcome prices don't add up",
    check: "On bucket and named-outcome markets, the mid prices sum to under 85% or over 115%.",
    why: "The curve rescales them, so every outcome's chance is off by that factor, and part of any 'edge' is the rescaling.",
  },
  {
    id: "spot-outside-curve",
    severity: "warn",
    area: "market",
    title: "Live price outside the market's range",
    check: "On crypto, the live spot price sits below the curve's 2nd or above its 98th percentile.",
    why: "The outlooks start from the live price, so they'd express a view the market already rules out.",
  },
  {
    id: "thin",
    severity: "warn",
    area: "market",
    title: "Mostly unquoted",
    check: "Fewer than 30% of strikes or outcomes have real prices (two-sided, not locked, at most 20¢ wide).",
    why: "Most of the curve is interpolated, and most contracts can't be bought.",
  },
  {
    id: "crossed",
    severity: "warn",
    area: "market",
    title: "Crossed quote",
    check: "A contract's yes ask + no ask is under $1.",
    why: "Stale or transient quote; the contract is left out of positions.",
  },
  // ---- The position: does each outlook build what the user picked? ----
  {
    id: "accounting",
    severity: "error",
    area: "position",
    title: "Position doesn't add up",
    check: "Legs + fees + cash ≠ stake to the base unit; a payout is negative or under the cash; a leg isn't at the tradable ask; a quantity breaks the contract's minimum or step.",
    why: "The schedule is locked on-chain and must be exactly funded.",
  },
  {
    id: "wrong-direction",
    severity: "error",
    area: "position",
    title: "Pays on the wrong side",
    check: "Higher pays less on average above its anchor than below (Lower the reverse); Stays near pays less at the center than in the far tails (Big move the reverse); a 'More likely' take pays less on its outcome than elsewhere.",
    why: "The position must express the view the user picked.",
  },
  {
    id: "near-not-both-sides",
    severity: "error",
    area: "position",
    title: "Stays near doesn't lose on both sides",
    check: "A traded Stays near position pays back the stake or more in the lowest or the highest outcome.",
    why: "Stays near is a bet that it lands close: a big move either way has to cost money, or the position is really a directional bet.",
  },
  {
    id: "same-position",
    severity: "error",
    area: "position",
    title: "Opposite outlooks give the same position",
    check: "At the same confidence, Higher and Lower buy exactly the same contracts and sides, or their payout schedules are within 2% of the stake of each other.",
    why: "If the view doesn't change the trade, something else is driving it (usually a pricing artifact).",
  },
  {
    id: "edge-vs-market",
    severity: "error",
    area: "position",
    title: "Beats the market at the market's own odds",
    check: "Expected payout under the market curve exceeds the stake by more than 1%.",
    why: "Buying at the ask can't have positive expected value under the market's own probabilities. If it does, the curve disagrees with the prices paid and the 'edge' is a data error.",
  },
  {
    id: "cheap-leg",
    severity: "warn",
    area: "position",
    title: "Leg priced below the market's own chance",
    check: "A leg's ask is more than 3 points below the chance the market curve gives it.",
    why: "Names the contract behind 'edge-vs-market'.",
  },
  {
    id: "against-view",
    severity: "warn",
    area: "position",
    title: "Doesn't favor the user's view",
    check: "The chance of profit under the user's view is over 2 points lower than under the market's.",
    why: "The position should do better if the user is right.",
  },
  {
    id: "confidence-not-monotone",
    severity: "warn",
    area: "position",
    title: "More confidence, less at risk",
    check: "The most you can lose drops by over $1 when confidence goes up a step.",
    why: "Trusting your view more should never bet less on it.",
  },
  {
    id: "not-converged",
    severity: "warn",
    area: "position",
    title: "Solver didn't converge",
    check: "The growth-optimal solve hit its iteration limit.",
    why: "Leg sizes may be off.",
  },
  {
    id: "no-view-trades",
    severity: "error",
    area: "market",
    title: "Listed, but no view trades",
    check: "None of the one-tap views (the four outlooks, or a strong take on any named outcome) trades at any strength or confidence.",
    why: "Every view would say 'too close to the market's to trade'. The desk unlists these; one showing up here means the filter was skipped.",
  },
  {
    id: "never-trades",
    severity: "info",
    area: "position",
    title: "Outlook unavailable",
    check: "No strength (up to 3× the tile's preset) at any confidence up to 100% gives this outlook a position.",
    why: "The screen shows the tile as unavailable rather than opening on 'too close to trade'.",
  },
  {
    id: "unfillable-leg",
    severity: "warn",
    area: "position",
    title: "Nothing to buy at the quoted ask",
    check: "The order book has no YES sellers at or below the YES ask a leg uses (checked by the sweep script, which reads the books).",
    why: "The desk can't hedge the leg: its quote caps the leg to zero, so the preview and the signed quote disagree.",
  },
];

export const QC_RULE = Object.fromEntries(QC_RULES.map((r) => [r.id, r])) as Record<string, QcRule>;

export interface Finding {
  rule: string;
  severity: Severity;
  detail: string;
  /** Position rules: which outlook ("higher", "lower", "near", "move", or "more:<outcome>"). */
  outlook?: string;
  /** Position rules: the confidence levels that failed. */
  confidences?: number[];
}

export interface QcRun {
  outlook: string;
  confidence: number;
  trades: boolean;
  legs: { symbol: string; label: string; side: "yes" | "no"; price: number; qty: number; usd: number }[];
  payouts: number[];
  minPayout: number;
  maxPayout: number;
  evMarket: number;
  evBelief: number;
  probProfitBelief: number;
  probProfitMarket: number;
  /** Where the position makes money, e.g. "< 61.5" or "46.5–58.5, > 79.5". */
  profitZone: string;
  converged: boolean;
}

export interface QcQuoteRow {
  label: string;
  strike: number | null;
  yesAsk: number | null;
  noAsk: number | null;
  bid: number | null;
  ask: number | null;
  /** Real two-sided price: bid < ask, at most MAX_RELIABLE_SPREAD wide. */
  firm: boolean;
  /** Used by the normalizer as evidence for the curve. */
  counted: boolean;
  /** bid = ask: an indicative price with no resting order. */
  locked: boolean;
  /** What the market curve says for this contract (threshold: chance above the strike). */
  curve: number;
}

export interface QcResult {
  ticker: string;
  title: string;
  category: string;
  kind: Ladder["kind"];
  expiry: string;
  buckets: number;
  mean: number | null;
  sd: number | null;
  anchor: number | null;
  marketProb: number[];
  bucketLabels: string[];
  quotes: QcQuoteRow[];
  findings: Finding[];
  runs: QcRun[];
  /** Where each outlook tile opens: its strength and confidence, or null when it is unavailable. */
  starts: Record<string, { strength: number; confidence: number } | null>;
}

export interface QcOptions {
  /** What the outlooks are relative to: the live spot price on crypto, else omit (the market mean). */
  anchor?: number | null;
  stakeUsd?: number;
  confidences?: number[];
  feeRate?: number;
  maxIter?: number;
}

const bidOf = (i: Instrument) => i.bestBid ?? (i.noAsk !== null ? 1 - i.noAsk : null);
const askOf = (i: Instrument) => i.bestAsk ?? i.yesAsk;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const cents = (x: number) => `${Math.round(x * 100)}¢`;
const usd = (x: number) => `$${x.toFixed(2)}`;

/** Chance the market curve gives contract i on `side`. */
function curveWin(l: Ladder, i: number, side: "yes" | "no"): number {
  return l.marketProb.reduce((a, q, j) => a + (paysIn(l, i, side, j) ? q : 0), 0);
}

/** Readable ranges of the buckets where `on` holds. */
function zoneText(l: Ladder, on: boolean[]): string {
  if (!on.some(Boolean)) return "never";
  if (!l.cuts) return l.bucketLabels.filter((_, j) => on[j]).join(", ");
  const c = l.cuts;
  const fv = (v: number) => formatValue(v, l.unit, true);
  const parts: string[] = [];
  for (let j = 0; j < on.length; j++) {
    if (!on[j]) continue;
    let k = j;
    while (k + 1 < on.length && on[k + 1]) k++;
    const lo = j === 0 ? null : c[j - 1];
    const hi = k === on.length - 1 ? null : c[k];
    parts.push(lo === null && hi === null ? "anywhere" : lo === null ? `< ${fv(hi!)}` : hi === null ? `> ${fv(lo)}` : `${fv(lo)}–${fv(hi)}`);
    j = k;
  }
  return parts.join(", ");
}

/** Bucket widths for densities: interior from the cuts, open ends borrow their neighbour's width. */
function widths(l: Ladder): number[] {
  const c = l.cuts!;
  if (c.length === 1) return [1, 1];
  const w = [c[1] - c[0]];
  for (let j = 1; j < c.length; j++) w.push(c[j] - c[j - 1]);
  w.push(c[c.length - 1] - c[c.length - 2]);
  return w.map((x) => (x > 0 ? x : 1));
}

/** Peaks of a sequence whose prominence is at least `frac` of its maximum. */
function prominentPeaks(d: number[], frac: number): number[] {
  const max = Math.max(...d);
  const out: number[] = [];
  for (let i = 0; i < d.length; i++) {
    const leftOk = i === 0 || d[i] > d[i - 1];
    const rightOk = i === d.length - 1 || d[i] >= d[i + 1];
    if (!leftOk || !rightOk) continue;
    // Walk each way to the first higher value; the lowest point on the way is that side's col.
    const side = (dir: -1 | 1) => {
      let min = d[i];
      for (let k = i + dir; k >= 0 && k < d.length; k += dir) {
        if (d[k] > d[i]) return { min, higher: true };
        min = Math.min(min, d[k]);
      }
      return { min, higher: false };
    };
    const L = side(-1);
    const R = side(1);
    // Only a side that leads to something higher bounds the prominence; the highest peak counts down to the lowest point.
    const base = L.higher && R.higher ? Math.max(L.min, R.min) : L.higher ? L.min : R.higher ? R.min : Math.min(L.min, R.min);
    const prominence = d[i] - base;
    if (prominence >= frac * max) out.push(i);
  }
  return out;
}

/** Index of the bucket a value falls in, on an ordered ladder. */
function bucketOf(l: Ladder, v: number): number {
  return l.cuts!.filter((c) => c <= v).length;
}

/** The curve's CDF at v, linear inside a bucket (open ends: halfway). */
function cdfAt(l: Ladder, v: number): number {
  const j = bucketOf(l, v);
  const c = l.cuts!;
  const below = l.marketProb.slice(0, j).reduce((a, b) => a + b, 0);
  const lo = j === 0 ? null : c[j - 1];
  const hi = j === c.length ? null : c[j];
  const frac = lo === null || hi === null ? 0.5 : (v - lo) / (hi - lo);
  return below + l.marketProb[j] * frac;
}

/** Weighted mean of xs over the indexes in `set` (unweighted when the weights there are ~0). */
function wmean(xs: number[], w: number[], set: number[]): number | null {
  if (!set.length) return null;
  const m = set.reduce((a, j) => a + w[j], 0);
  if (m < 1e-9) return set.reduce((a, j) => a + xs[j], 0) / set.length;
  return set.reduce((a, j) => a + w[j] * xs[j], 0) / m;
}

/** Problems with how a quote is funded and sized (empty when it adds up). */
export function accountingProblems(l: Ladder, q: Quote): string[] {
  const out: string[] = [];
  const nB = l.marketProb.length;
  if (q.payoutByBucket.length !== nB || q.scheduleBase.length !== nB) out.push(`schedule has ${q.scheduleBase.length} entries for ${nB} outcomes`);
  const legBase = q.legs.reduce((a, g) => a + Math.round(g.usd * 1e6), 0);
  const feeBase = q.legs.reduce((a, g) => a + Math.round(g.fee * 1e6), 0);
  const cashBase = Math.round(q.cashUsd * 1e6);
  if (legBase + feeBase + cashBase !== q.stakeBase) out.push(`legs ${legBase} + fees ${feeBase} + cash ${cashBase} ≠ stake ${q.stakeBase} (base units)`);
  if (cashBase < 0) out.push(`cash is negative (${usd(q.cashUsd)})`);
  const expect = new Array<number>(nB).fill(cashBase);
  for (const g of q.legs) {
    const ins = l.instruments[g.instrumentIndex];
    if (!isTradable(l, g.instrumentIndex)) out.push(`leg on untradable contract "${g.label}"`);
    const ask = g.side === "yes" ? ins.yesAsk : ins.noAsk;
    if (ask === null || Math.abs(ask - g.price) > 1e-9) out.push(`leg ${g.side.toUpperCase()} "${g.label}" priced ${g.price}, ask is ${ask}`);
    if (Math.round(g.qty * g.price * 1e6) !== Math.round(g.usd * 1e6)) out.push(`leg "${g.label}" cost ${g.usd} ≠ qty × price`);
    if (g.qty < ins.minQty - 1e-9) out.push(`leg "${g.label}" qty ${g.qty} under minimum ${ins.minQty}`);
    const steps = g.qty / ins.qtyStep;
    if (Math.abs(steps - Math.round(steps)) > 1e-6) out.push(`leg "${g.label}" qty ${g.qty} not a multiple of ${ins.qtyStep}`);
    for (let j = 0; j < nB; j++) if (paysIn(l, g.instrumentIndex, g.side, j)) expect[j] += Math.round(g.qty * 1e6);
  }
  for (let j = 0; j < nB; j++) {
    if (q.scheduleBase[j] !== expect[j]) {
      out.push(`payout for "${l.bucketLabels[j]}" is ${q.scheduleBase[j]}, legs + cash give ${expect[j]}`);
      break;
    }
  }
  if (q.scheduleBase.some((b) => b < 0)) out.push("a payout is negative");
  if (q.scheduleBase.some((b) => b < cashBase)) out.push("a payout is below the cash held");
  return out;
}

/** Run every rule on one ladder. */
export function qcLadder(l: Ladder, opts: QcOptions = {}): QcResult {
  const stake = opts.stakeUsd ?? 100;
  const confs = opts.confidences ?? [0.25, 0.5, 0.75, 1];
  const feeRate = opts.feeRate ?? GEMINI_TAKER_FEE_RATE;
  const maxIter = opts.maxIter ?? 20_000;
  const ordered = l.cuts !== null;
  const nI = l.instruments.length;
  const nB = l.marketProb.length;
  const findings: Finding[] = [];
  const keyed = new Map<string, Finding>();
  const add = (rule: string, detail: string, outlook?: string, confidence?: number) => {
    const sev = QC_RULE[rule].severity;
    if (outlook === undefined) {
      findings.push({ rule, severity: sev, detail });
      return;
    }
    const k = `${rule}|${outlook}`;
    const f = keyed.get(k);
    if (f) {
      if (confidence !== undefined && !f.confidences!.includes(confidence)) f.confidences!.push(confidence);
      return;
    }
    const nf: Finding = { rule, severity: sev, detail, outlook, confidences: confidence === undefined ? [] : [confidence] };
    keyed.set(k, nf);
    findings.push(nf);
  };
  const fv = (v: number) => formatValue(Math.round(v * 100) / 100, l.unit);

  // ---- Quotes ----
  const counted =
    l.kind === "threshold" ? thresholdSurvival(l.instruments, l.strikes).reliable : l.interpolated.map((x) => !x);
  const quotes: QcQuoteRow[] = l.instruments.map((ins, i) => {
    const bid = bidOf(ins);
    const ask = askOf(ins);
    const locked = bid !== null && ask !== null && Math.abs(ask - bid) < 1e-9;
    const firm = bid !== null && ask !== null && ask > bid + 1e-9 && ask - bid <= MAX_RELIABLE_SPREAD + 1e-9;
    return {
      label: ins.label,
      strike: l.kind === "threshold" ? l.strikes[i] : null,
      yesAsk: ins.yesAsk,
      noAsk: ins.noAsk,
      bid,
      ask,
      firm,
      counted: counted[i],
      locked,
      curve: curveWin(l, i, "yes"),
    };
  });
  const firmCount = quotes.filter((q) => q.firm).length;
  const mid = (q: QcQuoteRow) => (q.bid! + q.ask!) / 2;

  // ---- Market rules ----
  const lockedCounted = quotes.filter((q) => q.counted && q.locked);
  if (lockedCounted.length)
    add(
      "phantom-quotes",
      `${lockedCounted.length} of ${quotes.filter((q) => q.counted).length} prices the curve relies on are locked (bid = ask, no resting order): ${lockedCounted
        .map((q) => `${q.strike !== null ? fv(q.strike) : q.label} at ${cents(q.ask!)}`)
        .join(", ")}.`,
    );

  if (l.kind === "threshold") {
    const reliableCount = quotes.filter((q) => q.counted).length;
    const realCount = quotes.filter((q) => q.counted && !q.locked).length;
    if (reliableCount >= MIN_QUOTED && realCount < MIN_QUOTED)
      add("phantom-only", `${reliableCount} strikes count as priced, but only ${realCount} have real orders on both sides.`);

    // Contradictions among the prices the curve uses.
    let worst: { i: number; j: number; gap: number } | null = null;
    for (let i = 0; i < nI; i++) {
      if (!quotes[i].counted) continue;
      for (let j = i + 1; j < nI; j++) {
        if (!quotes[j].counted) continue;
        const gap = mid(quotes[j]) - mid(quotes[i]);
        if (gap > 0.1 && (!worst || gap > worst.gap)) worst = { i, j, gap };
      }
    }
    if (worst) {
      const a = quotes[worst.i];
      const b = quotes[worst.j];
      const lk = (q: QcQuoteRow) => (q.locked ? " (locked)" : "");
      add(
        "contradictory-quotes",
        `Above ${fv(b.strike!)} is priced ${pct(mid(b))}${lk(b)} but above ${fv(a.strike!)} only ${pct(mid(a))}${lk(a)}: ${Math.round(worst.gap * 100)} points the wrong way.`,
      );
    }

    // Free money: YES above a lower strike + NO above a higher strike pays at least $1 in every outcome.
    let arb: { i: number; j: number; cost: number } | null = null;
    for (let i = 0; i < nI; i++) {
      if (!isTradable(l, i)) continue;
      for (let j = i + 1; j < nI; j++) {
        if (!isTradable(l, j)) continue;
        const cost = costPerContract(l.instruments[i].yesAsk!, feeRate) + costPerContract(l.instruments[j].noAsk!, feeRate);
        if (cost < 1 - 1e-9 && (!arb || cost < arb.cost)) arb = { i, j, cost };
      }
    }
    if (arb)
      add(
        "free-money",
        `YES above ${fv(l.strikes[arb.i])} at ${cents(l.instruments[arb.i].yesAsk!)} + NO above ${fv(l.strikes[arb.j])} at ${cents(l.instruments[arb.j].noAsk!)} cost ${cents(arb.cost)} with fees and pay at least $1 whatever happens.`,
      );

    // Big outcomes the prices don't reach. Bucket j lies between strikes j-1 and j.
    const ci = quotes.map((q, i) => (q.counted ? i : -1)).filter((i) => i >= 0);
    if (ci.length) {
      for (let j = 0; j < nB; j++) {
        if (l.marketProb[j] <= 0.25) continue;
        const lo = Math.max(0, j - 1);
        const hi = Math.min(nI - 1, j);
        const away = (c: number) => (c < lo ? lo - c : c > hi ? c - hi : 0);
        const near = ci.reduce((best, c) => (away(c) < away(best) ? c : best), ci[0]);
        const dist = away(near);
        if (dist >= 2)
          add("odds-pileup", `${pct(l.marketProb[j])} of the curve sits in "${l.bucketLabels[j]}", ${dist} strikes from the nearest price it is built from (${fv(l.strikes[near])}).`);
      }
    }
  } else {
    // Bucket and named-outcome markets: the set should add up, and can't be free money.
    const mids = quotes.map((q) => (q.bid !== null && q.ask !== null ? (q.bid + q.ask) / 2 : null));
    if (mids.every((m) => m !== null)) {
      const s = (mids as number[]).reduce((a, b) => a + b, 0);
      if (s < 0.85 || s > 1.15) add("bucket-sum", `Mid prices add up to ${pct(s)}.`);
    }
    if (l.instruments.every((_, i) => isTradable(l, i))) {
      const yes = l.instruments.reduce((a, ins) => a + costPerContract(ins.yesAsk!, feeRate), 0);
      const no = l.instruments.reduce((a, ins) => a + costPerContract(ins.noAsk!, feeRate), 0);
      if (yes < 1 - 1e-9) add("free-money", `Buying YES on every outcome costs ${cents(yes)} with fees and pays $1.`);
      if (no < nI - 1 - 1e-9) add("free-money", `Buying NO on every outcome costs ${usd(no)} with fees and pays $${nI - 1}.`);
    }
  }

  // Every market: the curve must stay inside whatever each contract's own quote shows (a one-sided
  // quote still bounds it: no one pays more than the ask, no one sells for less than the bid).
  // Crossed quotes (bid above ask) bound nothing; the "crossed" rule reports them.
  const off = quotes
    .filter((q) => !(q.bid !== null && q.ask !== null && q.bid > q.ask + 1e-9))
    .map((q) => ({ q, dev: Math.max(q.bid !== null ? q.bid - q.curve : 0, q.ask !== null ? q.curve - q.ask : 0, 0) }))
    .filter((x) => x.dev > 0.05)
    .sort((a, b) => b.dev - a.dev);
  if (off.length) {
    const q = off[0].q;
    const name = q.strike !== null ? `above ${fv(q.strike)}` : `"${q.label}"`;
    const quote = q.bid !== null && q.ask !== null ? `trades ${cents(q.bid)}–${cents(q.ask)}` : q.ask !== null ? `is offered at ${cents(q.ask)}` : `is bid ${cents(q.bid!)}`;
    add("curve-off-quotes", `${off.length} contract${off.length > 1 ? "s" : ""}: e.g. ${name} ${quote} but the curve says ${pct(q.curve)}.`);
  }

  let mean: number | null = null;
  let sd: number | null = null;
  if (ordered) {
    ({ mean, sd } = marketMoments(l));
    const j = bucketOf(l, mean);
    const w = widths(l);
    const dens = l.marketProb.map((q, k) => q / w[k]);
    if (dens[j] < 0.1 * Math.max(...dens))
      add("center-in-hole", `"Market expects about ${fv(mean)}", which is in "${l.bucketLabels[j]}", an outcome the curve gives ${(l.marketProb[j] * 100).toFixed(1)}%.`);
    const peaks = prominentPeaks(
      l.marketProb.map((q, k) => q / w[k]),
      0.25,
    );
    if (peaks.length > 1) add("multimodal", `${peaks.length} humps, at ${peaks.map((k) => `"${l.bucketLabels[k]}" (${pct(l.marketProb[k])})`).join(", ")}.`);
    if (opts.anchor != null) {
      const f = cdfAt(l, opts.anchor);
      if (f < 0.02 || f > 0.98) add("spot-outside-curve", `Live price ${fv(opts.anchor)} is at the curve's ${(f * 100).toFixed(1)}th percentile.`);
    }
  }
  if (firmCount / nI < 0.3) add("thin", `${firmCount} of ${nI} contracts have real two-sided prices.`);
  const crossed = l.instruments.filter((_, i) => l.crossed[i]);
  if (crossed.length) add("crossed", crossed.map((ins) => `"${ins.label}" (${cents(ins.yesAsk!)} + ${cents(ins.noAsk!)})`).join(", "));

  // ---- Position rules ----
  const runs: QcRun[] = [];
  const mids = ordered ? bucketMidpoints(l) : [];
  const views: { id: string; title: string; belief: number[]; center: number | null; sd: number | null; target?: number }[] = [];
  const starts: Record<string, { strength: number; confidence: number } | null> = {};
  if (ordered) {
    for (const k of OUTLOOK_KEYS) {
      // Check each tile where the screen opens it: the gentlest strength that trades.
      const start = outlookStart(l, k, { anchor: opts.anchor, stakeUsd: stake, maxIter });
      starts[k] = start;
      const o = outlookBelief(l, k, opts.anchor, start?.strength ?? 1);
      views.push({ id: k, title: OUTLOOK_PRESETS[k].title, belief: o.belief, center: o.center, sd: o.sd });
    }
    if (OUTLOOK_KEYS.every((k) => starts[k] === null)) add("no-view-trades", "None of the four outlooks trades at any strength or confidence.");
  } else if (!anyViewTrades(l, { stakeUsd: stake })) {
    add("no-view-trades", "No take on any outcome trades, even at full confidence.");
  }
  if (ordered) {
  } else {
    const order = l.marketProb.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order.slice(0, 2)) views.push({ id: `more:${l.bucketLabels[i]}`, title: `More likely: ${l.bucketLabels[i]}`, belief: moreLikelyBelief(l, i), center: null, sd: null, target: i });
  }
  const anchor = ordered ? (opts.anchor ?? mean!) : null;
  const tol = 0.005 * stake;
  const cheap = new Map<string, string>();
  const byView = new Map<string, QcRun[]>();
  for (const v of views) {
    const vr: QcRun[] = [];
    for (const c of confs) {
      // Stays near is built from ranges on the forecast screen (see PositionShape).
      const q = compile({ ladder: l, belief: v.belief, confidence: c, stakeUsd: stake, maxIter, feeRate, shape: v.id === "near" ? "range" : "free" });
      const trades = q.legs.length > 0;
      const profit = q.scheduleBase.map((b) => b > q.stakeBase);
      const run: QcRun = {
        outlook: v.id,
        confidence: c,
        trades,
        legs: q.legs.map((g) => ({ symbol: g.symbol, label: g.label, side: g.side, price: g.price, qty: g.qty, usd: g.usd })),
        payouts: q.payoutByBucket,
        minPayout: q.minPayout,
        maxPayout: q.maxPayout,
        evMarket: q.evUnderMarket,
        evBelief: q.evUnderBelief,
        probProfitBelief: q.probProfitBelief,
        probProfitMarket: q.probProfitMarket,
        profitZone: zoneText(l, profit),
        converged: q.raw.converged,
      };
      runs.push(run);
      vr.push(run);

      for (const p of accountingProblems(l, q)) add("accounting", p, v.id, c);
      if (!q.raw.converged) add("not-converged", `Stopped after ${q.raw.iterations.toLocaleString("en-US")} iterations.`, v.id, c);
      if (!trades) continue;

      if (q.evUnderMarket > stake * 1.01)
        add("edge-vs-market", `Expects ${usd(q.evUnderMarket)} back on ${usd(stake)} at the market's own odds.`, v.id, c);
      for (const g of q.legs) {
        const win = curveWin(l, g.instrumentIndex, g.side);
        const key = `${g.symbol}|${g.side}`;
        if (g.price < win - 0.03 && !cheap.has(key)) cheap.set(key, `${g.side.toUpperCase()} "${g.label}" at ${cents(g.price)}; the curve gives it ${pct(win)}.`);
      }
      if (v.id === "near") {
        const lo = q.scheduleBase[0];
        const hi = q.scheduleBase[nB - 1];
        if (lo >= q.stakeBase || hi >= q.stakeBase)
          add("near-not-both-sides", `Pays ${usd(lo / 1e6)} in "${l.bucketLabels[0]}" and ${usd(hi / 1e6)} in "${l.bucketLabels[nB - 1]}" on ${usd(stake)}.`, v.id, c);
      }
      if (q.probProfitBelief + 0.02 < q.probProfitMarket)
        add("against-view", `Chance of profit ${pct(q.probProfitBelief)} if you're right vs ${pct(q.probProfitMarket)} if the market is.`, v.id, c);

      // Direction: does the payout lean the way the outlook says?
      const p = blend(v.belief, l.marketProb, c);
      const pay = q.payoutByBucket;
      const idx = [...Array(nB).keys()];
      if (ordered) {
        if (v.id === "higher" || v.id === "lower") {
          const up = wmean(pay, p, idx.filter((j) => mids[j] > anchor!));
          const down = wmean(pay, p, idx.filter((j) => mids[j] < anchor!));
          if (up !== null && down !== null) {
            const bad = v.id === "higher" ? up < down - tol : down < up - tol;
            if (bad)
              add(
                "wrong-direction",
                `Pays ${usd(down)} on average below ${fv(anchor!)} and ${usd(up)} above it; makes money ${run.profitZone}.`,
                v.id,
                c,
              );
          }
        } else {
          const near = idx.filter((j) => Math.abs(mids[j] - v.center!) <= 0.5 * v.sd!);
          const inner = near.length ? near : [bucketOf(l, v.center!)];
          const outer = idx.filter((j) => Math.abs(mids[j] - v.center!) >= 1.5 * v.sd!);
          const a = wmean(pay, p, inner);
          const b = wmean(pay, p, outer);
          if (a !== null && b !== null) {
            const bad = v.id === "near" ? a < b - tol : b < a - tol;
            if (bad) add("wrong-direction", `Pays ${usd(a)} near ${fv(v.center!)} and ${usd(b)} far from it; makes money ${run.profitZone}.`, v.id, c);
          }
        }
      } else if (v.target !== undefined) {
        const others = wmean(pay, p, idx.filter((j) => j !== v.target));
        if (others !== null && pay[v.target] < others - tol)
          add("wrong-direction", `Pays ${usd(pay[v.target])} if "${l.bucketLabels[v.target]}" wins and ${usd(others)} otherwise.`, v.id, c);
      }
    }
    byView.set(v.id, vr);
    if (ordered ? starts[v.id] === null : !vr.some((r) => r.trades)) add("never-trades", "No position at any strength or confidence.", v.id);
    for (let k = 1; k < vr.length; k++) {
      const before = Math.max(0, stake - vr[k - 1].minPayout);
      const after = Math.max(0, stake - vr[k].minPayout);
      if (after < before - 1)
        add("confidence-not-monotone", `Most you can lose falls from ${usd(before)} to ${usd(after)} going from ${pct(vr[k - 1].confidence)} to ${pct(vr[k].confidence)}.`, v.id, vr[k].confidence);
    }
  }
  if (ordered) {
    const H = byView.get("higher")!;
    const L = byView.get("lower")!;
    H.forEach((h, k) => {
      const lo = L[k];
      if (!h.trades || !lo.trades) return;
      const set = (r: QcRun) => r.legs.map((g) => `${g.symbol}|${g.side}`).sort().join(",");
      const diff = Math.max(...h.payouts.map((x, j) => Math.abs(x - lo.payouts[j])));
      if (set(h) === set(lo) || diff < 0.02 * stake) {
        const all = OUTLOOK_KEYS.every((key) => set(byView.get(key)![k]) === set(h));
        add(
          "same-position",
          `${all ? "All four outlooks buy" : "Both buy"} ${h.legs.map((g) => `${g.side.toUpperCase()} "${g.label}"`).join(" + ")}; Higher makes money ${h.profitZone}, Lower ${lo.profitZone}.`,
          "higher+lower",
          h.confidence,
        );
      }
    });
  }
  for (const d of cheap.values()) add("cheap-leg", d);

  return {
    ticker: l.eventTicker,
    title: l.title,
    category: l.category,
    kind: l.kind,
    expiry: l.expiry,
    buckets: nB,
    mean,
    sd,
    anchor,
    marketProb: l.marketProb,
    bucketLabels: l.bucketLabels,
    quotes,
    findings,
    runs,
    starts,
  };
}
