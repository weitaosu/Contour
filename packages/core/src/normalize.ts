import { normalize as normalizeVec, normCdf, normSf } from "./math";
import type { Instrument, Ladder, LadderKind } from "./types";

/** Structural subset of the Gemini event shape that core needs (core has no I/O dependency). */
export interface EventLike {
  ticker: string;
  title: string;
  category: string;
  series?: string | null;
  expiryDate: string;
  template?: string | null;
  contracts: ContractLike[];
}
export interface ContractLike {
  label: string;
  instrumentSymbol: string;
  strike?: { type: string; value: string } | null;
  prices?: {
    buy?: { yes?: string; no?: string };
    bestBid?: string | null;
    bestAsk?: string | null;
  };
  quantityMinimum?: string;
  quantityIncrement?: string;
  priceIncrement?: string;
  resolutionSide?: "yes" | "no";
  settlementValue?: string;
  /** The contract's rules (Gemini sends rich text); read only for an explicit "mutually exclusive" statement. */
  description?: unknown;
}

export const MAX_BUCKETS = 40;
export const MIN_QUOTED = 3;
export const PROB_FLOOR = 0.001;
/**
 * A strike's quote only counts as evidence of the market's odds when it is two-sided and no wider
 * than this (yes ask + no ask − 1). Wider or one-sided quotes (common on thin ladders and in a
 * market's last minutes) only bound the estimate.
 */
export const MAX_RELIABLE_SPREAD = 0.2;

export type Classification =
  | { ok: true; kind: LadderKind }
  | { ok: false; reason: string };

export interface NormalizeOptions {
  /** Event tickers allowed as categorical (named, exactly one winner). Never guessed. */
  categoricalAllowlist?: readonly string[];
  /** Skip the quoted-count check (used to read the shape of settled ladders, which have no quotes). */
  allowUnquoted?: boolean;
}

const num = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Label numbers may carry thousands separators ("7,600 to 7,799.99"). The regexes capture them with
// commas; `labelNum` strips the commas and `step` reads the precision the label is written to.
const NUM = "(-?\\d[\\d,]*(?:\\.\\d+)?)";
const RANGE_RE = new RegExp(`${NUM}\\D+?\\bto\\b\\D*?${NUM}`, "i");
const BELOW_RE = new RegExp(`${NUM}[^\\d]*?\\bor (?:below|less|lower)\\b`, "i");
const ABOVE_RE = new RegExp(`${NUM}[^\\d]*?\\bor (?:above|more|higher)\\b`, "i");
const labelNum = (s: string) => Number(s.replace(/,/g, ""));
/** The smallest step a label number is written to: "59" → 1, "2.5" → 0.1, "7,599.99" → 0.01. */
const step = (s: string) => {
  const d = s.split(".")[1]?.length ?? 0;
  return 10 ** -d;
};

interface ParsedBucket {
  c: ContractLike;
  lo: number | null; // inclusive, null = -inf
  hi: number | null; // inclusive, null = +inf
  /** Precision each bound is written to, for checking that the next range starts right after this one. */
  hiStep?: number;
  loStep?: number;
  /** The gap from this range's end to the next one's start (the finer of the two precisions). */
  gap?: number;
}

/** Bucket role of a contract: from `strike` when present, else from its label. */
function bucketRole(c: ContractLike): { role: "below" | "above" | "range"; lo?: number; hi?: number; hiStep?: number; loStep?: number } | null {
  const t = c.strike?.type;
  if (t === "below") return { role: "below", hi: num(c.strike!.value) ?? undefined, hiStep: step(c.strike!.value) };
  if (t === "above") return { role: "above", lo: num(c.strike!.value) ?? undefined, loStep: step(c.strike!.value) };
  if (c.strike) return null;
  const b = BELOW_RE.exec(c.label);
  if (b) return { role: "below", hi: labelNum(b[1]), hiStep: step(b[1]) };
  const a = ABOVE_RE.exec(c.label);
  if (a) return { role: "above", lo: labelNum(a[1]), loStep: step(a[1]) };
  const r = RANGE_RE.exec(c.label);
  if (r) return { role: "range", lo: labelNum(r[1]), hi: labelNum(r[2]), hiStep: step(r[2]), loStep: step(r[1]) };
  return null;
}

