import { blend } from "./beliefs";
import { costPerContract, GEMINI_TAKER_FEE_RATE, tradingFeeUsd } from "./fees";
import { isTradable, paysIn } from "./normalize";
import type { Comparison, DepthMap, Ladder, Leg, Quote } from "./types";

/**
 * What the solver may buy.
 * - "free": any contract, YES or NO (the default).
 * - "range": positions that make money only inside a range and lose outside it on both sides, for
 *   "stays near" views. On price ladders the solver buys matched pairs: YES above a lower strike plus
 *   the same number of NO above a higher strike. A pair pays $2 inside its range and $1 outside, and
 *   only pairs costing more than $1 are offered, so however they are mixed, every outcome outside all
 *   of them (at least both end buckets) pays back less than the stake. On bucket ladders it buys YES
 *   on buckets only.
 */
export type PositionShape = "free" | "range";

export interface CompileInput {
  ladder: Ladder;
  belief: number[]; // user's (unblended) forecast per bucket
  confidence: number; // 0..1
  stakeUsd: number;
  depth?: DepthMap;
  warmStart?: number[];
  maxIter?: number;
  tol?: number;
  minLegUsd?: number;
  postProcess?: boolean;
  /** Trading fee rate per Gemini's P × (1 − P) formula. Defaults to the taker rate (the desk buys at the ask); 0 = no fees. */
  feeRate?: number;
  shape?: PositionShape;
}

export interface SolverInstrument {
  index: number; // ladder instrument index; -1 for cash, -2 for a matched pair
  side: "cash" | "yes" | "no" | "pair";
  price: number; // the ask (a pair: the sum of its two asks)
  /** All-in cost per unit (asks + fees) the optimizer pays; 1 for cash. */
  cost: number;
  /** Dollars paid per unit, per bucket. */
  pays: number[];
  /** The contracts one unit buys (one each; none for cash). */
  legs: { index: number; side: "yes" | "no"; price: number }[];
}

/**
 * `around` (range shape, price ladders): the outcome every range must contain, so the position makes
 * money where the view says it lands rather than in some cheap range elsewhere.
 */
export function buildInstruments(ladder: Ladder, feeRate = 0, shape: PositionShape = "free", around?: number): SolverInstrument[] {
  const nB = ladder.marketProb.length;
  const out: SolverInstrument[] = [{ index: -1, side: "cash", price: 1, cost: 1, pays: new Array(nB).fill(1), legs: [] }];
  const ask = (i: number, side: "yes" | "no") => (side === "yes" ? ladder.instruments[i].yesAsk : ladder.instruments[i].noAsk) as number;
  const single = (i: number, side: "yes" | "no"): SolverInstrument => {
    const price = ask(i, side);
    return {
      index: i,
      side,
      price,
      cost: costPerContract(price, feeRate),
      pays: Array.from({ length: nB }, (_, j) => (paysIn(ladder, i, side, j) ? 1 : 0)),
      legs: [{ index: i, side, price }],
    };
  };
  const tradable = ladder.instruments.map((_, i) => i).filter((i) => isTradable(ladder, i));
  if (shape === "range" && ladder.kind === "threshold") {
    for (const i of tradable)
      for (const j of tradable) {
        if (j <= i) continue;
        // The pair pays $2 on outcomes i + 1 … j: "at or above strike i" plus "below strike j". On a
        // ladder that reads the other way ("Before …"), those are strike i's NO and strike j's YES.
        if (around !== undefined && (around < i + 1 || around > j)) continue;
        const y = single(i, ladder.instruments[i].below ? "no" : "yes");
        const n = single(j, ladder.instruments[j].below ? "yes" : "no");
        // A pair at $1 or less (the two asks disagree: free money) would pay back its cost outside
        // its range too, and break the promise that a range loses on both sides. Leave it out.
        if (y.cost + n.cost <= 1) continue;
        out.push({ index: -2, side: "pair", price: y.price + n.price, cost: y.cost + n.cost, pays: y.pays.map((v, b) => v + n.pays[b]), legs: [...y.legs, ...n.legs] });
      }
    return out;
  }
  for (const i of tradable) {
    out.push(single(i, "yes"));
    if (shape !== "range") out.push(single(i, "no"));
  }
  return out;
}

