import { marketMoments, normalBelief, oddsBelief } from "./beliefs";
import { compile, type PositionShape } from "./compile";
import type { Ladder } from "./types";

/**
 * The four one-tap outlooks, as the forecast screen builds them. This mirrors OUTLOOKS in
 * apps/web/components/forecast/OutlookPicker.tsx and the belief built in ForecastScreen.tsx, so QC
 * checks exactly what a user sees. Keep the two in step (or have the web import these).
 */
export type OutlookKey = "higher" | "lower" | "near" | "move";

export const OUTLOOK_PRESETS: Record<OutlookKey, { title: string; x: number; w: number; split?: boolean }> = {
  higher: { title: "Higher", x: 0.8, w: 0.85 },
  lower: { title: "Lower", x: -0.8, w: 0.85 },
  near: { title: "Stays near", x: 0, w: 0.55 },
  move: { title: "Big move", x: 0, w: 0.7, split: true },
};
export const OUTLOOK_KEYS = Object.keys(OUTLOOK_PRESETS) as OutlookKey[];

/** How far each hump of a split ("big move") view sits from its center, in market standard deviations. */
export const OUTLOOK_SPLIT_OFFSET = 1.5;

/**
 * How strongly an outlook departs from the market, tried in this order when looking for a starting
 * point that trades (see outlookStart). 1 is the tile's own preset.
 */
export const OUTLOOK_STRENGTHS = [1, 1.5, 2, 3] as const;
/** The confidence levels the screen offers, tried before strengthening the view. */
export const START_CONFIDENCES = [0.5, 0.75, 1] as const;
/** The "How sure" slider's range (the bell's width as a multiple of the market's). */
export const MIN_WIDTH = 0.4;
export const MAX_WIDTH = 1.6;

/**
 * An outlook's bell at a given strength, in market standard deviations: Higher and Lower shift
 * further from the anchor; Stays near narrows; Big move pushes its two humps further apart (and
 * narrows them). Widths stay inside the slider's range.
 */
export function outlookParams(key: OutlookKey, strength = 1): { x: number; w: number; split: number | null } {
  const o = OUTLOOK_PRESETS[key];
  const width = (w: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
  if (key === "near") return { x: 0, w: width(o.w / strength), split: null };
  if (key === "move") return { x: 0, w: width(o.w / Math.sqrt(strength)), split: Math.min(3, OUTLOOK_SPLIT_OFFSET * strength) };
  return { x: o.x * strength, w: o.w, split: null };
}

/** The kind of position an outlook builds: Stays near only buys ranges (see PositionShape). */
export const outlookShape = (key: OutlookKey): PositionShape => (key === "near" ? "range" : "free");

/**
 * The (unblended) belief a picked outlook produces. `anchor` is what the outlook is relative to: the
 * live spot price on crypto ladders, otherwise the market's expected value (the screen's fallback).
 */
export function outlookBelief(ladder: Ladder, key: OutlookKey, anchor?: number | null, strength = 1): { belief: number[]; center: number; sd: number } {
  const { mean, sd } = marketMoments(ladder);
  const o = outlookParams(key, strength);
  const base = anchor ?? mean;
  const center = Math.min(mean + 2.5 * sd, Math.max(mean - 2.5 * sd, base + o.x * sd));
  if (o.split !== null) {
    const lo = normalBelief(ladder, center - o.split * sd, sd * o.w);
    const hi = normalBelief(ladder, center + o.split * sd, sd * o.w);
    return { belief: lo.map((p, j) => (p + hi[j]) / 2), center, sd };
  }
  return { belief: normalBelief(ladder, center, sd * o.w), center, sd };
}

/**
 * Where a tile should start so its position actually trades: the gentlest strength, and at it the
 * lowest confidence, that gives a position (not "too close to the market"). Null when nothing up to
 * the strongest view at 100% confidence trades.
 */
export function outlookStart(
  ladder: Ladder,
  key: OutlookKey,
  opts: { anchor?: number | null; stakeUsd?: number; maxIter?: number } = {},
): { strength: number; confidence: number } | null {
  for (const strength of OUTLOOK_STRENGTHS) {
    const { belief } = outlookBelief(ladder, key, opts.anchor, strength);
    for (const confidence of START_CONFIDENCES) {
      const q = compile({ ladder, belief, confidence, stakeUsd: opts.stakeUsd ?? 100, maxIter: opts.maxIter ?? 20_000, shape: outlookShape(key) });
      if (q.advice === "trade") return { strength, confidence };
    }
  }
  return null;
}

/**
 * Whether any one-tap view on this market trades: one of the four outlooks on a price ladder, or a
 * strong take ("much more" or "much less likely") on any named outcome at full confidence. A market
 * where none does is too close to its own prices to offer anything, and isn't listed.
 */
export function anyViewTrades(ladder: Ladder, opts: { anchor?: number | null; stakeUsd?: number; maxIter?: number } = {}): boolean {
  const maxIter = opts.maxIter ?? 6_000;
  if (ladder.cuts) return OUTLOOK_KEYS.some((k) => outlookStart(ladder, k, { ...opts, maxIter }) !== null);
  return ladder.marketProb.some((_, i) =>
    [3, 1 / 3].some(
      (ratio) => compile({ ladder, belief: moreLikelyBelief(ladder, i, ratio), confidence: 1, stakeUsd: opts.stakeUsd ?? 100, maxIter }).advice === "trade",
    ),
  );
}

/** Named-outcome markets: "More likely" (odds × 1.75) on one outcome, as the odds list does. */
export function moreLikelyBelief(ladder: Ladder, outcome: number, ratio = 1.75): number[] {
  return oddsBelief(
    ladder.marketProb,
    ladder.marketProb.map((_, i) => (i === outcome ? ratio : 1)),
  );
}
