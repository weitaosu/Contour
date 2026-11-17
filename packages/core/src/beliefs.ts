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

/** User-dragged bars, normalized. */
export function fromBars(values: readonly number[]): number[] {
  return normalize(values.map((v) => Math.max(0, v)), BELIEF_FLOOR);
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
