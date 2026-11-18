import { normCdf, normalize, normSf } from "./math";
import type { Ladder } from "./types";

export const BELIEF_FLOOR = 1e-4;

/** Bucket probabilities from a normal(mean, sd) over the ladder's cut points. Ordered ladders only. */
export function normalBelief(ladder: Ladder, mean: number, sd: number): number[] {
  const cuts = ladder.cuts;
  if (!cuts) throw new Error("normalBelief needs an ordered ladder");
  const s = Math.max(sd, 1e-9);
  const n = cuts.length;
  const out = new Array<number>(n + 1);
  out[0] = normCdf((cuts[0] - mean) / s);
  for (let j = 1; j < n; j++) {
    const a = (cuts[j - 1] - mean) / s;
    const b = (cuts[j] - mean) / s;
    // Use whichever tail is more precise.
    out[j] = a > 0 ? normSf(a) - normSf(b) : normCdf(b) - normCdf(a);
  }
  out[n] = normSf((cuts[n - 1] - mean) / s);
  return normalize(out, BELIEF_FLOOR);
}

/** Representative value of each bucket: interior midpoints; tails extend by the neighbouring width. */
export function bucketMidpoints(ladder: Ladder): number[] {
  const c = ladder.cuts;
  if (!c) throw new Error("bucketMidpoints needs an ordered ladder");
  if (c.length === 1) return [c[0] - 0.5, c[0] + 0.5];
  const mids = [c[0] - (c[1] - c[0]) / 2];
  for (let j = 1; j < c.length; j++) mids.push((c[j - 1] + c[j]) / 2);
  mids.push(c[c.length - 1] + (c[c.length - 1] - c[c.length - 2]) / 2);
  return mids;
}

export function moments(ladder: Ladder, probs: readonly number[]): { mean: number; sd: number } {
  const m = bucketMidpoints(ladder);
  const mean = probs.reduce((a, p, j) => a + p * m[j], 0);
  const v = probs.reduce((a, p, j) => a + p * (m[j] - mean) ** 2, 0);
  return { mean, sd: Math.sqrt(v) };
}

export function marketMoments(ladder: Ladder) {
  return moments(ladder, ladder.marketProb);
}

/** The two-slider control: shift the market's center, scale its width. */
export function fromMarket(ladder: Ladder, shift: number, widthScale: number): number[] {
  const { mean, sd } = marketMoments(ladder);
  return normalBelief(ladder, mean + shift, sd * widthScale);
}

/**
 * "It'll land between A and B": a belief that puts `inside` of the probability on outcomes a..b
 * (inclusive bucket indexes), keeping the market's own shape within and outside the range. If the
 * market already gives the range more than that, the view nudges it 15 points higher (capped at 95%).
 */
export function rangeBelief(ladder: Ladder, from: number, to: number, inside = 0.8): number[] {
  const q = ladder.marketProb;
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(q.length - 1, Math.max(from, to));
  const inRange = (j: number) => j >= a && j <= b;
  const mIn = q.reduce((s, p, j) => s + (inRange(j) ? p : 0), 0);
  const target = Math.min(0.95, Math.max(inside, mIn + 0.15));
  const out = q.map((p, j) => (inRange(j) ? (target * p) / (mIn || 1) : ((1 - target) * p) / (1 - mIn || 1)));
  return normalize(out, BELIEF_FLOOR);
}

/** User-dragged bars, normalized. */
export function fromBars(values: readonly number[]): number[] {
  return normalize(values.map((v) => Math.max(0, v)), BELIEF_FLOOR);
}

/**
 * One-tap takes for named-outcome markets ("more likely than the market thinks"). Each step is an
 * odds ratio: tapping "More likely" on one outcome multiplies its odds against the field by 1.75,
 * whether it's a 40% favorite (→ 54%) or a 2% longshot (→ 3.5%). Relative to the market, so the
 * view moves with it.
 */
export const TAKE_STEPS = [
  { level: -2, label: "Much less likely", ratio: 1 / 3 },
  { level: -1, label: "Less likely", ratio: 1 / 1.75 },
  { level: 0, label: "About right", ratio: 1 },
  { level: 1, label: "More likely", ratio: 1.75 },
  { level: 2, label: "Much more likely", ratio: 3 },
] as const;

export const ODDS_WEIGHT_MIN = 0.02;
export const ODDS_WEIGHT_MAX = 50;
const clampWeight = (w: number) => Math.min(ODDS_WEIGHT_MAX, Math.max(ODDS_WEIGHT_MIN, w));

/**
 * Your odds from the market's and a weight per outcome: p ∝ market × weight. With a single outcome
 * weighted by k, its odds against the field are exactly k times the market's.
 */
export function oddsBelief(market: readonly number[], weights: readonly number[]): number[] {
  return normalize(
    market.map((m, i) => Math.max(1e-9, m) * clampWeight(weights[i] ?? 1)),
    BELIEF_FLOOR,
  );
}

/** The weight that gives outcome i exactly chance p, holding every other outcome's weight. */
export function weightForChance(market: readonly number[], weights: readonly number[], i: number, p: number): number {
  const target = Math.min(0.97, Math.max(0.001, p));
  const others = market.reduce((s, m, j) => (j === i ? s : s + Math.max(1e-9, m) * clampWeight(weights[j] ?? 1)), 0);
  return clampWeight((target * others) / (Math.max(1e-9, market[i]) * (1 - target)));
}

/** Blend: p = c * belief + (1 - c) * market. */
export function blend(belief: readonly number[], market: readonly number[], confidence: number): number[] {
  const c = Math.min(1, Math.max(0, confidence));
  return belief.map((b, j) => c * b + (1 - c) * market[j]);
}

/** Smallest central interval of buckets holding at least `mass` probability ("the market's likely range"). */
export function likelyRange(probs: readonly number[], mass = 0.5): [number, number] {
  let best: [number, number] = [0, probs.length - 1];
  let bestLen = Infinity;
  for (let i = 0; i < probs.length; i++) {
    let s = 0;
    for (let j = i; j < probs.length; j++) {
      s += probs[j];
      if (s >= mass) {
        if (j - i < bestLen) {
          bestLen = j - i;
          best = [i, j];
        }
        break;
      }
    }
  }
  return best;
}