/** "X or above" contracts with no strike field (e.g. "8,000 or above"): their thresholds, or null. */
function labelThresholds(cs: ContractLike[]): number[] | null {
  if (cs.some((c) => c.strike)) return null;
  const vals = cs.map((c) => ABOVE_RE.exec(c.label)).map((m) => (m ? labelNum(m[1]) : NaN));
  return vals.every(Number.isFinite) ? vals : null;
}

/**
 * Prices consistent with exactly one listed outcome winning: total bids ≤ 1 ≤ total asks (otherwise
 * buying every outcome, or selling every outcome, would be free money). Asks totalling well under 1
 * mean the market prices a real chance that none of the listed outcomes wins, which a payout
 * schedule over these outcomes can't honour. Unquoted sides count at their bounds (bid 0, ask 1).
 */
export const MAX_UNLISTED = 0.05;
function pricesCoverOneWinner(cs: ContractLike[]): boolean {
  let bids = 0;
  let asks = 0;
  for (const c of cs) {
    const i = toInstrument(c);
    bids += i.bestBid ?? (i.noAsk !== null ? 1 - i.noAsk : 0);
    asks += i.bestAsk ?? i.yesAsk ?? 1;
  }
  return bids <= 1 + MAX_UNLISTED && asks >= 1 - MAX_UNLISTED;
}

/** Gemini's own rules for every contract say the event is mutually exclusive (exactly one can resolve yes). */
function rulesSayExclusive(cs: ContractLike[]): boolean {
  return cs.every((c) => c.description !== undefined && JSON.stringify(c.description).toLowerCase().includes("mutually exclusive"));
}

/** Weather-style ladders: one "X or below", contiguous integer ranges "a to b", one "Y or above". */
function parseBucketLadder(contracts: ContractLike[]): ParsedBucket[] | null {
  const roles = contracts.map(bucketRole);
  if (roles.some((r) => r === null)) return null;
  const below = contracts.filter((_, i) => roles[i]!.role === "below");
  const above = contracts.filter((_, i) => roles[i]!.role === "above");
  if (below.length !== 1 || above.length !== 1) return null;
  const parsed: ParsedBucket[] = [];
  contracts.forEach((c, i) => {
    const r = roles[i]!;
    if (r.role === "range" && r.hi! >= r.lo!) parsed.push({ c, lo: r.lo!, hi: r.hi! });
  });
  if (parsed.length !== contracts.length - 2 || parsed.length < 1) return null;
  contracts.forEach((c, i) => {
    const r = roles[i]!;
    if (r.role === "range") Object.assign(parsed.find((p) => p.c === c)!, { hiStep: r.hiStep, loStep: r.loStep });
  });
  parsed.sort((a, b) => (a.lo as number) - (b.lo as number));
  const belowRole = roles[contracts.indexOf(below[0])]!;
  const aboveRole = roles[contracts.indexOf(above[0])]!;
  const b = belowRole.hi;
  const a = aboveRole.lo;
  if (b === undefined || a === undefined) return null;
  // No gaps and no overlaps: each range starts exactly one step after the previous one ends, the
  // step being the finer precision of the two labels: 1 for "58 to 59" | "60 to 61"; 0.01 for
  // "7,400 to 7,599.99" | "7,600 to …" and for "8,800 to 9,000" | "9,000.01 or above".
  const stepOf = (x?: number, y?: number) => (x === undefined ? y : y === undefined ? x : Math.min(x, y));
  const meets = (hi: number, st: number | undefined, lo: number) => st !== undefined && Math.abs(lo - (hi + st)) <= st * 1e-6;
  const chain: ParsedBucket[] = [{ c: below[0], lo: null, hi: b, hiStep: belowRole.hiStep }, ...parsed, { c: above[0], lo: a, hi: null, loStep: aboveRole.loStep }];
  for (let i = 1; i < chain.length; i++) {
    const st = stepOf(chain[i - 1].hiStep, chain[i].loStep);
    if (!meets(chain[i - 1].hi as number, st, chain[i].lo as number)) return null;
    chain[i - 1].gap = st; // the cut goes halfway across this gap
  }
  return chain;
}

