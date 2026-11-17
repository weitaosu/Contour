"use client";

import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { bandScale, COLORS, MARGIN, niceMax, tickStride } from "./common";
import { useSize } from "./useSize";
import { useTweenedArray } from "./useTween";

export interface ShapeDrag {
  /** Current center of the user's curve, in outcome units (for the handle). */
  center: number;
  onStart: () => void;
  /** dValue: horizontal move in outcome units; dyPx: vertical move in pixels (up = negative). */
  onMove: (dValue: number, dyPx: number) => void;
  onEnd: () => void;
}

export interface ProbabilityChartProps {
  bucketLabels: string[];
  cutLabels: string[]; // n-1 labels for ordered ladders; empty for categorical
  cuts?: number[] | null; // numeric cut points, enables value<->x mapping and curve dragging
  market: number[];
  you?: number[] | null;
  untraded?: { cut: number; reason: string }[];
  likely?: { from: number; to: number; label: string } | null;
  hover: number | null;
  onHover: (j: number | null) => void;
  editable?: boolean;
  onDraft?: (values: number[]) => void;
  onCommit?: (values: number[]) => void;
  drag?: ShapeDrag | null;
  tooltip?: (j: number) => ReactNode;
  height?: number;
  compact?: boolean;
}

export function ProbabilityChart(props: ProbabilityChartProps) {
  const { bucketLabels, cutLabels, hover, onHover, editable, height = 320, compact, drag } = props;
  const { ref, width: measured } = useSize<HTMLDivElement>();
  const width = measured || 600;
  const n = props.market.length;
  const market = useTweenedArray(props.market, 0.18);
  const youTarget = useMemo(() => props.you ?? null, [props.you]);
  const youTween = useTweenedArray(youTarget ?? props.market, 0.3);
  const [draft, setDraft] = useState<number[] | null>(null);
  const you = draft ?? (youTarget ? youTween : null);

  const top = compact ? 10 : props.likely ? 56 : 24;
  const bottom = compact ? 6 : 40;
  const x = useMemo(() => bandScale(n, width, editable ? 0.14 : 0), [n, width, editable]);
  const yMax = useMemo(() => niceMax(Math.max(0.05, ...props.market, ...(props.you ?? [])) * 1.12), [props.market, props.you]);
  const y = useMemo(() => scaleLinear().domain([0, yMax]).range([height - bottom, top]), [yMax, height, top, bottom]);
  const bw = x.bandwidth();
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const cx = (j: number) => (x(j) ?? 0) + bw / 2;

  // Outcome value <-> x for ordered ladders: cut j sits on the boundary after band j.
  const cuts = props.cuts && props.cuts.length === n - 1 ? props.cuts : null;
  const valueToX = useMemo(() => {
    if (!cuts || cuts.length < 2) return null;
    const step = x.step();
    const xs = cuts.map((_, j) => left + (j + 1) * step);
    const firstW = cuts[1] - cuts[0];
    const lastW = cuts[cuts.length - 1] - cuts[cuts.length - 2];
    const toX = (v: number) => {
      if (v <= cuts[0]) return xs[0] - ((cuts[0] - v) / firstW) * step;
      if (v >= cuts[cuts.length - 1]) return xs[xs.length - 1] + ((v - cuts[cuts.length - 1]) / lastW) * step;
      let j = 0;
      while (cuts[j + 1] < v) j++;
      return xs[j] + ((v - cuts[j]) / (cuts[j + 1] - cuts[j])) * step;
    };
    const toV = (px: number) => {
      if (px <= xs[0]) return cuts[0] - ((xs[0] - px) / step) * firstW;
      if (px >= xs[xs.length - 1]) return cuts[cuts.length - 1] + ((px - xs[xs.length - 1]) / step) * lastW;
      const j = Math.min(cuts.length - 2, Math.floor((px - xs[0]) / step));
      return cuts[j] + ((px - xs[j]) / step) * (cuts[j + 1] - cuts[j]);
    };
    return { toX, toV };
  }, [cuts, x, left]);

  // Smooth curves through bucket centers, extended flat to both edges.
  const pts = (vals: number[]): [number, number][] => [[left, vals[0]], ...vals.map((v, j) => [cx(j), v] as [number, number]), [right, vals[n - 1]]];
  const areaGen = area<[number, number]>()
    .x((d) => d[0])
    .y0(y(0))
    .y1((d) => y(d[1]))
    .curve(curveMonotoneX);
  const lineGen = line<[number, number]>()
    .x((d) => d[0])
    .y((d) => y(d[1]))
    .curve(curveMonotoneX);

  // Pointer handling: drag-to-reshape (curve mode), paint bars (edit mode), hover everywhere.
  const gesture = useRef<{ kind: "shape" | "paint"; x0: number; y0: number; v0: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const locate = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const j = Math.min(n - 1, Math.max(0, Math.floor((px - left) / x.step())));
    const v = Math.min(yMax, Math.max(0, y.invert(py)));
    return { px, py, j, v, inside: px >= left && px <= right };
  };

  const yTicks = y.ticks(3);
  const ordered = cutLabels.length === n - 1;
  const stride = ordered ? tickStride(cutLabels.length, right - left, 58) : tickStride(n, right - left, 92);
  const handle = drag && valueToX && you ? { hx: Math.min(right, Math.max(left, valueToX.toX(drag.center))), hy: y(Math.max(...you)) } : null;
  const hoverYou = hover !== null && you ? you[hover] : null;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {measured > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Probability by outcome: the market's curve in grey and your forecast in violet"
          className={editable ? "cursor-ns-resize touch-none" : drag ? (dragging ? "cursor-grabbing touch-none" : "cursor-grab touch-none") : "cursor-crosshair"}
          onPointerDown={(e) => {
            const p = locate(e);
            if (!p.inside) return;
            if (editable && you) {
              e.currentTarget.setPointerCapture(e.pointerId);
              gesture.current = { kind: "paint", x0: p.px, y0: p.py, v0: 0 };
              const next = [...you];
              next[p.j] = p.v;
              setDraft(next);
              props.onDraft?.(next);
            } else if (drag && valueToX) {
              e.currentTarget.setPointerCapture(e.pointerId);
              gesture.current = { kind: "shape", x0: p.px, y0: p.py, v0: valueToX.toV(p.px) };
              setDragging(true);
              drag.onStart();
            }
          }}
          onPointerMove={(e) => {
            const p = locate(e);
            const g = gesture.current;
            if (g?.kind === "paint" && draft) {
              const next = [...draft];
              next[p.j] = p.v;
              setDraft(next);
              props.onDraft?.(next);
            } else if (g?.kind === "shape" && drag && valueToX) {
              drag.onMove(valueToX.toV(p.px) - g.v0, p.py - g.y0);
            }
            onHover(p.inside ? p.j : null);
          }}
          onPointerUp={() => {
            const g = gesture.current;
            if (g?.kind === "paint" && draft) props.onCommit?.(draft);
            if (g?.kind === "shape") drag?.onEnd();
            gesture.current = null;
            setDragging(false);
            setDraft(null);
          }}
          onPointerLeave={() => !gesture.current && onHover(null)}
        >
          {/* grid */}
          {!compact &&
            yTicks.map((t) => (
              <g key={t}>
                <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={COLORS.mist} />
                <text x={left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={13} fill={COLORS.smoke} className="tnum">
                  {Math.round(t * 100)}%
                </text>
              </g>
            ))}

          {/* likely range: a bracket label above the curves */}
          {props.likely && !compact && (
            <g>
              <line x1={(x(props.likely.from) ?? 0) + 4} x2={(x(props.likely.to) ?? 0) + x.step() - 4} y1={32} y2={32} stroke={COLORS.ash} strokeWidth={1.5} strokeLinecap="round" />
              <text x={((x(props.likely.from) ?? 0) + (x(props.likely.to) ?? 0) + x.step()) / 2} y={22} textAnchor="middle" fontSize={13} fill={COLORS.slate}>
                {props.likely.label}
              </text>
            </g>
          )}

          {editable ? (
            <>
              {market.map((v, j) => (
                <g key={`m${j}`}>
                  <rect x={x(j)} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} rx={4} fill={COLORS.mist} />
                </g>
              ))}
              {you?.map((v, j) => (
                <g key={`y${j}`} className="ease" opacity={hover === null || hover === j ? 1 : 0.7}>
                  <rect x={(x(j) ?? 0) + bw * 0.22} y={y(v)} width={bw * 0.56} height={Math.max(0, y(0) - y(v))} rx={4} fill={COLORS.violet} fillOpacity={0.22} />
                  <rect x={(x(j) ?? 0) + bw / 2 - 11} y={y(v) - 6} width={22} height={12} rx={6} fill={COLORS.white} stroke={COLORS.violet} strokeWidth={2} />
                </g>
              ))}
            </>
          ) : (
            <>
              {/* market: soft grey area */}
              <path d={areaGen(pts(market)) ?? ""} fill={COLORS.mist} fillOpacity={0.9} />
              <path d={lineGen(pts(market)) ?? ""} fill="none" stroke={COLORS.smoke} strokeWidth={1.5} />
              {/* you: violet line over a light violet wash */}
              {you && (
                <>
                  <path d={areaGen(pts(you)) ?? ""} fill={COLORS.violet} fillOpacity={0.1} />
                  <path d={lineGen(pts(you)) ?? ""} fill="none" stroke={COLORS.violet} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}
            </>
          )}

          {/* crosshair */}
          {hover !== null && !compact && (
            <g pointerEvents="none">
              <line x1={cx(hover)} x2={cx(hover)} y1={top - 4} y2={y(0)} stroke={COLORS.ink} strokeOpacity={0.25} strokeWidth={1} strokeDasharray="3 3" />
              {!editable && <circle cx={cx(hover)} cy={y(market[hover])} r={4.5} fill={COLORS.white} stroke={COLORS.smoke} strokeWidth={2} />}
              {!editable && hoverYou !== null && <circle cx={cx(hover)} cy={y(hoverYou)} r={5.5} fill={COLORS.violet} stroke={COLORS.white} strokeWidth={2} />}
            </g>
          )}

          {/* reshape handle at the peak of your curve */}
          {handle && !compact && (
            <g pointerEvents="none">
              {!dragging && <circle cx={handle.hx} cy={handle.hy} r={9} fill={COLORS.violet} opacity={0.35} className="pulse-ring" />}
              <circle cx={handle.hx} cy={handle.hy} r={dragging ? 12 : 9} fill={COLORS.white} stroke={COLORS.violet} strokeWidth={3} />
              <circle cx={handle.hx} cy={handle.hy} r={3} fill={COLORS.violet} />
            </g>
          )}

          {/* untraded strikes */}
          {ordered &&
            !compact &&
            props.untraded?.map((u) => (
              <g key={u.cut}>
                <title>{`${cutLabels[u.cut]}: ${u.reason}, not traded`}</title>
                <circle cx={left + (u.cut + 1) * x.step()} cy={y(0)} r={4} fill={COLORS.white} stroke={COLORS.smoke} strokeWidth={1.5} />
              </g>
            ))}

          {/* x axis */}
          {!compact && (
            <g>
              <line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke={COLORS.ash} />
              {ordered
                ? cutLabels.map((l, i) =>
                    i % stride === 0 ? (
                      <text key={i} x={left + (i + 1) * x.step() - (editable ? (x.step() - bw) / 2 : 0)} y={height - bottom + 24} textAnchor="middle" fontSize={13} fill={hover !== null && (hover === i || hover === i + 1) ? COLORS.ink : COLORS.smoke} className="tnum">
                        {l}
                      </text>
                    ) : null,
                  )
                : bucketLabels.map((l, j) =>
                    j % stride === 0 ? (
                      <text key={j} x={cx(j)} y={height - bottom + 24} textAnchor="middle" fontSize={13} fill={hover === j ? COLORS.ink : COLORS.smoke}>
                        {l.length > 14 ? `${l.slice(0, 13)}…` : l}
                      </text>
                    ) : null,
                  )}
            </g>
          )}
        </svg>
      )}

      {/* drag hint */}
      {handle && !compact && !dragging && hover === null && (
        <div className="pointer-events-none absolute text-[13px] text-signal-violet fade-up" style={{ left: Math.min(handle.hx + 16, width - 170), top: Math.max(0, handle.hy - 34) }}>
          Drag to reshape ↔ ↕
        </div>
      )}

      {/* gliding tooltip */}
      {hover !== null && props.tooltip && measured > 0 && !gesture.current && (
        <div
          className="pointer-events-none absolute left-0 top-0 z-10 w-[220px] rounded-2xl border border-mist bg-porcelain/95 px-4 py-3 text-[14px] backdrop-blur-sm"
          style={{
            transform: `translate(${Math.min(Math.max(0, cx(hover) - 110), width - 220)}px, ${Math.max(0, y(Math.max(market[hover], hoverYou ?? 0)) - 128)}px)`,
            transition: "transform 140ms cubic-bezier(.2,.8,.2,1)",
          }}
        >
          {props.tooltip(hover)}
        </div>
      )}
    </div>
  );
}
