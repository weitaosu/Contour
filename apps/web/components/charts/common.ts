import { scaleBand, scaleLinear } from "d3-scale";

/** Chart colors as the theme's CSS variables, so every chart follows light and dark mode. */
export const COLORS = {
  violet: "var(--color-signal-violet)",
  ink: "var(--color-inkstone)",
  slate: "var(--color-slate)",
  smoke: "var(--color-smoke)",
  ash: "var(--color-ash)",
  mist: "var(--color-mist)",
  cloud: "var(--color-cloud)",
  /** The raised surface (white in light mode): marker centers, label backings. */
  white: "var(--color-porcelain)",
};

/** Shared horizontal layout so the probability and payout charts line up bucket for bucket. */
export const MARGIN = { left: 52, right: 12 };

export function bandScale(n: number, width: number, padding = 0) {
  return scaleBand<number>()
    .domain(Array.from({ length: n }, (_, i) => i))
    .range([MARGIN.left, Math.max(MARGIN.left + 1, width - MARGIN.right)])
    .paddingInner(padding)
    .paddingOuter(0);
}

export function niceMax(v: number) {
  return scaleLinear().domain([0, v]).nice(4).domain()[1];
}

/** Indices of cut labels to show so labels do not collide. */
export function tickStride(count: number, innerWidth: number, labelWidth: number) {
  const fit = Math.max(1, Math.floor(innerWidth / labelWidth));
  return Math.max(1, Math.ceil(count / fit));
}
