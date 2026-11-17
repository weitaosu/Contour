import { blend } from "./beliefs";
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
}

export interface SolverInstrument {
  index: number; // ladder instrument index, -1 for cash
  side: "cash" | "yes" | "no";
  price: number;
  pays: boolean[]; // per bucket
}

export function buildInstruments(ladder: Ladder): SolverInstrument[] {
  const nB = ladder.marketProb.length;
  const out: SolverInstrument[] = [{ index: -1, side: "cash", price: 1, pays: new Array(nB).fill(true) }];
  ladder.instruments.forEach((ins, i) => {
    if (!isTradable(ladder, i)) return;
    for (const side of ["yes", "no"] as const) {
      const price = side === "yes" ? (ins.yesAsk as number) : (ins.noAsk as number);
      const pays = Array.from({ length: nB }, (_, j) => paysIn(ladder, i, side, j));
      out.push({ index: i, side, price, pays });
    }
  });
  return out;
}

/** Cover's multiplicative update for max sum_j p_j log(sum_k w_k R_kj) on the simplex. */
export function solveGrowthOptimal(
  p: readonly number[],
  inst: readonly SolverInstrument[],
  opts: { maxIter?: number; tol?: number; warmStart?: number[] } = {},
): { w: number[]; iterations: number; converged: boolean } {
  const K = inst.length;
  const N = p.length;
  const maxIter = opts.maxIter ?? 50_000;
  const tol = opts.tol ?? 1e-7;
  // R[k][j] = payoff / price, stored as Float64Array rows.
  const R = inst.map((s) => Float64Array.from(s.pays, (b) => (b ? 1 / s.price : 0)));
  let w: number[];
  if (opts.warmStart && opts.warmStart.length === K) {
    // Mix in a little uniform mass: multiplicative updates cannot revive exact zeros.
    const ws = opts.warmStart.reduce((a, b) => a + b, 0) || 1;
    w = opts.warmStart.map((x) => 0.98 * (x / ws) + 0.02 / K);
  } else w = new Array(K).fill(1 / K);
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
  const q = ladder.marketProb;
  const nB = q.length;
  if (belief.length !== nB) throw new Error(`belief has ${belief.length} buckets, ladder has ${nB}`);
  if (!(stakeUsd > 0)) throw new Error("stake must be positive");
  const p = blend(belief, q, confidence);
  const inst = buildInstruments(ladder);
  const { w, iterations, converged } = solveGrowthOptimal(p, inst, {
    maxIter: input.maxIter,
    tol: input.tol,
    warmStart: input.warmStart,
  });

  // Raw (pre post-processing) result, used by the fixture test.
  const rawPayout = new Array<number>(nB).fill(0);
  inst.forEach((s, k) => s.pays.forEach((b, j) => b && (rawPayout[j] += (w[k] * stakeUsd) / s.price)));
  const rawElg = p.reduce((a, pj, j) => a + pj * Math.log(rawPayout[j] / stakeUsd), 0);

  // ---- Post-processing, in integer USDC base units ----
  const stakeBase = toBase(stakeUsd);
  const minLegUsd = input.minLegUsd ?? 1;
  const doPost = input.postProcess !== false;
  const legs: Leg[] = [];
  let legCostBase = 0;
  const payoutBase = new Array<number>(nB).fill(0);
  inst.forEach((s, k) => {
    if (s.side === "cash") return;
    const ins = ladder.instruments[s.index];
    const usd = w[k] * stakeUsd;
    let qty = usd / s.price;
    let capped = false;
    if (doPost) {
      if (usd < minLegUsd || qty < ins.minQty) return; // 1. drop small legs -> cash
      qty = floorTo(qty, ins.qtyStep); // 2. round down to the quantity step -> remainder to cash
      const avail = input.depth?.[ins.symbol]?.[s.side]; // 3. cap at depth when known
      if (avail !== undefined && qty > avail) {
        qty = floorTo(avail, ins.qtyStep);
        capped = true;
      }
      if (qty < ins.minQty || qty * s.price < minLegUsd) return;
    }
    const qtyR = Math.round(qty * 1e6) / 1e6;
    const costBase = Math.round(qtyR * s.price * 1e6);
    if (costBase <= 0) return;
    legCostBase += costBase;
    const payBase = Math.round(qtyR * 1e6);
    s.pays.forEach((b, j) => b && (payoutBase[j] += payBase));
    legs.push({
      symbol: ins.symbol,
      label: ins.label,
      side: s.side,
      strike: ladder.kind === "threshold" ? ladder.strikes[s.index] : null,
      instrumentIndex: s.index,
      price: s.price,
      qty: qtyR,
      usd: costBase / 1e6,
      capped,
    });
  });
  const cashBase = stakeBase - legCostBase; // 4. everything not in legs is cash; exact to the base unit
  for (let j = 0; j < nB; j++) payoutBase[j] += cashBase;
  const payout = payoutBase.map((b) => b / 1e6);

  const profit = payoutBase.map((b) => b > stakeBase);
  const probProfitBelief = belief.reduce((a, b, j) => a + (profit[j] ? b : 0), 0);
  const probProfitMarket = q.reduce((a, b, j) => a + (profit[j] ? b : 0), 0);
  const expectedLogGrowth = p.reduce((a, pj, j) => a + pj * Math.log(payoutBase[j] / stakeBase), 0);

  // Single best contract for the same forecast: highest P_belief(win) / price.
  let comparison: Comparison | null = null;
  let bestRatio = -Infinity;
  for (const s of inst) {
    if (s.side === "cash") continue;
    const pb = belief.reduce((a, b, j) => a + (s.pays[j] ? b : 0), 0);
    const ratio = pb / s.price;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      const ins = ladder.instruments[s.index];
      const qty = Math.round(floorTo(stakeUsd / s.price, ins.qtyStep) * 1e6) / 1e6;
      comparison = {
        symbol: ins.symbol,
        label: ins.label,
        side: s.side,
        price: s.price,
        qty,
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
      else m = Math.min(m, (avail * s.price) / w[k]);
    });
    maxAbsorb = known && Number.isFinite(m) ? Math.floor(m) : null;
  }

  return {
    legs,
    cashUsd: cashBase / 1e6,
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
      weights: w,
      instruments: inst.map((s) => ({ index: s.index, side: s.side, price: s.price })),
      payoutByBucket: rawPayout,
      expectedLogGrowth: rawElg,
      iterations,
      converged,
    },
  };
}
