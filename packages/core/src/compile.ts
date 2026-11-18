import { blend } from "./beliefs";
import { costPerContract, GEMINI_TAKER_FEE_RATE, tradingFeeUsd } from "./fees";
import { isTradable, paysIn } from "./normalize";
import type { Comparison, DepthMap, Ladder, Leg, Quote } from "./types";

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
}

export interface SolverInstrument {
  index: number; // ladder instrument index, -1 for cash
  side: "cash" | "yes" | "no";
  price: number; // the ask
  /** All-in cost per contract (ask + fee) the optimizer pays; 1 for cash. */
  cost: number;
  pays: boolean[]; // per bucket
}

export function buildInstruments(ladder: Ladder, feeRate = 0): SolverInstrument[] {
  const nB = ladder.marketProb.length;
  const out: SolverInstrument[] = [{ index: -1, side: "cash", price: 1, cost: 1, pays: new Array(nB).fill(true) }];
  ladder.instruments.forEach((ins, i) => {
    if (!isTradable(ladder, i)) return;
    for (const side of ["yes", "no"] as const) {
      const price = side === "yes" ? (ins.yesAsk as number) : (ins.noAsk as number);
      const pays = Array.from({ length: nB }, (_, j) => paysIn(ladder, i, side, j));
      out.push({ index: i, side, price, cost: costPerContract(price, feeRate), pays });
    }
  });
  return out;
}

/** Cover's multiplicative update for max sum_j p_j log(sum_k w_k R_kj) on the simplex. */
export function solveGrowthOptimal(
  p: readonly number[],
  inst: readonly Pick<SolverInstrument, "pays" | "cost">[],
  opts: { maxIter?: number; tol?: number; warmStart?: number[]; exclude?: readonly boolean[] } = {},
): { w: number[]; iterations: number; converged: boolean } {
  const K = inst.length;
  const N = p.length;
  const maxIter = opts.maxIter ?? 50_000;
  const tol = opts.tol ?? 1e-7;
  // R[k][j] = payoff per dollar spent (fees included), stored as Float64Array rows.
  const R = inst.map((s) => Float64Array.from(s.pays, (b) => (b ? 1 / s.cost : 0)));
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
  const q = ladder.marketProb;
  const nB = q.length;
  if (belief.length !== nB) throw new Error(`belief has ${belief.length} buckets, ladder has ${nB}`);
  if (!(stakeUsd > 0)) throw new Error("stake must be positive");
  const p = blend(belief, q, confidence);
  const inst = buildInstruments(ladder, feeRate);
  const solved = solveGrowthOptimal(p, inst, {
    maxIter: input.maxIter,
    tol: input.tol,
    warmStart: input.warmStart,
  });
  const { iterations, converged } = solved;

  // Raw (pre post-processing, unconstrained) result, used by the fixture test and as the next warm start.
  const rawPayout = new Array<number>(nB).fill(0);
  inst.forEach((s, k) => s.pays.forEach((b, j) => b && (rawPayout[j] += (solved.w[k] * stakeUsd) / s.cost)));
  const rawElg = p.reduce((a, pj, j) => a + pj * Math.log(rawPayout[j] / stakeUsd), 0);

  // ---- Post-processing, in integer USDC base units ----
  const stakeBase = toBase(stakeUsd);
  const minLegUsd = input.minLegUsd ?? 1;
  const doPost = input.postProcess !== false;

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
      inst.forEach((s, k) => {
        if (s.side === "cash" || exclude[k]) return;
        const usd = w[k] * stakeUsd;
        if (usd >= material && usd < minLegUsd && (smallest < 0 || usd < w[smallest] * stakeUsd)) smallest = k;
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

  // 1–3. Size each leg from its share of the stake at the all-in (fee-inclusive) cost per contract.
  const sized: { s: SolverInstrument; qty: number; capped: boolean }[] = [];
  inst.forEach((s, k) => {
    if (s.side === "cash") return;
    const ins = ladder.instruments[s.index];
    const usd = w[k] * stakeUsd;
    let qty = usd / s.cost;
    let capped = false;
    if (doPost) {
      if (usd < minLegUsd || qty < ins.minQty) return; // drop small legs -> cash
      qty = floorTo(qty, ins.qtyStep); // round down to the quantity step -> remainder to cash
      const avail = input.depth?.[ins.symbol]?.[s.side]; // cap at depth when known
      if (avail !== undefined && qty > avail) {
        qty = floorTo(avail, ins.qtyStep);
        capped = true;
      }
      if (qty < ins.minQty || qty * s.price < minLegUsd) return;
    }
    sized.push({ s, qty: Math.round(qty * 1e6) / 1e6, capped });
  });
  const legCost = (x: { s: SolverInstrument; qty: number }) => Math.round(x.qty * x.s.price * 1e6);
  const legFee = (x: { s: SolverInstrument; qty: number }) => Math.round(tradingFeeUsd(x.qty, x.s.price, feeRate) * 1e6);
  const spent = () => sized.reduce((a, x) => a + legCost(x) + legFee(x), 0);
  // Gemini rounds each order's fee up to the cent, which can overshoot the optimizer's budget by a
  // cent or two when nearly everything is invested: trim the largest leg a step at a time to fit.
  for (let guard = 0; spent() > stakeBase && sized.length && guard < 10_000; guard++) {
    const big = sized.reduce((a, b) => (legCost(b) > legCost(a) ? b : a));
    const step = ladder.instruments[big.s.index].qtyStep;
    big.qty = Math.round((big.qty - step) * 1e6) / 1e6;
    if (big.qty < ladder.instruments[big.s.index].minQty || (doPost && big.qty * big.s.price < minLegUsd)) sized.splice(sized.indexOf(big), 1);
  }

  const legs: Leg[] = [];
  let legCostBase = 0;
  let feeBase = 0;
  const payoutBase = new Array<number>(nB).fill(0);
  for (const x of sized) {
    const costBase = legCost(x);
    if (costBase <= 0) continue;
    const fBase = legFee(x);
    legCostBase += costBase;
    feeBase += fBase;
    const ins = ladder.instruments[x.s.index];
    const payBase = Math.round(x.qty * 1e6);
    x.s.pays.forEach((b, j) => b && (payoutBase[j] += payBase));
    legs.push({
      symbol: ins.symbol,
      label: ins.label,
      side: x.s.side as "yes" | "no",
      strike: ladder.kind === "threshold" ? ladder.strikes[x.s.index] : null,
      instrumentIndex: x.s.index,
      price: x.s.price,
      qty: x.qty,
      usd: costBase / 1e6,
      fee: fBase / 1e6,
      capped: x.capped,
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
  for (const s of inst) {
    if (s.side === "cash") continue;
    const pb = belief.reduce((a, b, j) => a + (s.pays[j] ? b : 0), 0);
    const ratio = pb / s.cost;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      const ins = ladder.instruments[s.index];
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
      const avail = input.depth?.[ladder.instruments[s.index].symbol]?.[s.side];
      if (avail === undefined) known = false;
      else m = Math.min(m, (avail * s.cost) / w[k]);
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
