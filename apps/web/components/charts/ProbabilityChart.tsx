"use client";

import { scaleLinear, type ScaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { bandScale, COLORS, MARGIN, niceMax, tickStride } from "./common";
import { useSize } from "./useSize";
import { useMorph } from "./useTween";

export interface ShapeDrag {
  /** Current center of the user's curve, in outcome units (for the handle). */
  center: number;
  onStart: () => void;
  /**
   * dValue: horizontal move since the drag began, in outcome units. peakRatio: how tall the curve's
   * peak should be relative to its height when the drag began (above 1 = taller and narrower), so
   * the peak rises and falls with the pointer.
   */
  onMove: (dValue: number, peakRatio: number) => void;
  onEnd: () => void;
  /** Shown beside the handle while dragging, e.g. "Likely $71.20 – $75.60". */
  readout?: string;
}

interface Gesture {
  kind: "shape" | "paint";
  /** Pointer position (client px) and chart position (svg px) when the gesture began. */
  cx0: number;
  cy0: number;
  px0: number;
  py0: number;
  v0: number;
  /** The y scale and the curve's peak when the drag began: the vertical gesture is read against these, not the live (animating) scale. */
  y: ScaleLinear<number, number>;
  peak0: number;
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
  const clipId = `pc${useId().replace(/:/g, "")}`;
  const n = props.market.length;
  // Both curves move on the charts' spring (the same one as the bars in "What you make"): on first
  // sight they rise out of the baseline together, left to right; after that they glide to new
  // shapes. While the curve is being dragged it follows the pointer exactly.
  const zeros = useMemo(() => props.market.map(() => 0), []); // eslint-disable-line react-hooks/exhaustive-deps
  const rise = useRef(true);
  const riseDelay = (i: number) => (rise.current ? (i / Math.max(1, n - 1)) * 260 : 0);
  const market = useMorph(props.market, 620, { from: zeros, delay: riseDelay });
  const youTarget = useMemo(() => props.you ?? null, [props.you]);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const youTween = useMorph(youTarget ?? props.market, 480, { from: zeros, delay: riseDelay, immediate: dragging });
  useEffect(() => {
    rise.current = false;
  }, []);
  const you = draft ?? (youTarget ? youTween : null);

  // The band above the plot holds the hover readout; on a narrow chart it can take two lines.
  const top = compact ? 10 : props.likely ? 46 : props.tooltip && width < 420 ? 46 : 24;
  const bottom = compact ? 6 : 34;
  const x = useMemo(() => bandScale(n, width, editable ? 0.14 : 0), [n, width, editable]);
  // The y range glides when the curve outgrows it, instead of snapping the whole chart to a new scale.
  const yMax = useMorph([niceMax(Math.max(0.05, ...props.market, ...(props.you ?? [])) * 1.12)], 620)[0];
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
  const gesture = useRef<Gesture | null>(null);
  // The latest pointer position, applied once per frame: pointers can report far more often than
  // the screen redraws, and every applied move re-solves the position.
  const pending = useRef<{ clientX: number; clientY: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // Where the chart sat on screen when the gesture began. Cards above it can change height as the
  // position updates; the page scrolls by the same amount so the chart never slides out from under
  // the pointer.
  const anchorTop = useRef<number | null>(null);
  const locate = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const j = Math.min(n - 1, Math.max(0, Math.floor((px - left) / x.step())));
    const v = Math.min(yMax, Math.max(0, y.invert(py)));
    return { px, py, j, v, inside: px >= left && px <= right };
  };
  const applyShape = () => {
    const g = gesture.current;
    const p = pending.current;
    const d = dragRef.current;
    if (!g || g.kind !== "shape" || !p || !d || !valueToX) return;
    pending.current = null;
    // Read from how far the pointer moved, not where the chart is now, so a layout shift mid-drag
    // can't jolt the curve.
    const px = g.px0 + (p.clientX - g.cx0);
    const py = g.py0 + (p.clientY - g.cy0);
    const target = g.peak0 + (g.y.invert(py) - g.y.invert(g.py0));
    d.onMove(valueToX.toV(px) - g.v0, Math.max(0.05 * g.peak0, target) / g.peak0);
  };
  const endGesture = () => {
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "shape") {
      applyShape(); // the last position always lands
      dragRef.current?.onEnd();
    }
    if (g.kind === "paint" && draft) props.onCommit?.(draft);
    gesture.current = null;
    pending.current = null;
    anchorTop.current = null;
    setDragging(false);
    setDraft(null);
  };
  // During a gesture: each frame, apply the latest pointer position and hold the chart in place.
  // rAF runs after React commits and before paint, so any shift is undone before it's ever seen.
  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    const tick = () => {
      if (pending.current) applyShape();
      const el = ref.current;
      if (el && anchorTop.current !== null) {
        const shift = el.getBoundingClientRect().top - anchorTop.current;
        if (Math.abs(shift) > 0.5) window.scrollBy(0, shift);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragging]); // eslint-disable-line react-hooks/exhaustive-deps

  // The curve's peak, for the handle and the vertical drag. The two end outcomes are open-ended
  // ("below $65", "above $84") and pile up a wide view's tails, so they don't count as its peak.
  const peakOf = (vals: readonly number[]) => Math.max(1e-4, ...(vals.length > 4 ? vals.slice(1, -1) : vals));

  const yTicks = y.ticks(3);
  const ordered = cutLabels.length === n - 1;
  const stride = ordered ? tickStride(cutLabels.length, right - left, 58) : tickStride(n, right - left, 92);
  // The handle glides with the curve when the view changes (it already rides the curve's height),
  // and sits exactly under the pointer while dragging.
  const hxTarget = drag && valueToX ? Math.min(right, Math.max(left, valueToX.toX(drag.center))) : 0;
  const hx = useMorph([hxTarget], 480, { immediate: dragging })[0];
  const handle = drag && valueToX && you ? { hx, hy: y(peakOf(you)) } : null;
  const hoverYou = hover !== null && you ? you[hover] : null;
  // The readout pill keeps showing the last outcome while it fades out, and is measured so it can be
  // centered on the crosshair without running off either edge.
  const lastHover = useRef(0);
  if (hover !== null) lastHover.current = hover;
  const tipAt = Math.min(n - 1, hover ?? lastHover.current);
  const tipOn = hover !== null && !gesture.current;
  const tipRef = useRef<HTMLDivElement>(null);
  const [tipW, setTipW] = useState(0);
  // Re-measured only when its text can change (another outcome, or the chart resized): measuring on
  // every render would force a layout pass each frame of a drag.
  useLayoutEffect(() => {
    const w = tipRef.current?.offsetWidth ?? 0;
    if (w !== tipW) setTipW(w);
  }, [tipAt, tipOn, width, measured]); // eslint-disable-line react-hooks/exhaustive-deps

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
            if (!p.inside || gesture.current) return;
            const start = { cx0: e.clientX, cy0: e.clientY, px0: p.px, py0: p.py, y, peak0: peakOf(youTarget ?? []) };
            if (editable && you) {
              e.currentTarget.setPointerCapture(e.pointerId);
              gesture.current = { kind: "paint", ...start, v0: 0 };
              const next = [...you];
              next[p.j] = p.v;
              setDraft(next);
              props.onDraft?.(next);
            } else if (drag && valueToX) {
              e.currentTarget.setPointerCapture(e.pointerId);
              gesture.current = { kind: "shape", ...start, v0: valueToX.toV(p.px) };
              // A clean picture while reshaping: no crosshair or tooltip chasing the pointer.
              onHover(null);
              drag.onStart();
            } else return;
            anchorTop.current = ref.current?.getBoundingClientRect().top ?? null;
            setDragging(true);
          }}
          onPointerMove={(e) => {
            const g = gesture.current;
            if (g?.kind === "shape") {
              pending.current = { clientX: e.clientX, clientY: e.clientY };
              return;
            }
            const p = locate(e);
            if (g?.kind === "paint" && draft) {
              const next = [...draft];
              next[p.j] = p.v;
              setDraft(next);
              props.onDraft?.(next);
            }
            onHover(p.inside ? p.j : null);
          }}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onLostPointerCapture={endGesture}
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
              <line x1={(x(props.likely.from) ?? 0) + 4} x2={(x(props.likely.to) ?? 0) + x.step() - 4} y1={26} y2={26} stroke={COLORS.ash} strokeWidth={1.5} strokeLinecap="round" />
              <text x={((x(props.likely.from) ?? 0) + (x(props.likely.to) ?? 0) + x.step()) / 2} y={17} textAnchor="middle" fontSize={12.5} fill={COLORS.slate}>
                {props.likely.label}
              </text>
            </g>
          )}

          {editable ? (
            <>
              {you?.map((v, j) => (
                <g key={`y${j}`} className="ease" opacity={hover === null || hover === j ? 1 : 0.75}>
                  <rect x={x(j)} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} rx={4} fill={COLORS.violet} fillOpacity={0.85} />
                </g>
              ))}
              {/* market, on top: narrow grey bar so you can see exactly where you differ */}
              {market.map((v, j) => (
                <g key={`m${j}`} pointerEvents="none">
                  <rect x={(x(j) ?? 0) + bw * 0.32} y={y(v)} width={bw * 0.36} height={Math.max(0, y(0) - y(v))} rx={3} fill={COLORS.smoke} stroke={COLORS.white} strokeWidth={1.5} />
                </g>
              ))}
              {you?.map((v, j) => (
                <rect key={`h${j}`} x={(x(j) ?? 0) + bw / 2 - 11} y={y(v) - 6} width={22} height={12} rx={6} fill={COLORS.white} stroke={COLORS.violet} strokeWidth={2} pointerEvents="none" />
              ))}
            </>
          ) : (
            <>
              {/* market: soft grey area underneath */}
              <path d={areaGen(pts(market)) ?? ""} fill={COLORS.mist} fillOpacity={0.9} />
              {/* you: violet wash and line, drawn in left to right when the chart appears */}
              {you && (
                <>
                  <defs>
                    <clipPath id={clipId}>
                      <rect x={0} y={0} width={width} height={height} className="reveal-x" />
                    </clipPath>
                  </defs>
                  <path d={areaGen(pts(you)) ?? ""} fill={COLORS.violet} fillOpacity={0.12} clipPath={`url(#${clipId})`} />
                  <path d={lineGen(pts(you)) ?? ""} pathLength={1} className="draw" fill="none" stroke={COLORS.violet} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                </>
              )}
              {/* market line drawn on top so the comparison is always visible */}
              <path d={lineGen(pts(market)) ?? ""} fill="none" stroke={COLORS.slate} strokeWidth={1.75} strokeDasharray="5 4" />
            </>
          )}

          {/* crosshair: glides between buckets instead of jumping */}
          {!compact && (
            <g
              pointerEvents="none"
              style={{
                transform: `translateX(${hover !== null ? cx(hover) : cx(0)}px)`,
                opacity: hover !== null ? 1 : 0,
                transition: "transform 220ms cubic-bezier(.22,.61,.36,1), opacity 200ms ease",
              }}
            >
              <line x1={0} x2={0} y1={Math.max(0, top - 6)} y2={y(0)} stroke={COLORS.ink} strokeOpacity={0.22} strokeWidth={1} strokeDasharray="3 3" />
              {!editable && hover !== null && (
                <circle cx={0} cy={y(market[hover])} r={4.5} fill={COLORS.white} stroke={COLORS.smoke} strokeWidth={2} style={{ transition: "cy 220ms cubic-bezier(.22,.61,.36,1)" }} />
              )}
              {!editable && hover !== null && hoverYou !== null && (
                <circle cx={0} cy={y(hoverYou)} r={5.5} fill={COLORS.violet} stroke={COLORS.white} strokeWidth={2} style={{ transition: "cy 220ms cubic-bezier(.22,.61,.36,1)" }} />
              )}
            </g>
          )}

          {/* reshape handle at the peak of your curve; while dragging, a guide down to the axis marks the center */}
          {handle && !compact && (
            <g pointerEvents="none">
              {dragging && <line x1={handle.hx} x2={handle.hx} y1={handle.hy} y2={y(0)} stroke={COLORS.violet} strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="3 4" />}
              {!dragging && <circle cx={handle.hx} cy={handle.hy} r={9} fill={COLORS.violet} opacity={0.35} className="pulse-ring" />}
              {dragging && <circle cx={handle.hx} cy={handle.hy} r={20} fill={COLORS.violet} fillOpacity={0.12} />}
              <circle cx={handle.hx} cy={handle.hy} r={dragging ? 11 : 9} fill={COLORS.white} stroke={COLORS.violet} strokeWidth={3} style={{ transition: "r 160ms cubic-bezier(.2,.8,.2,1)" }} />
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
                      <text key={i} x={left + (i + 1) * x.step() - (editable ? (x.step() - bw) / 2 : 0)} y={height - bottom + 21} textAnchor="middle" fontSize={12.5} fill={hover !== null && (hover === i || hover === i + 1) ? COLORS.ink : COLORS.smoke} className="tnum">
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

      {/* drag hint, and while dragging a live readout of the view riding above the handle */}
      {handle && !compact && !dragging && hover === null && (
        <div className="pointer-events-none absolute text-[13px] text-signal-violet fade-up" style={{ left: Math.min(handle.hx + 16, width - 170), top: Math.max(0, handle.hy - 34) }}>
          Drag to reshape ↔ ↕
        </div>
      )}
      {handle && !compact && dragging && drag?.readout && (
        <div
          className="tnum pointer-events-none absolute left-0 top-0 z-10 whitespace-nowrap rounded-full bg-signal-violet px-3 py-1 text-[13px] font-bold text-white shadow-md"
          style={{ transform: `translate(calc(${Math.min(Math.max(handle.hx, left + 90), right - 90)}px - 50%), ${Math.max(0, handle.hy - 46)}px)` }}
        >
          {drag.readout}
        </div>
      )}

      {/* Readout: a slim pill in the band above the plot, riding the crosshair, so it never covers the
          curves it describes. Always mounted (faded out when idle) so it glides instead of popping. */}
      {props.tooltip && measured > 0 && (
        <div
          ref={tipRef}
          aria-hidden={tipOn ? undefined : true}
          className="pointer-events-none absolute left-0 top-0 z-10 max-w-[calc(100%-8px)] rounded-[14px] border border-mist bg-porcelain/95 px-2.5 py-1 text-[12px] leading-[18px] sm:px-3 sm:text-[12.5px] shadow-[0_6px_18px_-8px_rgba(31,31,31,0.28)] backdrop-blur-sm"
          style={{
            transform: `translate(${Math.min(Math.max(4, cx(tipAt) - tipW / 2), width - tipW - 4)}px, 0px)`,
            opacity: tipOn ? 1 : 0,
            transition: "transform 200ms cubic-bezier(.22,.61,.36,1), opacity 160ms ease",
          }}
        >
          {props.tooltip(tipAt)}
        </div>
      )}
    </div>
  );
}
