"use client";

import { useMemo } from "react";
import { scaleLinear } from "d3-scale";
import { COLORS, MARGIN, niceMax } from "./common";
import { useSize } from "./useSize";

/**
 * Monte Carlo: `runs` simulated sequences of `bets` bets, each drawing an outcome from `probs` and
 * reinvesting `fraction` of the current bankroll at the position's return for that outcome. Draws
 * the median bankroll and the middle 80% band for Contour and the regular bet. Seeded, so the same
 * inputs always give the same picture.
 */

export interface MonteCarloResult {
  /** Per bet (0..bets): [10th, 50th, 90th] percentile bankroll. */
  contour: [number, number, number][];
  regular: [number, number, number][] | null;
  aheadContour: number;
  aheadRegular: number | null;
}

export function simulate(contourRet: number[], regularRet: number[] | null, probs: readonly number[], opts: { runs?: number; bets?: number; fraction?: number; seed?: number } = {}): MonteCarloResult {
  const runs = opts.runs ?? 3000;
  const bets = opts.bets ?? 20;
  const f = opts.fraction ?? 0.25;
  const total = probs.reduce((a, b) => a + b, 0) || 1;
  const cum: number[] = [];
  probs.reduce((a, p, j) => (cum[j] = a + p / total), 0);
  const one = (rets: number[]) => {
    let s = opts.seed ?? 12345;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const draw = () => {
      const u = rnd();
      let lo = 0;
      let hi = cum.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (cum[m] < u) lo = m + 1;
        else hi = m;
      }
      return lo;
    };
    const cols: Float64Array[] = Array.from({ length: bets + 1 }, () => new Float64Array(runs));
    for (let r = 0; r < runs; r++) {
      let b = 100;
      cols[0][r] = b;
      for (let k = 1; k <= bets; k++) {
        b *= 1 + f * rets[draw()];
        cols[k][r] = b;
      }
    }
    const bands = cols.map((c) => {
      const a = Array.from(c).sort((x, y) => x - y);
      return [a[Math.floor(runs * 0.1)], a[Math.floor(runs * 0.5)], a[Math.floor(runs * 0.9)]] as [number, number, number];
    });
    const ahead = cols[bets].reduce((a, v) => a + (v > 100 ? 1 : 0), 0) / runs;
    return { bands, ahead };
  };
  const c = one(contourRet);
  const r = regularRet ? one(regularRet) : null;
  return { contour: c.bands, regular: r?.bands ?? null, aheadContour: c.ahead, aheadRegular: r?.ahead ?? null };
}

export function MonteCarloChart({
  contourRet,
  regularRet,
  probs,
  fraction = 0.25,
  bets = 20,
  runs = 3000,
  height = 280,
}: {
  contourRet: number[];
  regularRet: number[] | null;
  probs: readonly number[];
  fraction?: number;
  bets?: number;
  runs?: number;
  height?: number;
}) {
  const { ref, width: measured } = useSize<HTMLDivElement>();
  const width = measured || 600;
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const top = 34;
  const bottom = 34;
  const sim = useMemo(() => simulate(contourRet, regularRet, probs, { runs, bets, fraction }), [contourRet.join(","), regularRet?.join(","), probs, runs, bets, fraction]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = [...sim.contour.flat(), ...(sim.regular?.flat() ?? [])];
  const hi = niceMax(Math.min(Math.max(...all), 400) * 1.05);
  const lo = Math.max(0, Math.min(...all) * 0.9);
  const x = scaleLinear().domain([0, bets]).range([left, right]);
  const y = scaleLinear().domain([lo, hi]).range([height - bottom, top]).clamp(true);
  const band = (b: [number, number, number][], col: string) => {
    const up = b.map((r, k) => `${x(k)},${y(r[2])}`);
    const dn = b.map((r, k) => `${x(k)},${y(r[0])}`).reverse();
    return (
      <g>
        <polygon points={[...up, ...dn].join(" ")} fill={col} opacity={0.14} />
        <polyline points={b.map((r, k) => `${x(k)},${y(r[1])}`).join(" ")} fill="none" stroke={col} strokeWidth={2.5} strokeLinejoin="round" />
      </g>
    );
  };
  const cEnd = sim.contour[bets][1];
  const rEnd = sim.regular ? sim.regular[bets][1] : null;
  const apart = rEnd === null || Math.abs(y(cEnd) - y(rEnd)) > 16;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {measured > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Monte Carlo: after ${bets} bets, Contour ahead in ${Math.round(sim.aheadContour * 100)}% of runs.`}>
          {y.ticks(5).map((t) => (
            <g key={t}>
              <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={t === 100 ? COLORS.slate : COLORS.mist} strokeDasharray={t === 100 ? "4 4" : undefined} />
              <text x={left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12.5} fill={COLORS.smoke} className="tnum">
                ${Math.round(t)}
              </text>
            </g>
          ))}
          {sim.regular && band(sim.regular, COLORS.slate)}
          {band(sim.contour, COLORS.violet)}
          <text x={left + 4} y={top - 12} fontSize={12.5} fontWeight={700} fill={COLORS.ink}>
            Ahead after {bets} bets: Contour {Math.round(sim.aheadContour * 100)}%{sim.aheadRegular !== null ? ` · regular bet ${Math.round(sim.aheadRegular * 100)}%` : ""}
          </text>
          <text x={right - 4} y={y(cEnd) - 8} textAnchor="end" fontSize={12.5} fontWeight={700} fill={COLORS.violet} stroke={COLORS.white} strokeWidth={4} paintOrder="stroke" className="tnum">
            Contour median ${Math.round(cEnd)}
          </text>
          {rEnd !== null && (
            <text x={right - 4} y={y(rEnd) + (apart ? 18 : 30)} textAnchor="end" fontSize={12.5} fontWeight={700} fill={COLORS.slate} stroke={COLORS.white} strokeWidth={4} paintOrder="stroke" className="tnum">
              Regular median ${Math.round(rEnd)}
            </text>
          )}
          {[0, 5, 10, 15, 20].filter((k) => k <= bets).map((k) => (
            <text key={k} x={x(k)} y={height - bottom + 18} textAnchor={k === 0 ? "start" : "middle"} fontSize={12.5} fill={COLORS.smoke}>
              {k === 0 ? "start ($100)" : `bet ${k}`}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}
