import { scaleBand, scaleLinear } from "d3-scale";

export const COLORS = {
  violet: "#594ff4",
  ink: "#1f1f1f",
  slate: "#5d5d5d",
  smoke: "#888888",
  ash: "#b0b0b0",
  mist: "#e7e7e7",
  cloud: "#f6f6f6",
  white: "#ffffff",
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
