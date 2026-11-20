import type { MarketSummary } from "./desk";

/**
 * Which market the live previews show (markets page and landing page): always a SOL price ladder,
 * and always one whose odds look like a bell curve, so the example curve and payouts read well.
 */

const DAY_MS = 24 * 3600_000;
/** Ladders settling sooner than this aren't shown at all: they close for new positions soon. */
const SOON_MS = 2 * 3600_000;

/** Odds normalized to sum to 1. */
function shares(p: number[]) {
  const total = p.reduce((a, b) => a + b, 0) || 1;
  return p.map((x) => x / total);
}

/**
 * Whether a ladder's odds look roughly like a bell curve:
 * - little in the two open-ended tail buckets (≤ 25% together), unlike a flat ladder that piles its
 *   odds at both ends;
 * - one clear peak away from the ends, at least twice an even share;
 * - falling away from that peak on both sides. Thin quotes leave stray odds in far buckets, so a rise
 *   above the lowest point so far is allowed up to a fifth of the peak (at least 3 points).
 */
export function bellShaped(p: number[]): boolean {
  const n = p.length;
  if (n < 5) return false;
  const q = shares(p);
  if (q[0] + q[n - 1] > 0.25) return false;
  const peak = q.indexOf(Math.max(...q));
  if (peak === 0 || peak === n - 1 || q[peak] < 2 / n) return false;
  const wiggle = Math.max(0.03, 0.2 * q[peak]);
  for (const dir of [-1, 1]) {
    let low = q[peak];
    for (let i = peak + dir; i >= 0 && i < n; i += dir) {
      if (q[i] > low + wiggle) return false;
      low = Math.min(low, q[i]);
    }
  }
  return true;
}

/**
 * How far a ladder's odds are from a normal curve with the same center and spread (over the
 * outcome order): half the summed differences, 0 for a perfect bell and up to 1. Used to pick the
 * most bell-like ladder when none passes `bellShaped`.
 */
export function distanceFromNormal(p: number[]): number {
  const q = shares(p);
  const mean = q.reduce((s, x, i) => s + x * i, 0);
  const sd = Math.sqrt(Math.max(q.reduce((s, x, i) => s + x * (i - mean) ** 2, 0), 0.25));
  const pdf = q.map((_, i) => Math.exp(-0.5 * ((i - mean) / sd) ** 2));
  const g = shares(pdf);
  return 0.5 * q.reduce((s, x, i) => s + Math.abs(x - g[i]), 0);
}

/**
 * The preview's market: the nearest SOL price ladder at least a day out whose odds are bell-shaped,
 * however far out that is; else the nearest bell-shaped one settling sooner; else the SOL ladder
 * closest to a normal curve. Only with no SOL price ladder at all does it fall back to another one.
 */
export function pickFeatured(ms: MarketSummary[]): MarketSummary | undefined {
  const now = Date.now();
  const at = (m: MarketSummary) => new Date(m.expiry).getTime();
  const sol = ms.filter((m) => m.kind === "threshold" && m.ticker.startsWith("SOL") && at(m) > now + SOON_MS).sort((a, b) => at(a) - at(b));
  const bells = sol.filter((m) => bellShaped(m.marketProb));
  const pick =
    bells.find((m) => at(m) > now + DAY_MS) ??
    bells[0] ??
    [...sol].sort((a, b) => distanceFromNormal(a.marketProb) - distanceFromNormal(b.marketProb))[0];
  return pick ?? ms.find((m) => m.kind === "threshold" && bellShaped(m.marketProb)) ?? ms.find((m) => m.kind === "threshold");
}