export function classify(e: EventLike, opts: NormalizeOptions = {}): Classification {
  const cs = e.contracts;
  if (!cs || cs.length < 2) return { ok: false, reason: "fewer than 2 outcomes" };
  if (opts.categoricalAllowlist?.includes(e.ticker)) return { ok: true, kind: "categorical" };
  const allAbove = cs.every((c) => c.strike?.type === "above");
  const allOver = cs.every((c) => c.strike?.type === "over");
  if (allAbove || (allOver && e.template === "sports-total")) {
    const vals = cs.map((c) => num(c.strike!.value));
    if (vals.some((v) => v === null)) return { ok: false, reason: "non-numeric strike" };
    if (new Set(vals).size !== vals.length) return { ok: false, reason: "duplicate strikes (more than one underlying)" };
    return { ok: true, kind: "threshold" };
  }
  if (e.template === "sports-spread") return { ok: false, reason: "two-sided spread ladder" };
  if (e.template === "sports-player-props") return { ok: false, reason: "several underlyings in one event" };
  const lt = labelThresholds(cs);
  if (lt) {
    if (new Set(lt).size !== lt.length) return { ok: false, reason: "duplicate strikes (more than one underlying)" };
    return { ok: true, kind: "threshold" };
  }
  if (parseBucketLadder(cs)) return { ok: true, kind: "buckets" };
  // A race of named outcomes: accepted on Gemini's own word that it is mutually exclusive, and only
  // while its prices agree that one of the listed outcomes will win.
  if (cs.length >= 3 && rulesSayExclusive(cs)) {
    if (!pricesCoverOneWinner(cs)) return { ok: false, reason: "the market prices a real chance that none of the listed outcomes wins" };
    return { ok: true, kind: "categorical" };
  }
  return { ok: false, reason: "outcomes not provably mutually exclusive" };
}

function detectUnit(labels: string[]): { prefix: string; suffix: string } {
  if (labels.some((l) => l.trim().startsWith("$"))) return { prefix: "$", suffix: "" };
  if (labels.some((l) => l.includes("°F"))) return { prefix: "", suffix: "°F" };
  if (labels.some((l) => l.includes("°C"))) return { prefix: "", suffix: "°C" };
  return { prefix: "", suffix: "" };
}

