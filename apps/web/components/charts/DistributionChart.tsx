"use client";

import { scaleLinear } from "d3-scale";
import { COLORS, MARGIN } from "./common";
import { useSize } from "./useSize";

/**
 * The chance of each result: profit on the x axis, chance on the y axis, Contour (violet) in front
 * of the regular bet (grey). Exact probabilities, binned so nearby results share a bar. A regular
 * bet's far-off win (a long shot) sits in its own slot past an axis break, labelled with its value.
 */

const money = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : `${Math.round(a)}`;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}$${s}`;
};

export function DistributionChart({
  contour,
  regular,
  probs,
  stake,
  height = 300,
}: {
  contour: number[];
  regular: number[] | null;
  probs: readonly number[];
  stake: number;
  height?: number;
}) {
  const { ref, width: measured } = useSize<HTMLDivElement>();
  const width = measured || 600;
  const left = MARGIN.left;
  const breakW = regular ? 56 : 0;
  const right = width - MARGIN.right - breakW;
  const top = 34;
  const bottom = 40;

  const cMax = Math.max(...contour);
  const cap = Math.max(cMax * 3, stake * 0.6, 1);
  const lo = Math.min(...contour, ...(regular ?? []), -stake * 0.05);
  const inRange = (v: number) => v <= cap;
  const hiD = Math.max(cMax, ...(regular ?? []).filter(inRange), stake * 0.1);
  const B = 32;
  const binW = (hiD - lo) / B || 1;
  const binOf = (v: number) => Math.min(B - 1, Math.max(0, Math.floor((v - lo) / binW)));
  const cBins = new Array(B).fill(0);
  const rBins = new Array(B).fill(0);
  let rFar = 0;
  let rFarV = 0;
  contour.forEach((v, j) => (cBins[binOf(v)] += probs[j]));
  regular?.forEach((v, j) => {
    if (inRange(v)) rBins[binOf(v)] += probs[j];
    else {
      rFar += probs[j];
      rFarV = Math.max(rFarV, v);
    }
  });
  const yMax = Math.max(...cBins, ...rBins, rFar, 0.05) * 1.15;
  const x = scaleLinear().domain([lo, hiD]).range([left, right]);
  const y = scaleLinear().domain([0, yMax]).range([height - bottom, top]);
  const bw = (right - left) / B;
  const binX = (b: number) => left + b * bw;
  const x0 = x(0);

  // Labels: the regular bet's two biggest results, and Contour's winning range.
  const label = (vals: number[] | null) => {
    if (!vals) return [];
    const by = new Map<number, number>();
    vals.forEach((v, j) => by.set(Math.round(v * 100) / 100, (by.get(Math.round(v * 100) / 100) ?? 0) + probs[j]));
    return [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  };
  const rTop = label(regular);
  const winRows = contour.map((v, j) => ({ v, p: probs[j] })).filter((r) => r.v > 0.005).sort((a, b) => a.v - b.v);
  const winP = winRows.reduce((a, r) => a + r.p, 0);
  const q = (u: number) => {
    let c = 0;
    for (const r of winRows) {
      c += r.p / (winP || 1);
      if (c >= u) return r.v;
    }
    return winRows.at(-1)?.v ?? 0;
  };
  const cPeak = cBins.indexOf(Math.max(...cBins));

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {measured > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Chance of each result. Contour wins ${Math.round(winP * 100)}% of the time.`}>
          <rect x={left} y={top - 20} width={Math.max(0, Math.min(right, x0) - left)} height={height - bottom - top + 20} fill="#e24b4a" opacity={0.06} />
          <rect x={Math.max(left, x0)} y={top - 20} width={Math.max(0, right + breakW - Math.max(left, x0))} height={height - bottom - top + 20} fill="#1aab8b" opacity={0.06} />
          <text x={left + 6} y={top - 6} fontSize={12} fontWeight={700} fill="#a32d2d">
            you lose
          </text>
          <text x={right + breakW - 6} y={top - 6} textAnchor="end" fontSize={12} fontWeight={700} fill="#0f6e56">
            you win
          </text>

          {y.ticks(4).map((t) => (
            <g key={t}>
              <line x1={left} x2={right + breakW} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.slate : COLORS.mist} />
              <text x={left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12.5} fill={COLORS.smoke} className="tnum">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          {x0 >= left && x0 <= right && <line x1={x0} x2={x0} y1={top - 20} y2={height - bottom} stroke={COLORS.slate} strokeWidth={1.25} />}

          {rBins.map((p, b) =>
            p > 0.0005 ? <rect key={`r${b}`} x={binX(b) + 1} y={y(p)} width={bw - 2} height={y(0) - y(p)} rx={2} fill={COLORS.smoke} opacity={0.75} /> : null,
          )}
          {cBins.map((p, b) =>
            p > 0.0005 ? <rect key={`c${b}`} x={binX(b) + bw * 0.22} y={y(p)} width={bw * 0.56} height={y(0) - y(p)} rx={2} fill={COLORS.violet} /> : null,
          )}

          {regular && rFar > 0 && (
            <g>
              <text x={right + 10} y={height - bottom + 4} fontSize={14} fill={COLORS.smoke}>
                //
              </text>
              <rect x={right + 22} y={y(rFar)} width={24} height={y(0) - y(rFar)} rx={2} fill={COLORS.smoke} opacity={0.75} />
              <text x={right + 34} y={height - bottom + 18} textAnchor="middle" fontSize={12} fill={COLORS.smoke} className="tnum">
                {money(rFarV)}
              </text>
            </g>
          )}

          {rTop.map(([v, p], i) => {
            const far = !inRange(v);
            const px = far ? right + 34 : binX(binOf(v)) + bw / 2;
            const py = y(p) - 8;
            return (
              <text
                key={i}
                x={Math.min(right + breakW - 2, Math.max(left + 2, px + (far ? 0 : 6)))}
                y={py}
                textAnchor={far ? "end" : px < left + 120 ? "start" : "middle"}
                fontSize={12}
                fontWeight={700}
                fill={COLORS.ink}
                stroke={COLORS.white}
                strokeWidth={4}
                paintOrder="stroke"
                className="tnum"
              >
                {Math.round(p * 100)}% chance: {v <= -stake * 0.99 ? `lose all ${money(stake).replace("+", "")}` : money(v)}
              </text>
            );
          })}
          {winP > 0 && (
            <text
              x={Math.min(right - 4, Math.max(left + 90, binX(cPeak) + bw / 2))}
              y={Math.max(top + 14, y(cBins[cPeak]) - 12)}
              textAnchor="middle"
              fontSize={12.5}
              fontWeight={700}
              fill={COLORS.violet}
              stroke={COLORS.white}
              strokeWidth={4}
              paintOrder="stroke"
              className="tnum"
            >
              Contour: {Math.round(winP * 100)}% chance to win, mostly {money(q(0.25))} to {money(q(0.75))}
            </text>
          )}

          {x.ticks(6).map((t) => (
            <text key={t} x={x(t)} y={height - bottom + 18} textAnchor="middle" fontSize={12.5} fill={COLORS.smoke} className="tnum">
              {money(t)}
            </text>
          ))}
          <text x={(left + right) / 2} y={height - 6} textAnchor="middle" fontSize={12} fill={COLORS.smoke}>
            profit or loss on {money(stake).replace("+", "")}
          </text>
        </svg>
      )}
    </div>
  );
}