/** Cover's multiplicative update for max sum_j p_j log(sum_k w_k R_kj) on the simplex. */
export function solveGrowthOptimal(
  p: readonly number[],
  inst: readonly { pays: readonly (number | boolean)[]; cost: number }[],
  opts: { maxIter?: number; tol?: number; warmStart?: number[]; exclude?: readonly boolean[] } = {},
): { w: number[]; iterations: number; converged: boolean } {
  const K = inst.length;
  const N = p.length;
  const maxIter = opts.maxIter ?? 50_000;
  const tol = opts.tol ?? 1e-7;
  // R[k][j] = payoff per dollar spent (fees included), stored as Float64Array rows.
  const R = inst.map((s) => Float64Array.from(s.pays, (b) => Number(b) / s.cost));
  // Excluded instruments start (and, under multiplicative updates, stay) at exactly zero.
  const ex = (k: number) => !!opts.exclude?.[k];
  const live = Math.max(1, inst.reduce((a, _, k) => a + (ex(k) ? 0 : 1), 0));
  let w: number[];
  if (opts.warmStart && opts.warmStart.length === K) {
    // Mix in a little uniform mass: multiplicative updates cannot revive exact zeros.
    const ws = opts.warmStart.reduce((a, b, k) => a + (ex(k) ? 0 : b), 0) || 1;
    w = opts.warmStart.map((x, k) => (ex(k) ? 0 : 0.98 * (x / ws) + 0.02 / live));
  } else w = inst.map((_, k) => (ex(k) ? 0 : 1 / live));
  const W = new Float64Array(N);
  const g = new Float64Array(K);
  for (let it = 0; it < maxIter; it++) {
    W.fill(0);
    for (let k = 0; k < K; k++) {
      const wk = w[k];
      if (wk === 0) continue;
      const r = R[k];
      for (let j = 0; j < N; j++) W[j] += wk * r[j];
    }
    let gmax = -Infinity;
    for (let k = 0; k < K; k++) {
      const r = R[k];
      let s = 0;
      for (let j = 0; j < N; j++) if (r[j] !== 0) s += (p[j] * r[j]) / W[j];
      g[k] = s;
      if (s > gmax) gmax = s;
    }
    for (let k = 0; k < K; k++) w[k] *= g[k];
    if (gmax - 1 < tol) return { w, iterations: it + 1, converged: true };
  }
  return { w, iterations: maxIter, converged: false };
}

const floorTo = (x: number, step: number) => Math.floor(x / step + 1e-9) * step;
const toBase = (usd: number) => Math.round(usd * 1e6);

