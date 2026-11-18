import { formatValue, type Ladder } from "@contour/core";

/** An outcome counts as "making money" only past this share of the stake, so rounding-level gains never read as wins. */
export const WIN_MARGIN = 0.01;

export const isWin = (payout: number, stake: number) => payout > stake * (1 + WIN_MARGIN);

/** Contiguous runs [a, b] (inclusive) of bucket indexes where `test` holds. */
export function runs<T>(values: readonly T[], test: (v: T, j: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  values.forEach((v, j) => {
    if (!test(v, j)) return;
    const last = out[out.length - 1];
    if (last && last[1] === j - 1) last[1] = j;
    else out.push([j, j]);
  });
  return out;
}

/** Buckets a..b in words, for sentences: "between $72 and $77", "at $80 or higher", "below $67". */
export function rangePhrase(ladder: Ladder, a: number, b: number) {
  if (!ladder.cuts) return `if ${ladder.bucketLabels.slice(a, b + 1).join(" or ")} wins`;
  const fv = (v: number) => formatValue(v, ladder.unit);
  const lo = a === 0 ? null : fv(ladder.cuts[a - 1]);
  const hi = b === ladder.cuts.length ? null : fv(ladder.cuts[b]);
  if (lo && hi) return `between ${lo} and ${hi}`;
  if (lo) return `at ${lo} or higher`;
  if (hi) return `below ${hi}`;
  return "wherever it lands";
}

/** Buckets a..b in a few characters, for tiles: "$72–$77", "≥ $80", "< $67". */
export function rangeShort(ladder: Ladder, a: number, b: number) {
  if (!ladder.cuts) return ladder.bucketLabels.slice(a, b + 1).join(", ");
  const fv = (v: number) => formatValue(v, ladder.unit);
  const lo = a === 0 ? null : fv(ladder.cuts[a - 1]);
  const hi = b === ladder.cuts.length ? null : fv(ladder.cuts[b]);
  if (lo && hi) return `${lo}–${hi}`;
  if (lo) return `≥ ${lo}`;
  if (hi) return `< ${hi}`;
  return "Anywhere";
}

/**
 * When a set of outcome runs pays, as a clause: "if it lands below $67, or at $77 or higher" for
 * ordered ladders, "if Cut 25 bps or No change wins" for races.
 */
export function whenPhrase(ladder: Ladder, zones: [number, number][]) {
  if (ladder.cuts) return `if it lands ${zones.map(([a, b]) => rangePhrase(ladder, a, b)).join(", or ")}`;
  return `if ${zones.flatMap(([a, b]) => ladder.bucketLabels.slice(a, b + 1)).join(" or ")} wins`;
}

/** "If it lands between $72 and $73" / "If Newsom wins". */
export function ifItLands(ladder: Ladder, j: number) {
  const p = rangePhrase(ladder, j, j);
  return ladder.cuts ? `If it lands ${p}` : `I${p.slice(1)}`;
}
