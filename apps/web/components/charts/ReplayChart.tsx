"use client";

import { scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { COLORS } from "./common";
import { useSize } from "./useSize";

/** Two cumulative-return lines: Contour (violet) and the single best contract (ink). */
export function ReplayChart({ points, height = 280 }: { points: { contour: number; single: number }[]; height?: number }) {
  const { ref, width } = useSize<HTMLDivElement>();
  const m = { l: 56, r: 16, t: 16, b: 28 };
  const cum = points.reduce<{ c: number; s: number }[]>((acc, p) => {
    const last = acc[acc.length - 1] ?? { c: 0, s: 0 };
    acc.push({ c: last.c + p.contour, s: last.s + p.single });
    return acc;
  }, [{ c: 0, s: 0 }]);
  const vals = cum.flatMap((p) => [p.c, p.s]);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const w = width || 600;
  const x = scaleLinear().domain([0, Math.max(1, cum.length - 1)]).range([m.l, w - m.r]);
  const y = scaleLinear().domain([lo, hi === lo ? lo + 1 : hi]).nice(4).range([height - m.b, m.t]);
  const mk = (key: "c" | "s") => line<{ c: number; s: number }>().x((_, i) => x(i)).y((p) => y(p[key]))(cum) ?? "";
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {width > 0 && (
        <svg width={w} height={height} role="img" aria-label="Cumulative return per $1 staked, Contour versus a single contract">
          {y.ticks(4).map((t) => (
            <g key={t}>
              <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.ash : COLORS.mist} />
              <text x={m.l - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={13} fill={COLORS.smoke} className="tnum">
                {t > 0 ? "+" : ""}
                {t.toFixed(1)}
              </text>
            </g>
          ))}
          <path d={mk("s")} fill="none" stroke={COLORS.ink} strokeWidth={1.75} />
          <path d={mk("c")} fill="none" stroke={COLORS.violet} strokeWidth={2.5} />
          <text x={w - m.r} y={height - 6} textAnchor="end" fontSize={13} fill={COLORS.smoke}>
            settled ladders, in expiry order →
          </text>
        </svg>
      )}
    </div>
  );
}