export function compile(input: CompileInput): Quote {
  const { ladder, belief, confidence, stakeUsd } = input;
  const feeRate = input.feeRate ?? GEMINI_TAKER_FEE_RATE;
  const shape = input.shape ?? "free";
  const q = ladder.marketProb;
  const nB = q.length;
  if (belief.length !== nB) throw new Error(`belief has ${belief.length} buckets, ladder has ${nB}`);
  if (!(stakeUsd > 0)) throw new Error("stake must be positive");
  const p = blend(belief, q, confidence);
  // Ranges must contain the view's median outcome (where the user thinks it's as likely to end up
  // below as above).
  let median: number | undefined;
  if (shape === "range") {
    let c = 0;
    median = belief.findIndex((b) => (c += b) >= 0.5);
  }
  const inst = buildInstruments(ladder, feeRate, shape, median);
  const solved = solveGrowthOptimal(p, inst, {
    maxIter: input.maxIter,
    tol: input.tol,
    warmStart: input.warmStart,
  });
  const { iterations, converged } = solved;

  // Raw (pre post-processing, unconstrained) result, used by the fixture test and as the next warm start.
  const rawPayout = new Array<number>(nB).fill(0);
  inst.forEach((s, k) => s.pays.forEach((b, j) => b && (rawPayout[j] += (b * solved.w[k] * stakeUsd) / s.cost)));
  const rawElg = p.reduce((a, pj, j) => a + pj * Math.log(rawPayout[j] / stakeUsd), 0);

  // ---- Post-processing, in integer USDC base units ----
  const stakeBase = toBase(stakeUsd);
  const minLegUsd = input.minLegUsd ?? 1;
  const doPost = input.postProcess !== false;
  const insOf = (i: number) => ladder.instruments[i];
  // A unit's size limits: every leg must clear its contract's minimum and step.
  const minQtyOf = (s: SolverInstrument) => Math.max(...s.legs.map((g) => insOf(g.index).minQty));
  const stepOf = (s: SolverInstrument) => Math.max(...s.legs.map((g) => insOf(g.index).qtyStep));
  // The dollars in an instrument's smallest leg (a single contract: its whole share, fee included).
  const smallestLegUsd = (s: SolverInstrument, usd: number) => (s.legs.length === 1 ? usd : (usd / s.cost) * Math.min(...s.legs.map((g) => g.price)));

  // Small stakes: a leg the solver wants but that falls under the minimum order would otherwise be
  // dumped into cash, which can delete a whole side of the view (e.g. the downside of a "big move").
  // Instead, drop the smallest such leg and re-solve without it, so its weight moves to the best
  // remaining contracts; repeat until every material leg clears the minimum.
  let w = solved.w;
  if (doPost) {
    const exclude = inst.map(() => false);
    const material = 0.05; // weights below 5¢ are solver dust and simply go to cash
    for (let round = 0; round < inst.length; round++) {
      let smallest = -1;
      let smallestUsd = Infinity;
      inst.forEach((s, k) => {
        if (s.side === "cash" || exclude[k]) return;
        const usd = w[k] * stakeUsd;
        const leg = smallestLegUsd(s, usd);
        if (usd >= material && leg < minLegUsd && leg < smallestUsd) {
          smallest = k;
          smallestUsd = leg;
        }
      });
      if (smallest < 0) break;
      exclude[smallest] = true;
      // Each round only needs to decide which legs clear the minimum, so solve it looser and shorter.
      w = solveGrowthOptimal(p, inst, { maxIter: 3_000, tol: 1e-5, warmStart: w, exclude }).w;
    }
    // A tighter pass on the surviving set, so the legs actually traded are properly sized. (With
    // contracts excluded the optimum often has near-ties that converge slowly; 1e-6 is ample for sizing.)
    if (exclude.some(Boolean)) w = solveGrowthOptimal(p, inst, { maxIter: 6_000, tol: 1e-6, warmStart: w, exclude }).w;
  }

  // 1–3. Size each unit from its share of the stake at the all-in (fee-inclusive) cost. A pair's two
  // legs always keep the same quantity.
  const sized: { s: SolverInstrument; qty: number; capped: boolean }[] = [];
  inst.forEach((s, k) => {
    if (s.side === "cash") return;
    const usd = w[k] * stakeUsd;
    let qty = usd / s.cost;
    let capped = false;
    if (doPost) {
      const step = stepOf(s);
      if (smallestLegUsd(s, usd) < minLegUsd || qty < minQtyOf(s)) return; // drop small legs -> cash
      qty = floorTo(qty, step); // round down to the quantity step -> remainder to cash
      for (const g of s.legs) {
        const avail = input.depth?.[insOf(g.index).symbol]?.[g.side]; // cap at depth when known
        if (avail !== undefined && qty > avail) {
          qty = floorTo(avail, step);
          capped = true;
        }
      }
      if (qty < minQtyOf(s) || s.legs.some((g) => qty * g.price < minLegUsd)) return;
    }
    sized.push({ s, qty: Math.round(qty * 1e6) / 1e6, capped });
  });

  // Units that share a contract become one order per contract and side.
  type Agg = { index: number; side: "yes" | "no"; price: number; qty: number; capped: boolean };
  const orders = (): Agg[] => {
    const m = new Map<string, Agg>();
    for (const x of sized)
      for (const g of x.s.legs) {
        const key = `${g.index}|${g.side}`;
        const a = m.get(key);
        if (a) {
          a.qty = Math.round((a.qty + x.qty) * 1e6) / 1e6;
          a.capped ||= x.capped;
        } else m.set(key, { index: g.index, side: g.side, price: g.price, qty: x.qty, capped: x.capped });
      }
    return [...m.values()];
  };
  const legCost = (a: Pick<Agg, "qty" | "price">) => Math.round(a.qty * a.price * 1e6);
  const legFee = (a: Pick<Agg, "qty" | "price">) => Math.round(tradingFeeUsd(a.qty, a.price, feeRate) * 1e6);
  const unitCost = (x: { s: SolverInstrument; qty: number }) => x.s.legs.reduce((t, g) => t + legCost({ qty: x.qty, price: g.price }), 0);
  const spent = () => orders().reduce((a, o) => a + legCost(o) + legFee(o), 0);
  // Gemini rounds each order's fee up to the cent, which can overshoot the optimizer's budget by a
  // cent or two when nearly everything is invested: trim the largest unit a step at a time to fit.
  for (let guard = 0; spent() > stakeBase && sized.length && guard < 10_000; guard++) {
    const big = sized.reduce((a, b) => (unitCost(b) > unitCost(a) ? b : a));
    big.qty = Math.round((big.qty - stepOf(big.s)) * 1e6) / 1e6;
    if (big.qty < minQtyOf(big.s) || (doPost && big.s.legs.some((g) => big.qty * g.price < minLegUsd))) sized.splice(sized.indexOf(big), 1);
  }

  const legs: Leg[] = [];
  let legCostBase = 0;
  let feeBase = 0;
  const payoutBase = new Array<number>(nB).fill(0);
  for (const o of orders()) {
    const costBase = legCost(o);
    if (costBase <= 0) continue;
    const fBase = legFee(o);
    legCostBase += costBase;
    feeBase += fBase;
    const ins = insOf(o.index);
    const payBase = Math.round(o.qty * 1e6);
    for (let j = 0; j < nB; j++) if (paysIn(ladder, o.index, o.side, j)) payoutBase[j] += payBase;
    legs.push({
      symbol: ins.symbol,
      label: ins.label,
      side: o.side,
      strike: ladder.kind === "threshold" ? ladder.strikes[o.index] : null,
      instrumentIndex: o.index,
      price: o.price,
      qty: o.qty,
      usd: costBase / 1e6,
      fee: fBase / 1e6,
      capped: o.capped,
    });
  }
  const cashBase = stakeBase - legCostBase - feeBase; // 4. everything not in legs or fees is cash; exact to the base unit
  for (let j = 0; j < nB; j++) payoutBase[j] += cashBase;
  const payout = payoutBase.map((b) => b / 1e6);

  const profit = payoutBase.map((b) => b > stakeBase);
  const probProfitBelief = belief.reduce((a, b, j) => a + (profit[j] ? b : 0), 0);
  const probProfitMarket = q.reduce((a, b, j) => a + (profit[j] ? b : 0), 0);
  const expectedLogGrowth = p.reduce((a, pj, j) => a + pj * Math.log(payoutBase[j] / stakeBase), 0);

  // Single best contract for the same forecast: highest P_belief(win) per all-in dollar.
  let comparison: Comparison | null = null;
  let bestRatio = -Infinity;
  for (const s of shape === "free" ? inst : buildInstruments(ladder, feeRate)) {
    if (s.side !== "yes" && s.side !== "no") continue;
    const pb = belief.reduce((a, b, j) => a + (s.pays[j] ? b : 0), 0);
    const ratio = pb / s.cost;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      const ins = insOf(s.index);
      let qty = floorTo(stakeUsd / s.cost, ins.qtyStep);
      // The whole stake goes into one order, fee included: step down until contracts + rounded fee fit.
      while (qty > 0 && qty * s.price + tradingFeeUsd(qty, s.price, feeRate) > stakeUsd + 1e-9) qty = floorTo(qty - ins.qtyStep, ins.qtyStep);
      qty = Math.round(qty * 1e6) / 1e6;
      comparison = {
        symbol: ins.symbol,
        label: ins.label,
        side: s.side,
        price: s.price,
        qty,
        fee: tradingFeeUsd(qty, s.price, feeRate),
        payoutIfWin: qty,
        probWinBelief: pb,
        probWinMarket: q.reduce((a, b, j) => a + (s.pays[j] ? b : 0), 0),
      };
    }
  }

  // Largest stake the quoted depth absorbs at these weights (when depth is known for every leg).
  let maxAbsorb: number | null = null;
  if (input.depth) {
    let m = Infinity;
    let known = true;
    inst.forEach((s, k) => {
      if (s.side === "cash" || w[k] < 1e-3) return;
      for (const g of s.legs) {
        const avail = input.depth?.[insOf(g.index).symbol]?.[g.side];
        if (avail === undefined) known = false;
        else m = Math.min(m, (avail * s.cost) / w[k]);
      }
    });
    maxAbsorb = known && Number.isFinite(m) ? Math.floor(m) : null;
  }

  return {
    legs,
    cashUsd: cashBase / 1e6,
    feesUsd: feeBase / 1e6,
    feeRate,
    payoutByBucket: payout,
    scheduleBase: payoutBase,
    stakeBase,
    minPayout: Math.min(...payout),
    maxPayout: Math.max(...payout),
    evUnderBelief: belief.reduce((a, b, j) => a + b * payout[j], 0),
    evUnderMarket: q.reduce((a, b, j) => a + b * payout[j], 0),
    probProfitBelief,
    probProfitMarket,
    expectedLogGrowth,
    advice: cashBase > 0.95 * stakeBase ? "no_edge" : "trade",
    comparison,
    maxAbsorbableStakeUsd: maxAbsorb,
    raw: {
      weights: solved.w,
      instruments: inst.map((s) => ({ index: s.index, side: s.side, price: s.price })),
      payoutByBucket: rawPayout,
      expectedLogGrowth: rawElg,
      iterations,
      converged,
    },
  };
}