export function formatValue(v: number, unit: { prefix: string; suffix: string }, compact = false): string {
  let s: string;
  if (compact && Math.abs(v) >= 10_000) s = `${+(v / 1000).toFixed(Math.abs(v) >= 100_000 ? 0 : 1)}k`;
  else s = v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${unit.prefix}${s}${unit.suffix}`;
}

/**
 * A contract's quote as Contour uses it. Gemini fills `buy` with its last trade price on a side that
 * has no order, which shows up as a locked quote: YES bid = YES ask (yes ask + no ask = $1 exactly).
 * A locked book can't rest on an exchange (the two orders would match), so only the side the order
 * book backs is kept: bestAsk backs the YES ask, bestBid (a YES bid) backs the NO ask. With neither,
 * the contract is treated as unquoted.
 */
export function instrumentFromContract(c: ContractLike): Instrument {
  let yesAsk = num(c.prices?.buy?.yes);
  let noAsk = num(c.prices?.buy?.no);
  const bestBid = num(c.prices?.bestBid);
  const bestAsk = num(c.prices?.bestAsk);
  const bid = bestBid ?? (noAsk !== null ? 1 - noAsk : null);
  const ask = bestAsk ?? yesAsk;
  if (bid !== null && ask !== null && Math.abs(ask - bid) < 1e-9) {
    if (bestAsk === null) yesAsk = null;
    if (bestBid === null) noAsk = null;
  }
  return {
    symbol: c.instrumentSymbol,
    label: c.label,
    yesAsk,
    noAsk,
    bestBid,
    bestAsk,
    minQty: num(c.quantityMinimum) ?? 0.01,
    qtyStep: num(c.quantityIncrement) ?? 0.01,
    priceStep: num(c.priceIncrement) ?? 0.01,
  };
}
const toInstrument = instrumentFromContract;

/** Mid price with fallbacks: bid = bestBid ?? 1 - noAsk; ask = bestAsk ?? yesAsk. */
export function instrumentMid(i: Instrument): number | null {
  const bid = i.bestBid ?? (i.noAsk !== null ? 1 - i.noAsk : null);
  const ask = i.bestAsk ?? i.yesAsk;
  if (bid === null || ask === null) return null;
  return (bid + ask) / 2;
}

/** Linear interpolation of missing values over x; flat extrapolation at the ends. */
function interpolate(xs: number[], ys: (number | null)[]): { values: number[]; filled: boolean[] } {
  const known = ys.map((y, i) => (y === null ? -1 : i)).filter((i) => i >= 0);
  const filled = ys.map((y) => y === null);
  if (known.length === 0) return { values: ys.map(() => 0.5), filled };
  const values = ys.map((y, i) => {
    if (y !== null) return y;
    const left = [...known].reverse().find((k) => k < i);
    const right = known.find((k) => k > i);
    if (left === undefined) return ys[right!] as number;
    if (right === undefined) return ys[left] as number;
    const t = (xs[i] - xs[left]) / (xs[right] - xs[left]);
    return (ys[left] as number) + t * ((ys[right] as number) - (ys[left] as number));
  });
  return { values, filled };
}

/** Bid and ask for YES, with the same fallbacks as instrumentMid. */
function bidAsk(i: Instrument): { bid: number | null; ask: number | null } {
  return { bid: i.bestBid ?? (i.noAsk !== null ? 1 - i.noAsk : null), ask: i.bestAsk ?? i.yesAsk };
}

/** Inverse standard normal CDF by bisection (only called on a handful of points per ladder). */
function normInv(p: number): number {
  let lo = -12;
  let hi = 12;
  for (let k = 0; k < 80; k++) {
    const m = (lo + hi) / 2;
    if (normCdf(m) < p) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * A normal fitted to the priced strikes: Φ⁻¹(1 − P(X ≥ s)) = (s − μ)/σ, least squares. Null when the
 * prices don't slope down (too few points, or they contradict each other).
 */
function fitNormal(xs: number[], ps: number[]): { mu: number; sigma: number } | null {
  const pts = xs.map((x, i) => [x, ps[i]] as const).filter(([, p]) => p > 0.005 && p < 0.995);
  if (pts.length < 2) return null;
  const zs = pts.map(([, p]) => normInv(1 - p));
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  const mz = zs.reduce((a, z) => a + z, 0) / zs.length;
  let sxx = 0;
  let sxz = 0;
  pts.forEach(([x], i) => {
    sxx += (x - mx) ** 2;
    sxz += (x - mx) * (zs[i] - mz);
  });
  if (!(sxx > 0) || !(sxz > 0)) return null;
  const slope = sxz / sxx;
  return { mu: mx - mz / slope, sigma: 1 / slope };
}

/**
 * Two or more unpriced strikes at an end of the ladder taper along a normal fitted to the priced
 * strikes, starting from the last price, instead of keeping it flat: flat would put all of the
 * missing probability into the open-ended end bucket ("Below X", "X or above"). A single unpriced
 * end strike keeps the flat value, as scripts/fixtures/reference.py does.
 */
function taperTails(values: number[], strikes: number[], reliable: boolean[]): number[] {
  const idx = reliable.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return values;
  const F = idx[0];
  const L = idx[idx.length - 1];
  if (F < 2 && strikes.length - 1 - L < 2) return values;
  const fit =
    fitNormal(
      idx.map((i) => strikes[i]),
      idx.map((i) => values[i]),
    ) ?? { mu: (strikes[F] + strikes[L]) / 2, sigma: Math.max((strikes[L] - strikes[F]) / 2, Math.abs(strikes[1] - strikes[0]) || 1) };
  const z = (s: number) => (s - fit.mu) / fit.sigma;
  const out = [...values];
  if (strikes.length - 1 - L >= 2) {
    const base = normSf(z(strikes[L]));
    for (let i = L + 1; i < strikes.length; i++) out[i] = base > 1e-300 ? values[L] * (normSf(z(strikes[i])) / base) : 0;
  }
  if (F >= 2) {
    const base = normCdf(z(strikes[F]));
    for (let i = 0; i < F; i++) out[i] = base > 1e-300 ? 1 - (1 - values[F]) * (normCdf(z(strikes[i])) / base) : 1;
  }
  return out;
}

/**
 * Prices that contradict each other on a threshold ladder: a higher strike bid more than `tol` above
 * a lower strike's ask. Buying the lower strike and selling the higher one would then be free money,
 * so the prices can't be read as one market's odds. Crossed quotes (stale) are skipped.
 */
export const MAX_CONTRADICTION = 0.05;
export function contradiction(instruments: Instrument[], strikes: number[], tol = MAX_CONTRADICTION): { low: number; high: number; ask: number; bid: number } | null {
  const q = instruments.map(bidAsk);
  const ok = q.map(({ bid, ask }) => !(bid !== null && ask !== null && bid > ask + 1e-9));
  let worst: { low: number; high: number; ask: number; bid: number } | null = null;
  for (let i = 0; i < q.length; i++) {
    const ask = q[i].ask;
    if (!ok[i] || ask === null) continue;
    for (let j = i + 1; j < q.length; j++) {
      const bid = q[j].bid;
      if (!ok[j] || bid === null) continue;
      if (bid - ask > tol && (!worst || bid - ask > worst.bid - worst.ask)) worst = { low: strikes[i], high: strikes[j], ask, bid };
    }
  }
  return worst;
}

/**
 * The market's P(price ≥ strike) for a threshold ladder. Only tight two-sided quotes are evidence;
 * the rest are filled in from their neighbours (long unpriced tails taper, see taperTails) and then
 * kept inside whatever bound their quote does show, so a stale, one-sided or very wide quote can't
 * bend the curve. Finally the curve is forced non-increasing (running minimum, as in
 * scripts/fixtures/reference.py); ladders whose prices contradict each other are rejected before
 * this, so the running minimum only ever smooths small wobbles.
 */
export function thresholdSurvival(instruments: Instrument[], strikes: number[]): { values: number[]; reliable: boolean[] } {
  const quotes = instruments.map(bidAsk);
  const reliable = quotes.map(({ bid, ask }) => bid !== null && ask !== null && ask >= bid - 1e-9 && ask - bid <= MAX_RELIABLE_SPREAD + 1e-9);
  const mids = quotes.map((q, i) => (reliable[i] ? (q.bid! + q.ask!) / 2 : null));
  const values = taperTails(interpolate(strikes, mids).values, strikes, reliable);
  const bounded = values.map((v, i) => {
    const { bid, ask } = quotes[i];
    let x = Math.min(1, Math.max(0, v));
    if (!reliable[i]) {
      if (bid !== null && ask !== null && ask >= bid) x = Math.min(ask, Math.max(bid, x));
      else if (bid !== null) x = Math.max(bid, x);
      else if (ask !== null) x = Math.min(ask, x);
    }
    return x;
  });
  const out: number[] = [];
  bounded.forEach((v, i) => out.push(Math.min(v, i > 0 ? out[i - 1] : 1)));
  return { values: out, reliable };
}

/**
 * Chances for a set of outcomes where exactly one wins (weather buckets, named outcomes): they sum to
 * 1 and stay inside each outcome's own quote where they can. Tight two-sided quotes start at their
 * mid; on ordered buckets an unpriced gap between priced outcomes is filled linearly, and outcomes
 * beyond the priced ones start at 0 (never at a neighbour's price). Every outcome is then held
 * inside its bid and ask, one-sided quotes included, and the difference to 1 is shared out in
 * proportion to how loosely each outcome is priced, so tight quotes barely move and unpriced
 * outcomes take up the slack.
 */
export function exclusiveProbs(instruments: Instrument[], centers: number[] | null): { probs: number[]; reliable: boolean[] } {
  const q = instruments.map(bidAsk);
  const crossed = q.map(({ bid, ask }) => bid !== null && ask !== null && bid > ask + 1e-9);
  const reliable = q.map(({ bid, ask }, i) => !crossed[i] && bid !== null && ask !== null && ask - bid <= MAX_RELIABLE_SPREAD + 1e-9);
  const mids = q.map(({ bid, ask }, i) => (reliable[i] || crossed[i] ? (bid! + ask!) / 2 : null));
  const start = mids.map((m) => m ?? 0);
  if (centers) {
    const known = reliable.map((r, i) => (r ? i : -1)).filter((i) => i >= 0);
    for (let k = 1; k < known.length; k++) {
      const a = known[k - 1];
      const b = known[k];
      for (let i = a + 1; i < b; i++) {
        if (mids[i] !== null) continue;
        const t = (centers[i] - centers[a]) / (centers[b] - centers[a]);
        start[i] = mids[a]! + t * (mids[b]! - mids[a]!);
      }
    }
  }
  const lo = q.map(({ bid }, i) => (crossed[i] || bid === null ? 0 : Math.min(1, Math.max(0, bid))));
  const hi = q.map(({ ask }, i) => (crossed[i] || ask === null ? 1 : Math.min(1, Math.max(lo[i], ask))));
  const w = lo.map((l, i) => Math.max(0.01, hi[i] - l));
  const at = (lambda: number) => start.map((s, i) => Math.min(hi[i], Math.max(lo[i], s + lambda * w[i])));
  const total = (lambda: number) => at(lambda).reduce((a, b) => a + b, 0);
  let a = -100;
  let b = 100;
  let lambda: number;
  if (total(a) >= 1) lambda = a;
  else if (total(b) <= 1) lambda = b;
  else {
    for (let k = 0; k < 100; k++) {
      const m = (a + b) / 2;
      if (total(m) < 1) a = m;
      else b = m;
    }
    lambda = (a + b) / 2;
  }
  // Quotes that can't add up to 1 at all (bids over 1, or asks under 1) are scaled to fit.
  return { probs: at(lambda), reliable };
}

export class LadderRejected extends Error {}

/** Normalize a Gemini event into a Ladder. Throws LadderRejected with a reason when it cannot be traded safely. */
export function normalizeEvent(e: EventLike, opts: NormalizeOptions = {}): Ladder {
  const cls = classify(e, opts);
  if (!cls.ok) throw new LadderRejected(cls.reason);
  const unit = detectUnit(e.contracts.map((c) => c.label));
  const base = {
    eventTicker: e.ticker,
    title: e.title,
    category: e.category,
    series: e.series ?? null,
    expiry: e.expiryDate,
    unit,
  };
  let ladder: Ladder;

  if (cls.kind === "threshold") {
    const strikeOf = (c: ContractLike) => (c.strike ? Number(c.strike.value) : labelNum(ABOVE_RE.exec(c.label)![1]));
    const sorted = [...e.contracts].sort((a, b) => strikeOf(a) - strikeOf(b));
    const strikes = sorted.map(strikeOf);
    const instruments = sorted.map(toInstrument);
    const n = strikes.length;
    const bad = opts.allowUnquoted ? null : contradiction(instruments, strikes);
    if (bad) {
      const fv = (v: number) => formatValue(v, unit);
      throw new LadderRejected(
        `prices contradict each other: above ${fv(bad.high)} is bid ${Math.round(bad.bid * 100)}¢ while above ${fv(bad.low)} is offered at ${Math.round(bad.ask * 100)}¢`,
      );
    }
    const { values: m, reliable } = thresholdSurvival(instruments, strikes);
    const reliableCount = reliable.filter(Boolean).length;
    if (!opts.allowUnquoted && reliableCount < MIN_QUOTED)
      throw new LadderRejected(`only ${reliableCount} strikes have tight two-sided quotes, too few to read the market's odds`);
    const filled = reliable.map((r) => !r);
    const q = new Array<number>(n + 1);
    q[0] = 1 - m[0];
    for (let j = 1; j < n; j++) q[j] = m[j - 1] - m[j];
    q[n] = m[n - 1];
    const fv = (v: number) => formatValue(v, unit);
    const bucketLabels = [`Below ${fv(strikes[0])}`];
    for (let j = 1; j < n; j++) bucketLabels.push(`${fv(strikes[j - 1])} to ${fv(strikes[j])}`);
    bucketLabels.push(`${fv(strikes[n - 1])} or above`);
    ladder = {
      ...base,
      kind: "threshold",
      strikes,
      cuts: strikes,
      bucketLabels,
      cutLabels: strikes.map((s) => formatValue(s, unit, true)),
      instruments,
      marketProb: normalizeVec(q, PROB_FLOOR),
      quoted: instruments.map((i) => i.yesAsk !== null && i.noAsk !== null),
      crossed: instruments.map((i) => i.yesAsk !== null && i.noAsk !== null && i.yesAsk + i.noAsk < 1 - 1e-9),
      interpolated: filled,
    };
  } else if (cls.kind === "buckets") {
    const parsed = parseBucketLadder(e.contracts)!;
    const instruments = parsed.map((p) => toInstrument(p.c));
    // Cut points sit halfway across the step between one range's end and the next one's start:
    // 59 | 60 → 59.5; 7,599.99 | 7,600 → 7,599.995; 9,000 | 9,000.01 → 9,000.005.
    const cuts = parsed.slice(0, -1).map((p) => (p.hi as number) + (p.gap ?? 1) / 2);
    const centers = parsed.map((p) =>
      p.lo === null ? cuts[0] - 1 : p.hi === null ? cuts[cuts.length - 1] + 1 : ((p.lo as number) + (p.hi as number)) / 2,
    );
    const { probs, reliable } = exclusiveProbs(instruments, centers);
    ladder = {
      ...base,
      kind: "buckets",
      strikes: [],
      cuts,
      bucketLabels: parsed.map((p) => p.c.label),
      // Label each cut with the rounder of its two neighbouring bounds: "4,000" between "3,999.99"
      // and "4,000"; "9,000" between "9,000" and "9,000.01". When both are written alike, the cut
      // itself: "59.5°F" between 59 and 60.
      cutLabels: cuts.map((c, i) => {
        const cur = parsed[i];
        const nxt = parsed[i + 1];
        const hs = cur.hiStep ?? 1;
        const ls = nxt.loStep ?? 1;
        if (ls > hs + 1e-12) return formatValue(nxt.lo as number, unit, true);
        if (hs > ls + 1e-12) return formatValue(cur.hi as number, unit, true);
        return formatValue(c, unit, true);
      }),
      instruments,
      marketProb: normalizeVec(probs, PROB_FLOOR),
      quoted: instruments.map((i) => i.yesAsk !== null && i.noAsk !== null),
      crossed: instruments.map((i) => i.yesAsk !== null && i.noAsk !== null && i.yesAsk + i.noAsk < 1 - 1e-9),
      interpolated: reliable.map((r) => !r),
    };
  } else {
    const instruments = e.contracts.map(toInstrument);
    const { probs, reliable } = exclusiveProbs(instruments, null);
    ladder = {
      ...base,
      kind: "categorical",
      strikes: [],
      cuts: null,
      bucketLabels: e.contracts.map((c) => c.label),
      cutLabels: [],
      instruments,
      marketProb: normalizeVec(probs, PROB_FLOOR),
      quoted: instruments.map((i) => i.yesAsk !== null && i.noAsk !== null),
      crossed: instruments.map((i) => i.yesAsk !== null && i.noAsk !== null && i.yesAsk + i.noAsk < 1 - 1e-9),
      interpolated: reliable.map((r) => !r),
    };
  }

  const nBuckets = ladder.marketProb.length;
  if (nBuckets > MAX_BUCKETS) throw new LadderRejected(`${nBuckets} outcomes exceeds the ${MAX_BUCKETS}-bucket schedule limit`);
  const quotedCount = ladder.quoted.filter(Boolean).length;
  if (!opts.allowUnquoted && quotedCount < MIN_QUOTED) throw new LadderRejected(`only ${quotedCount} quoted instruments`);
  return ladder;
}

export function tryNormalize(e: EventLike, opts: NormalizeOptions = {}): { ladder: Ladder } | { reason: string } {
  try {
    return { ladder: normalizeEvent(e, opts) };
  } catch (err) {
    if (err instanceof LadderRejected) return { reason: err.message };
    throw err;
  }
}

/** Tradable = both asks present, inside (0, 1), and not crossed. */
export function isTradable(l: Ladder, i: number): boolean {
  const ins = l.instruments[i];
  return (
    l.quoted[i] &&
    !l.crossed[i] &&
    ins.yesAsk !== null &&
    ins.noAsk !== null &&
    ins.yesAsk > 0 &&
    ins.yesAsk < 1 &&
    ins.noAsk > 0 &&
    ins.noAsk < 1
  );
}

/** Buckets in which instrument i pays 1 on the given side. */
export function paysIn(l: Ladder, i: number, side: "yes" | "no", bucket: number): boolean {
  const yes = l.kind === "threshold" ? bucket >= i + 1 : bucket === i;
  return side === "yes" ? yes : !yes;
}
