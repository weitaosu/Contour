"use client";

import { scaleLinear } from "d3-scale";
import { useMemo } from "react";
import { bandScale, COLORS, MARGIN, niceMax } from "./common";
import { useSize } from "./useSize";
import { useTweenedArray, useTweenedNumber } from "./useTween";

export interface PayoutChartProps {
  payouts: number[];
  stake: number;
  hover: number | null;
  onHover: (j: number | null) => void;
  outcome?: number | null;
  outcomeLabel?: string;
  height?: number;
  bucketLabels: string[];
}

function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export function PayoutChart({ payouts: target, stake, hover, onHover, outcome, outcomeLabel, height = 230, bucketLabels }: PayoutChartProps) {
  const { ref, width: measured } = useSize<HTMLDivElement>();
  const width = measured || 600;
  const payouts = useTweenedArray(target, 0.22);
  const n = payouts.length;
  const top = 34;
  const bottom = 16;
  const x = useMemo(() => bandScale(n, width, 0.2), [n, width]);
  const yMaxTarget = niceMax(Math.max(stake, ...target) * 1.12);
  const yMax = useTweenedNumber(yMaxTarget, 0.15);
  const y = scaleLinear().domain([0, yMax]).range([height - bottom, top]);
  const bw = x.bandwidth();
  const ticks = scaleLinear().domain([0, yMaxTarget]).ticks(3);
  const ys = y(stake);

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {measured > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Payout per outcome; stake line at $${stake}`}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - r.left;
            if (px < MARGIN.left || px > width - MARGIN.right) return onHover(null);
            onHover(Math.min(n - 1, Math.max(0, Math.floor((px - MARGIN.left) / x.step()))));
          }}
          onPointerLeave={() => onHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(t)} y2={y(t)} stroke={COLORS.mist} />
              <text x={MARGIN.left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={13} fill={COLORS.smoke} className="tnum">
                ${t >= 1000 ? `${t / 1000}k` : t}
              </text>
            </g>
          ))}
          {payouts.map((p, j) => {
            const profit = target[j] > stake + 1e-9;
            const x0 = x(j) ?? 0;
            const h = Math.max(2, y(0) - y(p));
            const dim = hover !== null && hover !== j;
            return (
              <g key={j} className="ease" opacity={dim ? 0.4 : 1}>
                <title>{`${bucketLabels[j]}: pays $${target[j].toFixed(2)}`}</title>
                <path d={topRounded(x0, y(0) - h, bw, h, 4)} fill={profit ? COLORS.violet : COLORS.ash} />
              </g>
            );
          })}
          {/* stake line */}
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={ys} y2={ys} stroke={COLORS.ink} strokeWidth={1.25} strokeDasharray="5 5" />
          <g transform={`translate(${width - MARGIN.right - 100}, ${ys - 26})`}>
            <rect width={100} height={20} rx={10} fill={COLORS.ink} />
            <text x={50} y={14} textAnchor="middle" fontSize={12.5} fill={COLORS.white} className="tnum">
              Stake ${stake.toLocaleString("en-US")}
            </text>
          </g>
          {/* hovered value */}
          {hover !== null && (
            <g pointerEvents="none" transform={`translate(${(x(hover) ?? 0) + bw / 2}, ${y(payouts[hover]) - 12})`}>
              <rect x={-34} y={-18} width={68} height={22} rx={11} fill={target[hover] > stake ? COLORS.violet : COLORS.ink} />
              <text y={-3} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={COLORS.white} className="tnum">
                ${target[hover].toFixed(0)}
              </text>
            </g>
          )}
          {outcome !== null && outcome !== undefined && outcome >= 0 && (
            <g>
              <rect x={(x(outcome) ?? 0) - 4} y={y(payouts[outcome]) - 4} width={bw + 8} height={y(0) - y(payouts[outcome]) + 4} rx={8} fill="none" stroke={COLORS.ink} strokeWidth={2} />
              <text x={(x(outcome) ?? 0) + bw / 2} y={y(payouts[outcome]) - 12} textAnchor="middle" fontSize={13} fontWeight={700} fill={COLORS.ink}>
                {outcomeLabel ?? "Settled"}
              </text>
            </g>
          )}
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} stroke={COLORS.ash} />
        </svg>
      )}
    </div>
  );
}
