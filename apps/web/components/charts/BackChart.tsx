"use client";

import { scaleLinear } from "d3-scale";
import { COLORS, MARGIN, niceMax, tickStride } from "./common";
import { useSize } from "./useSize";
import { GAIN } from "./ProfitChart";

/**
 * Money you get back in each outcome, measured from $0, with a horizontal break-even line at the
 * stake. Bars above the line make money (green), bars below it lose some (grey), a bar at $0 loses it
 * all. An optional step line draws another bet (e.g. the single contract) on the same scale.
 */

const money = (v: number) => {
  const a = Math.abs(v);
  return `$${a >= 1000 ? `${(a / 1000).toFixed(a % 1000 === 0 ? 0 : 1)}k` : Math.round(a)}`;
};

/** Outcomes worth showing: wherever either bet changes, padded, at least `min` wide. */
function focusWindow(series: number[][], min = 9): [number, number] {
  const n = series[0].length;
  let a = Infinity;
  let b = -Infinity;
  for (const s of series)
    for (let j = 1; j < n; j++)
      if (Math.abs(s[j] - s[j - 1]) > 0.01) {
        a = Math.min(a, j - 1);
        b = Math.max(b, j);
      }
  if (!Number.isFinite(a)) return [0, n - 1];
  a = Math.max(0, a - 2);
  b = Math.min(n - 1, b + 2);
  while (b - a + 1 < min && (a > 0 || b < n - 1)) {
    if (a > 0) a--;
    if (b - a + 1 < min && b < n - 1) b++;
  }
  return [a, b];
}

export function BackChart({
  back,
  stake,
  compare,
  compareLabel,
  cutLabels,
  hover,
  onHover,
  marker,
  height = 300,
}: {
  back: number[];
  stake: number;
  compare?: number[] | null;
  compareLabel?: string;
  cutLabels: string[];
  hover: number | null;
  onHover: (j: number | null) => void;
  /** A marker on the x axis, in outcome units (bucket j spans [j, j+1)). */
  marker?: { at: number; label: string } | null;
  height?: number;
}) {
  const { ref, width: measured } = useSize<HTMLDivElement>();
  const width = measured || 600;
  const n = back.length;
  const [wa, wb] = focusWindow(compare ? [back, compare] : [back]);
  const top = 26;
  const bottom = 34;
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const step = (right - left) / (wb - wa + 1);
  const gap = step * 0.18;
  const bw = step - gap;
  const slotX = (j: number) => left + (j - wa) * step;
  const inWin = [...back.slice(wa, wb + 1), ...(compare ? compare.slice(wa, wb + 1) : []), stake];
  const hi = niceMax(Math.max(...inWin) * 1.06);
  const y = scaleLinear().domain([0, hi]).range([height - bottom, top]);
  const ticks = y.ticks(4);
  const stride = tickStride(wb - wa + 1, right - left, 52);
  const pick = (clientX: number, el: SVGSVGElement) => {
    const px = clientX - el.getBoundingClientRect().left;
    if (px < left || px > right) return null;
    return Math.min(wb, Math.max(wa, Math.floor((px - left) / step + wa)));
  };
  const mx = marker ? slotX(marker.at) : 0;
  const showMarker = !!marker && mx >= left && mx <= right;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {measured > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Money back per outcome for a $${stake} stake, from $0. Break-even at $${stake}.`}
          style={{ touchAction: "pan-y" }}
          onPointerMove={(e) => onHover(pick(e.clientX, e.currentTarget))}
          onPointerDown={(e) => onHover(pick(e.clientX, e.currentTarget))}
          onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.ink : COLORS.mist} strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12.5} fill={t === 0 ? COLORS.ink : COLORS.smoke} className="tnum">
                {money(t)}
              </text>
            </g>
          ))}

          {back.slice(wa, wb + 1).map((v, k) => {
            const j = wa + k;
            const x = slotX(j) + gap / 2;
            const h = Math.max(v > 0.005 ? 2 : 0, y(0) - y(v));
            const win = v > stake + 0.005;
            const on = hover === j;
            return (
              <rect
                key={j}
                x={x}
                y={y(0) - h}
                width={bw}
                height={h}
                rx={Math.min(4, bw / 3)}
                fill={win ? GAIN : on ? COLORS.slate : COLORS.ash}
                opacity={hover !== null && !on ? 0.45 : 1}
                style={{ transition: "y 300ms ease, height 300ms ease, opacity 200ms ease" }}
              />
            );
          })}

          {compare && (
            <path
              d={compare
                .slice(wa, wb + 1)
                .map((v, k) => `${k === 0 ? "M" : "L"}${slotX(wa + k)},${y(v)} L${slotX(wa + k + 1)},${y(v)}`)
                .join(" ")}
              fill="none"
              stroke={COLORS.ink}
              strokeWidth={2}
              strokeLinejoin="round"
              pointerEvents="none"
            >
              <title>{compareLabel}</title>
            </path>
          )}

          {/* break-even: you get your stake back */}
          <line x1={left} x2={right} y1={y(stake)} y2={y(stake)} stroke={COLORS.violet} strokeWidth={1.5} strokeDasharray="6 4" />
          <text x={right - 4} y={y(stake) - 6} textAnchor="end" fontSize={12} fontWeight={700} fill={COLORS.violet}>
            Break-even {money(stake)}
          </text>

          {cutLabels.map((l, i) =>
            i + 1 > wa && i + 1 <= wb && (i + 1 - wa) % stride === 0 ? (
              <text key={i} x={slotX(i + 1)} y={height - bottom + 20} textAnchor="middle" fontSize={12.5} fill={COLORS.smoke} className="tnum">
                {l}
              </text>
            ) : null,
          )}
          {wa > 0 && (
            <text x={left + 2} y={top - 10} fontSize={11.5} fill={COLORS.smoke}>
              ← same below {cutLabels[wa - 1]}
            </text>
          )}
          {wb < n - 1 && (
            <text x={right - 2} y={top - 10} textAnchor="end" fontSize={11.5} fill={COLORS.smoke}>
              same above {cutLabels[wb]} →
            </text>
          )}

          {showMarker && (
            <g pointerEvents="none">
              <line x1={mx} x2={mx} y1={top} y2={height - bottom} stroke={COLORS.violet} strokeWidth={1.5} />
              <rect x={mx - 52} y={height - bottom + 4} width={104} height={18} rx={9} fill={COLORS.violet} />
              <text x={mx} y={height - bottom + 17} textAnchor="middle" fontSize={12} fontWeight={700} fill={COLORS.white} className="tnum">
                {marker!.label}
              </text>
            </g>
          )}

          {hover !== null && (
            <line x1={slotX(hover) + step / 2} x2={slotX(hover) + step / 2} y1={top} y2={height - bottom} stroke={COLORS.ink} strokeOpacity={0.3} pointerEvents="none" />
          )}
        </svg>
      )}
    </div>
  );
}
