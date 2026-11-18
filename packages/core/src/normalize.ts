import { normalize as normalizeVec } from "./math";
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

const RANGE_RE = /(-?\d+(?:\.\d+)?)\D+?\bto\b\D*?(-?\d+(?:\.\d+)?)/i;

interface ParsedBucket {
  c: ContractLike;
  lo: number | null; // inclusive, null = -inf
  hi: number | null; // inclusive, null = +inf
}

const BELOW_RE = /(-?\d+(?:\.\d+)?)[^\d]*?\bor (?:below|less|lower)\b/i;
const ABOVE_RE = /(-?\d+(?:\.\d+)?)[^\d]*?\bor (?:above|more|higher)\b/i;

/** Bucket role of a contract: from `strike` when present, else from its label. */
function bucketRole(c: ContractLike): { role: "below" | "above" | "range"; lo?: number; hi?: number } | null {
  const t = c.strike?.type;
  if (t === "below") return { role: "below", hi: num(c.strike!.value) ?? undefined };
  if (t === "above") return { role: "above", lo: num(c.strike!.value) ?? undefined };
  if (c.strike) return null;
  const b = BELOW_RE.exec(c.label);
  if (b) return { role: "below", hi: Number(b[1]) };
  const a = ABOVE_RE.exec(c.label);
  if (a) return { role: "above", lo: Number(a[1]) };
  const r = RANGE_RE.exec(c.label);
  if (r) return { role: "range", lo: Number(r[1]), hi: Number(r[2]) };
  return null;
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
  parsed.sort((a, b) => (a.lo as number) - (b.lo as number));
  const b = roles[contracts.indexOf(below[0])]!.hi;
  const a = roles[contracts.indexOf(above[0])]!.lo;
  if (b === undefined || a === undefined) return null;
  // Contiguity on an integer grid: below b, then b+1..., ..., then a and above.
  if ((parsed[0].lo as number) !== b + 1) return null;
  for (let i = 1; i < parsed.length; i++) if ((parsed[i].lo as number) !== (parsed[i - 1].hi as number) + 1) return null;
  if (a !== (parsed[parsed.length - 1].hi as number) + 1) return null;
  return [{ c: below[0], lo: null, hi: b }, ...parsed, { c: above[0], lo: a, hi: null }];
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
  if (parseBucketLadder(cs)) return { ok: true, kind: "buckets" };
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

function toInstrument(c: ContractLike): Instrument {
  return {
    symbol: c.instrumentSymbol,
    label: c.label,
    yesAsk: num(c.prices?.buy?.yes),
    noAsk: num(c.prices?.buy?.no),
    bestBid: num(c.prices?.bestBid),
    bestAsk: num(c.prices?.bestAsk),
    minQty: num(c.quantityMinimum) ?? 0.01,
    qtyStep: num(c.quantityIncrement) ?? 0.01,
    priceStep: num(c.priceIncrement) ?? 0.01,
  };
}

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

/**
 * The market's P(price ≥ strike) for a threshold ladder. Only tight two-sided quotes are evidence;
 * the rest are filled in from their neighbours and then kept inside whatever bound their quote does
 * show, so a stale, one-sided or very wide quote can't bend the curve. Finally the curve is forced
 * non-increasing (running minimum, as in scripts/fixtures/reference.py).
 */
export function thresholdSurvival(instruments: Instrument[], strikes: number[]): { values: number[]; reliable: boolean[] } {
  const quotes = instruments.map(bidAsk);
  const reliable = quotes.map(({ bid, ask }) => bid !== null && ask !== null && ask >= bid - 1e-9 && ask - bid <= MAX_RELIABLE_SPREAD + 1e-9);
  const mids = quotes.map((q, i) => (reliable[i] ? (q.bid! + q.ask!) / 2 : null));
  const { values } = interpolate(strikes, mids);
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
    const sorted = [...e.contracts].sort((a, b) => Number(a.strike!.value) - Number(b.strike!.value));
    const strikes = sorted.map((c) => Number(c.strike!.value));
    const instruments = sorted.map(toInstrument);
    const n = strikes.length;
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
    // Cut points between integer buckets sit at the half-step: below b | b+1..: cut at b + 0.5.
    const cuts = parsed.slice(0, -1).map((p) => (p.hi as number) + 0.5);
    const centers = parsed.map((p) =>
      p.lo === null ? cuts[0] - 1 : p.hi === null ? cuts[cuts.length - 1] + 1 : ((p.lo as number) + (p.hi as number)) / 2,
    );
    const { values, filled } = interpolate(centers, instruments.map(instrumentMid));
    ladder = {
      ...base,
      kind: "buckets",
      strikes: [],
      cuts,
      bucketLabels: parsed.map((p) => p.c.label),
      cutLabels: cuts.map((c) => formatValue(c, unit)),
      instruments,
      marketProb: normalizeVec(values.map((v) => Math.max(0, v)), PROB_FLOOR),
      quoted: instruments.map((i) => i.yesAsk !== null && i.noAsk !== null),
      crossed: instruments.map((i) => i.yesAsk !== null && i.noAsk !== null && i.yesAsk + i.noAsk < 1 - 1e-9),
      interpolated: filled,
    };
  } else {
    const instruments = e.contracts.map(toInstrument);
    const mids = instruments.map(instrumentMid);
    ladder = {
      ...base,
      kind: "categorical",
      strikes: [],
      cuts: null,
      bucketLabels: e.contracts.map((c) => c.label),
      cutLabels: [],
      instruments,
      marketProb: normalizeVec(mids.map((v) => (v === null ? 0 : Math.max(0, v))), PROB_FLOOR),
      quoted: instruments.map((i) => i.yesAsk !== null && i.noAsk !== null),
      crossed: instruments.map((i) => i.yesAsk !== null && i.noAsk !== null && i.yesAsk + i.noAsk < 1 - 1e-9),
      interpolated: mids.map((m) => m === null),
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
