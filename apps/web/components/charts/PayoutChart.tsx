"use client";

import { scaleLinear } from "d3-scale";
import { useMemo } from "react";
import { bandScale, COLORS, MARGIN, niceMax } from "./common";
import { useSize } from "./useSize";
import { useStaggeredArray, useTweenedNumber } from "./useTween";

export interface PayoutChartProps {
  payouts: number[];
  stake: number;
  hover: number | null;
  onHover: (j: number | null) => void;
  outcome?: number | null;
  outcomeLabel?: string;
  height?: number;
  bucketLabels: string[];
  /** Payout per outcome of the single best contract for the same stake (drawn over the bars, grey). */
  compare?: number[] | null;
}

function topRounded(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export function PayoutChart({ payouts: target, stake, hover, onHover, outcome, outcomeLabel, height = 230, bucketLabels, compare }: PayoutChartProps) {
  const { ref, width: measured } = useSize<HTMLDivElement>();
  const width = measured || 600;
  // Bars move as a left-to-right wave whenever the payouts change.
  const payouts = useStaggeredArray(target, 520, Math.max(12, Math.min(40, 600 / Math.max(1, target.length))));
  const n = payouts.length;
  const compareTarget = useMemo(() => compare ?? target.map(() => 0), [compare, target]);
  const compareVals = useStaggeredArray(compareTarget, 520, Math.max(12, Math.min(40, 600 / Math.max(1, target.length))));
  const top = compare ? 44 : 34;
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
              <g key={j} style={{ opacity: dim ? 0.45 : 1, transition: "opacity 300ms cubic-bezier(.22,.61,.36,1)" }}>
                <title>{`${bucketLabels[j]}: pays $${target[j].toFixed(2)}`}</title>
                <path d={topRounded(x0, y(0) - h, bw, h, 4)} fill={profit ? COLORS.violet : COLORS.ash} className="rise" style={{ animationDelay: `${j * 30}ms` }} />
              </g>
            );
          })}
          {/* single-contract comparison, over the bars: narrow grey bars; off-scale bars are capped and labelled once */}
          {compare &&
            compareVals.map((c, j) => {
              if (c <= 0.5) return null;
              const x0 = (x(j) ?? 0) + bw * 0.3;
              const cw = Math.max(3, bw * 0.4);
              const yTop = c > yMax ? top : y(c);
              return (
                <g key={`c${j}`} pointerEvents="none">
                  <path d={topRounded(x0, yTop, cw, y(0) - yTop, 3)} fill={COLORS.smoke} fillOpacity={0.9} stroke={COLORS.white} strokeWidth={1.5} className="rise" style={{ animationDelay: `${250 + j * 30}ms` }} />
                  {c > yMax && <path d={`M${x0},${top + 6} L${x0 + cw / 2},${top - 2} L${x0 + cw},${top + 6}`} fill="none" stroke={COLORS.white} strokeWidth={1.5} />}
                </g>
              );
            })}
          {compare &&
            (() => {
              const idx = compare.map((c, j) => (c > yMax ? j : -1)).filter((j) => j >= 0);
              if (!idx.length) return null;
              const x0 = x(idx[0]) ?? 0;
              const x1 = (x(idx[idx.length - 1]) ?? 0) + bw;
              const v = compare[idx[0]];
              // Keep the label inside the plot: centre it over the run, but anchor to an edge if it would overflow.
              const mid = (x0 + x1) / 2;
              const half = 150;
              const anchor = mid + half > width - MARGIN.right ? "end" : mid - half < MARGIN.left ? "start" : "middle";
              const lx = anchor === "end" ? width - MARGIN.right : anchor === "start" ? MARGIN.left : mid;
              return (
                <text x={lx} y={top - 10} textAnchor={anchor} fontSize={12} fill={COLORS.slate} className="tnum" pointerEvents="none">
                  one contract pays ${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} here, $0 everywhere else
                </text>
              );
            })()}
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
            <g
              pointerEvents="none"
              style={{
                transform: `translate(${Math.min(width - MARGIN.right - (compare ? 92 : 34), Math.max(MARGIN.left + (compare ? 92 : 34), (x(hover) ?? 0) + bw / 2))}px, ${Math.max(top + 10, y(payouts[hover]) - 12)}px)`,
                transition: "transform 220ms cubic-bezier(.22,.61,.36,1)",
              }}
            >
              <rect x={compare ? -92 : -34} y={-18} width={compare ? 184 : 68} height={22} rx={11} fill={target[hover] > stake ? COLORS.violet : COLORS.ink} />
              <text y={-3} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={COLORS.white} className="tnum">
                {compare ? `Contour $${target[hover].toFixed(0)} · one $${compare[hover].toFixed(0)}` : `$${target[hover].toFixed(0)}`}
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
