"use client";

import { scaleLinear } from "d3-scale";
import { useEffect, useId, useMemo, useRef } from "react";
import { runs } from "@/lib/outcomes";
import { COLORS, MARGIN, niceMax, tickStride } from "./common";
import { useSize } from "./useSize";
import { useMorph } from "./useTween";

/** How long the bars' left-to-right wave takes to cross the chart: on first sight, and on a change. */
const WAVE_IN = 360;
const WAVE = 180;

export const GAIN = "#1aab8b";
const GAIN_DEEP = "#12846a";

export interface ProfitChartProps {
  /** Profit (+) or loss (−) in USD per outcome, relative to the stake. */
  pl: number[];
  /** Per outcome: counts as a real win (past the win margin). Drawn green and grouped into profit zones. */
  wins: boolean[];
  stake: number;
  hover: number | null;
  onHover: (j: number | null) => void;
  cutLabels: string[];
  bucketLabels: string[];
  /** The market's likely range, drawn as a bracket under the axis. */
  likely?: { from: number; to: number } | null;
  height?: number;
  /** A settled outcome to ring and label (position page). */
  outcome?: number | null;
  outcomeLabel?: string;
  /** The ladder's cut values (ordered ladders): needed to place `now` between them. */
  cuts?: number[] | null;
  /** The underlying's live price: a marker that glides along the x axis as the price ticks. */
  now?: { value: number; label: string } | null;
  /** Draw the market's likely range as a bracket under the axis (it still sets the zoom either way). */
  likelyBracket?: boolean;
  /** The view is being dragged: bars glide together (no wave) so they keep up with the pointer. */
  live?: boolean;
  /** Other positions to compare against, drawn as step lines over the bars (profit per outcome, same units). */
  compare?: { pl: number[]; label: string; dashed?: boolean }[];
  /** Word before the marker's label (default "Now"). */
  nowPrefix?: string;
}

/**
 * Where a value falls on the outcome axis, in outcome units: outcome j spans [j, j+1). Between two
 * cuts it's linear; beyond the first or last cut it extends by the neighbouring cut spacing.
 */
function outcomePosition(v: number, cuts: number[]): number {
  const k = cuts.length;
  if (k === 0) return 0.5;
  if (k === 1) return v < cuts[0] ? 0.5 : 1.5;
  if (v < cuts[0]) return Math.max(0.12, 1 - (cuts[0] - v) / (cuts[1] - cuts[0]));
  if (v >= cuts[k - 1]) return Math.min(k + 0.88, k + (v - cuts[k - 1]) / (cuts[k - 1] - cuts[k - 2]));
  let j = 1;
  while (j < k && v >= cuts[j]) j++;
  return j + (v - cuts[j - 1]) / (cuts[j] - cuts[j - 1]);
}

/** Rough rendered width of a short SVG label, for keeping labels on one row apart. */
const textWidth = (s: string, px: number) => s.length * px * 0.56;

/** A bar from the zero line to `v`, rounded only at its far end. */
function bar(x: number, y0: number, y1: number, w: number, r: number) {
  const up = y1 < y0;
  const h = Math.abs(y1 - y0);
  const rr = Math.max(0, Math.min(r, w / 2, h));
  if (up)
    return `M${x},${y0} L${x},${y1 + rr} Q${x},${y1} ${x + rr},${y1} L${x + w - rr},${y1} Q${x + w},${y1} ${x + w},${y1 + rr} L${x + w},${y0} Z`;
  return `M${x},${y0} L${x},${y1 - rr} Q${x},${y1} ${x + rr},${y1} L${x + w - rr},${y1} Q${x + w},${y1} ${x + w},${y1 - rr} L${x + w},${y0} Z`;
}

const money = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(a % 1000 === 0 ? 0 : 1)}k` : `${Math.round(a)}`;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}$${s}`;
};

const MIN_WINDOW = 8;

/**
 * The outcomes worth showing: every place the profit changes (breakevens and steps) plus the
 * market's likely range, padded by one outcome and at least MIN_WINDOW wide. Outside this window the
 * profit or loss is flat by construction, so nothing is hidden, and the chart says so at the edges.
 */
function focusWindow(pl: number[], ordered: boolean, likely: { from: number; to: number } | null | undefined): [number, number] {
  const n = pl.length;
  if (!ordered || n <= MIN_WINDOW) return [0, n - 1];
  let a = Infinity;
  let b = -Infinity;
  for (let j = 1; j < n; j++) {
    if (Math.abs(pl[j] - pl[j - 1]) > 0.01) {
      a = Math.min(a, j - 1);
      b = Math.max(b, j);
    }
  }
  if (likely) {
    a = Math.min(a, likely.from);
    b = Math.max(b, likely.to);
  }
  if (!Number.isFinite(a)) return [0, n - 1];
  a = Math.max(0, a - 1);
  b = Math.min(n - 1, b + 1);
  while (b - a + 1 < MIN_WINDOW) {
    if (a > 0) a--;
    if (b - a + 1 < MIN_WINDOW && b < n - 1) b++;
    if (a === 0 && b === n - 1) break;
  }
  return [a, b];
}

export function ProfitChart({
  pl: target,
  wins,
  stake,
  hover,
  onHover,
  cutLabels,
  bucketLabels,
  likely,
  height = 280,
  outcome = null,
  outcomeLabel,
  cuts = null,
  now = null,
  likelyBracket = true,
  live = false,
  compare = [],
  nowPrefix = "Now",
}: ProfitChartProps) {
  const { ref, width: measured } = useSize<HTMLDivElement>();
  const width = measured || 600;
  const clipId = useId().replace(/:/g, "");
  const n = target.length;
  const ordered = cutLabels.length === n - 1;

  // Where to look and how tall: the focus window, and a y-range fitted to the outcomes inside it.
  // The window also takes in where any comparison line steps, so both shapes are in view.
  const [wa, wb] = useMemo(() => {
    let [a, b] = focusWindow(target, ordered, likely);
    for (const c of compare) {
      const [ca, cb] = focusWindow(c.pl, ordered, likely);
      a = Math.min(a, ca);
      b = Math.max(b, cb);
    }
    return [a, b];
  }, [target, ordered, likely, compare]);
  const inWindow = target.slice(wa, wb + 1);
  const compareInWindow = compare.flatMap((c) => c.pl.slice(wa, wb + 1));
  // One outcome paying far more than the rest (a cheap tail contract) would flatten every other bar.
  // Then the scale fits the others, and that bar is drawn cut, with its true value written by it.
  const gainsDesc = inWindow.filter((v) => v > 0).sort((a, b) => b - a);
  const capAt = gainsDesc.length >= 3 && gainsDesc[1] > stake * 0.02 && gainsDesc[0] > 3 * gainsDesc[1] ? gainsDesc[1] * 1.6 : null;
  const hiT = niceMax(Math.max(stake * 0.08, ...(capAt !== null ? [capAt] : inWindow), ...compareInWindow) * 1.04);
  const loT = -niceMax(Math.max(stake * 0.08, ...inWindow.map((v) => -v), ...compareInWindow.map((v) => -v)) * 1.04);

  // One timeline for everything that moves: bar heights, y-range and the zoom window glide together.
  // The bars move as a wave, left to right across the window: on first sight they grow out of the
  // $0 line (WAVE_IN), and when the view changes each one follows a beat after its neighbour
  // (WAVE). While the view is being dragged they glide together, so they keep up.
  const goal = useMemo(() => [...target, hiT, loT, wa, wb], [target, hiT, loT, wa, wb]);
  const entering = useRef(true);
  const waveMs = live ? 0 : entering.current ? WAVE_IN : WAVE;
  const along = (pos: number) => Math.min(1, Math.max(0, (pos - wa) / Math.max(1, wb - wa)));
  const m = useMorph(goal, 480, {
    from: useMemo(() => [...target.map(() => 0), hiT, loT, wa, wb], []), // eslint-disable-line react-hooks/exhaustive-deps
    delay: (i) => (i < n ? along(i) * waveMs : 0),
  });
  useEffect(() => {
    entering.current = false;
  }, []);
  const pl = m.slice(0, n);
  const [hi, lo, w0, w1] = [m[n], m[n + 1], m[n + 2], m[n + 3]];

  // The live price ticks every few seconds; its marker glides on its own, shorter timeline so the
  // bars (which only change when the position is re-solved) never move with it.
  const showNow = !!now && ordered && !!cuts && cuts.length === n - 1;
  // Empty when hidden, so the marker appears in place (a length change snaps) instead of sliding in.
  const nowGoal = showNow ? [outcomePosition(now!.value, cuts!)] : [];
  const nowU = useMorph(nowGoal, 700)[0] ?? 0;

  const top = 30;
  const bracket = !!likely && likelyBracket;
  const bottom = bracket ? 62 : 36;
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const step = (right - left) / Math.max(1, w1 - w0 + 1);
  const gap = step * 0.18;
  const bw = step - gap;
  const slotX = (j: number) => left + (j - w0) * step; // left edge of outcome j's slot = boundary between j-1 and j
  const barX = (j: number) => slotX(j) + gap / 2;
  const y = scaleLinear().domain([lo, hi]).range([height - bottom, top]);
  const y0 = y(0);
  const yBase = y(lo);
  const ticks = scaleLinear().domain([loT, hiT]).ticks(height - top - bottom < 150 ? 2 : 4);

  const zones = runs(wins, (w) => w);
  // Boundaries where the position crosses from losing to winning (or back): the breakevens.
  const breakevens = ordered ? wins.map((w, j) => (j > 0 && w !== wins[j - 1] ? j : -1)).filter((j) => j > 0) : [];
  // Zone edges and breakevens glide on the bars' spring while their count holds (as when a view is
  // dragged), so the shading slides with the bars instead of blinking from one spot to the next.
  // (On the render where the count changes, the spring still holds the old count: use the new edges.)
  const zoneGoal = zones.flatMap(([a, b]) => [a, b + 1]);
  const zoneMorph = useMorph(zoneGoal, 480, { delay: (i, g) => along(g[i]) * waveMs });
  const zoneEdges = zoneMorph.length === zoneGoal.length ? zoneMorph : zoneGoal;
  const beMorph = useMorph(breakevens, 480, { delay: (i, g) => along(g[i]) * waveMs });
  const beAt = beMorph.length === breakevens.length ? beMorph : breakevens;
  const stride = ordered ? tickStride(wb - wa + 1, right - left, 52) : tickStride(n, right - left, 92);
  const visible = (px: number) => px >= left - 1 && px <= right + 1;
  // Edge notes: beyond the window the result doesn't change. Their measured width keeps the
  // "Profit zone" labels on the same row clear of them.
  const HINT_PX = 11.5;
  const hintLeft = ordered && wa > 0 ? `← same below ${cutLabels[wa - 1]}` : null;
  const hintRight = ordered && wb < n - 1 ? `same above ${cutLabels[wb]} →` : null;
  const zoneHalf = textWidth("Profit zone", 12.5) / 2;
  // Cut bars (see capAt) get their true value in the top band, right over the bar; a "Profit zone"
  // label that would collide with one steps aside (the shading still marks the zone).
  const cutLabels2 = capAt === null ? [] : target.flatMap((v, j) => {
    if (!(v > hiT * 1.001) || j < wa || j > wb) return [];
    const text = money(v);
    const half = textWidth(text, 12) / 2 + 3;
    const cx = Math.min(right - half, Math.max(left + half, barX(j) + bw / 2));
    return [{ j, text, cx, span: [cx - half, cx + half] as [number, number] }];
  });
  const clearLeft = hintLeft ? left + 2 + textWidth(hintLeft, HINT_PX) + 10 + zoneHalf : -Infinity;
  const clearRight = hintRight ? right - 2 - textWidth(hintRight, HINT_PX) - 10 - zoneHalf : Infinity;

  // The "now" marker: x from the gliding position; if the price is outside the window, a pill at that edge.
  const nowX = showNow ? left + (nowU - w0) * step : 0;
  const nowSide: "in" | "left" | "right" = nowX < left ? "left" : nowX > right ? "right" : "in";
  const nowText = showNow ? (nowSide === "left" ? `← ${nowPrefix} ${now!.label}` : nowSide === "right" ? `${nowPrefix} ${now!.label} →` : `${nowPrefix} ${now!.label}`) : "";
  const pillW = textWidth(nowText, 12.5) + 18;
  const pillX = Math.min(right - pillW, Math.max(left, (nowSide === "in" ? nowX : nowSide === "left" ? left : right) - pillW / 2));

  const pick = (clientX: number, el: SVGSVGElement) => {
    const px = clientX - el.getBoundingClientRect().left;
    if (px < left || px > right) return null;
    return Math.min(wb, Math.max(wa, Math.floor((px - left) / step + w0)));
  };
  const describe = `Profit or loss per outcome for a $${stake} stake. Best ${money(Math.max(...target))}, worst ${money(Math.min(...target))}.`;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {measured > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={describe}
          tabIndex={0}
          className="rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-violet"
          // Horizontal swipes scrub; vertical swipes still scroll the page.
          style={{ touchAction: "pan-y" }}
          onPointerDown={(e) => {
            const j = pick(e.clientX, e.currentTarget);
            if (j !== null) onHover(j);
          }}
          onPointerMove={(e) => onHover(pick(e.clientX, e.currentTarget))}
          // A finger lifting off shouldn't erase the reading it just picked.
          onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") onHover(hover === null ? wa : Math.min(wb, hover + 1));
            else if (e.key === "ArrowLeft") onHover(hover === null ? wb : Math.max(wa, hover - 1));
            else if (e.key === "Escape") onHover(null);
            else return;
            e.preventDefault();
          }}
          onBlur={() => onHover(null)}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={left} y={0} width={Math.max(0, right - left)} height={height} />
            </clipPath>
          </defs>

          {/* y grid: values come from the target range, positions from the moving one, so lines slide */}
          {ticks.map((t) => (
            <g key={t} className="fade-in">
              {t !== 0 && <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={COLORS.mist} />}
              <text x={left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12.5} fill={t === 0 ? COLORS.ink : COLORS.smoke} fontWeight={t === 0 ? 700 : 500} className="tnum">
                {money(t)}
              </text>
            </g>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {/* profit zones */}
            {zones.map((_, i) => {
              const x0 = slotX(zoneEdges[2 * i] ?? 0);
              const x1 = slotX(zoneEdges[2 * i + 1] ?? 0);
              // Keep the label inside its zone and clear of the "same below/above" notes on the same row.
              const lo = Math.max(Math.max(left, x0) + zoneHalf + 4, clearLeft);
              const hi = Math.min(Math.min(right, x1) - zoneHalf - 4, clearRight);
              const cx = Math.min(hi, Math.max(lo, (Math.max(left, x0) + Math.min(right, x1)) / 2));
              // A zone that appears opens out from its middle as the wave of bars reaches it.
              const at = `${Math.round(along((zoneGoal[2 * i] + zoneGoal[2 * i + 1]) / 2) * waveMs)}ms`;
              return (
                <g key={`z${i}`}>
                  <rect x={x0} y={top - 22} width={Math.max(0, x1 - x0)} height={yBase - top + 22} rx={12} fill={GAIN} fillOpacity={0.07} className="zone-in" style={{ animationDelay: at }} />
                  {lo <= hi && !cutLabels2.some(({ span }) => cx - zoneHalf < span[1] && span[0] < cx + zoneHalf) && (
                    <text x={cx} y={top - 8} textAnchor="middle" fontSize={12} fontWeight={700} fill={GAIN_DEEP} className="text-swap" style={{ animationDelay: at }}>
                      Profit zone
                    </text>
                  )}
                </g>
              );
            })}

            {/* breakevens */}
            {breakevens.map((j, i) => (
              <line key={`b${i}`} className="fade-in" x1={slotX(beAt[i] ?? j)} x2={slotX(beAt[i] ?? j)} y1={top - 22} y2={yBase} stroke={COLORS.slate} strokeWidth={1.25} strokeDasharray="4 4" />
            ))}

            {/* bars */}
            {pl.map((v, j) => {
              const x0 = barX(j);
              if (x0 + bw < left - step || x0 > right + step) return null;
              const cut = v > hi * 1.001; // past the top of a broken scale
              const yv = cut ? top - 6 : y(v);
              const yy = Math.abs(yv - y0) < 2 ? (v >= 0 ? y0 - 2 : y0 + 2) : yv;
              const on = hover === j;
              const dim = hover !== null && !on;
              const fill = wins[j] ? (on ? GAIN_DEEP : GAIN) : on ? COLORS.slate : COLORS.ash;
              return (
                <g key={j} style={{ opacity: dim ? 0.4 : 1, transition: "opacity 260ms cubic-bezier(.22,.61,.36,1)" }}>
                  <path d={bar(x0, y0, yy, bw, Math.min(4, bw / 3))} fill={fill} style={{ transition: "fill 240ms ease" }} />
                  {cut && (
                    <>
                      {/* the break: two slanted cuts across the bar, then its real value beside it */}
                      <path d={`M${x0 - 1},${yy + 14} L${x0 + bw + 1},${yy + 9} M${x0 - 1},${yy + 19} L${x0 + bw + 1},${yy + 14}`} stroke={COLORS.white} strokeWidth={2} />

                    </>
                  )}
                </g>
              );
            })}

            {/* comparison positions: step lines across each outcome's slot */}
            {compare.map((c, k) => (
              <path
                key={`cmp${k}`}
                d={c.pl.map((v, j) => `${j === 0 ? "M" : "L"}${slotX(j)},${y(v)} L${slotX(j + 1)},${y(v)}`).join(" ")}
                fill="none"
                stroke={COLORS.ink}
                strokeOpacity={c.dashed ? 0.45 : 0.85}
                strokeWidth={2}
                strokeDasharray={c.dashed ? "6 4" : undefined}
                strokeLinejoin="round"
                pointerEvents="none"
                className="fade-in"
              >
                <title>{c.label}</title>
              </path>
            ))}

            {/* settled outcome */}
            {outcome !== null && outcome >= 0 && outcome < n && (
              <rect
                x={barX(outcome) - 4}
                y={Math.min(y0, y(pl[outcome])) - 4}
                width={bw + 8}
                height={Math.abs(y(pl[outcome]) - y0) + 8}
                rx={8}
                fill="none"
                stroke={COLORS.ink}
                strokeWidth={2}
                pointerEvents="none"
              />
            )}

            {/* scrubber */}
            {hover !== null && hover < n && (
              <g pointerEvents="none">
                <line x1={barX(hover) + bw / 2} x2={barX(hover) + bw / 2} y1={top - 22} y2={yBase} stroke={COLORS.ink} strokeWidth={1} strokeOpacity={0.35} />
                <circle cx={barX(hover) + bw / 2} cy={Math.max(top - 6, y(pl[hover]))} r={5} fill={COLORS.white} stroke={wins[hover] ? GAIN_DEEP : COLORS.ink} strokeWidth={2} />
              </g>
            )}
          </g>

          {/* zero line: you get your stake back */}
          <line x1={left} x2={right} y1={y0} y2={y0} stroke={COLORS.ink} strokeWidth={1.5} />

          {outcome !== null && outcome >= 0 && outcome < n && visible(barX(outcome) + bw / 2) && (
            <text
              x={Math.min(right - 4, Math.max(left + 4, barX(outcome) + bw / 2))}
              y={Math.max(top - 8, Math.min(y0, y(pl[outcome])) - 12)}
              textAnchor={barX(outcome) < left + 60 ? "start" : barX(outcome) > right - 60 ? "end" : "middle"}
              fontSize={13}
              fontWeight={700}
              fill={COLORS.ink}
              pointerEvents="none"
            >
              {outcomeLabel ?? "Settled"}
            </text>
          )}

          {/* x axis: labels follow the zoom; breakevens always get theirs */}
          {ordered
            ? (() => {
                // Breakevens get first claim on the axis, then the regular stride; a label is drawn
                // only where it clears the ones already placed (and the "Now" pill).
                const taken: [number, number][] = showNow ? [[pillX - 4, pillX + pillW + 4]] : [];
                const cands = cutLabels
                  .map((l, i) => ({ l, i, px: slotX(i + 1), isBe: breakevens.includes(i + 1) }))
                  .filter((c) => visible(c.px) && (c.isBe || (c.i + 1 - wa) % stride === 0))
                  .sort((a, b) => Number(b.isBe) - Number(a.isBe));
                const row2: [number, number][] = [];
                const hits = (list: [number, number][], sp: [number, number]) => list.some(([a, b]) => sp[0] < b && a < sp[1]);
                const placed: ((typeof cands)[number] & { row: number })[] = [];
                for (const c of cands) {
                  const half = textWidth(c.l, 12.5) / 2 + 4;
                  const span: [number, number] = [c.px - half, c.px + half];
                  if (!hits(taken, span)) {
                    taken.push(span);
                    placed.push({ ...c, row: 0 });
                  } else if (c.isBe && !bracket && !hits(row2, span)) {
                    // a breakeven never goes unlabelled: it drops to a second row
                    row2.push(span);
                    placed.push({ ...c, row: 1 });
                  }
                }
                return placed.map(({ l, i, px, isBe, row }) => {
                  const near = hover !== null && (hover === i || hover === i + 1);
                  return (
                    <text key={i} x={px} y={yBase + 20 + row * 14} textAnchor="middle" fontSize={12.5} fontWeight={isBe ? 700 : 500} fill={isBe || near ? COLORS.ink : COLORS.smoke} className="tnum fade-in">
                      {l}
                    </text>
                  );
                });
              })()
            : bucketLabels.map((l, j) =>
                j % stride === 0 ? (
                  <text key={j} x={barX(j) + bw / 2} y={yBase + 20} textAnchor="middle" fontSize={12.5} fill={hover === j ? COLORS.ink : COLORS.smoke}>
                    {l.length > 14 ? `${l.slice(0, 13)}…` : l}
                  </text>
                ) : null,
              )}

          {/* the true values of cut bars */}
          {cutLabels2.map(({ j, text, cx }) => (
            <text key={`cut${j}`} x={cx} y={top - 8} textAnchor="middle" fontSize={12} fontWeight={700} fill={GAIN_DEEP} className="tnum">
              {text}
            </text>
          ))}

          {/* edges: beyond the window the result doesn't change, and the chart says so */}
          {hintLeft && (
            <text x={left + 2} y={top - 8} fontSize={HINT_PX} fill={COLORS.smoke} className="fade-in">
              {hintLeft}
            </text>
          )}
          {hintRight && (
            <text x={right - 2} y={top - 8} textAnchor="end" fontSize={HINT_PX} fill={COLORS.smoke} className="fade-in">
              {hintRight}
            </text>
          )}

          {/* now: the live price, a violet line with a pulsing dot on the break-even line */}
          {showNow && (
            <g pointerEvents="none" aria-hidden="true">
              {nowSide === "in" && (
                <>
                  <line x1={nowX} x2={nowX} y1={top - 22} y2={yBase + 4} stroke={COLORS.violet} strokeWidth={1.5} />
                  <circle cx={nowX} cy={y0} r={7} fill={COLORS.violet} className="pulse-ring" />
                  <circle cx={nowX} cy={y0} r={4.5} fill={COLORS.violet} stroke={COLORS.white} strokeWidth={1.5} />
                </>
              )}
              <rect x={pillX} y={yBase + 4} width={pillW} height={18} rx={9} fill={COLORS.violet} />
              <text x={pillX + pillW / 2} y={yBase + 17} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={COLORS.white} className="tnum">
                {nowText}
              </text>
            </g>
          )}

          {/* market's likely range */}
          {bracket &&
            likely &&
            (() => {
              const x0 = Math.max(left, slotX(likely.from) + gap / 2);
              const x1 = Math.min(right, slotX(likely.to + 1) - gap / 2);
              if (x1 <= x0) return null;
              const yb = yBase + 30;
              const mid = Math.min(right - 70, Math.max(left + 70, (x0 + x1) / 2));
              return (
                <g>
                  <path d={`M${x0},${yb - 5} L${x0},${yb} L${x1},${yb} L${x1},${yb - 5}`} fill="none" stroke={COLORS.smoke} strokeWidth={1.25} />
                  <text x={mid} y={yb + 15} textAnchor="middle" fontSize={12} fill={COLORS.smoke}>
                    market&apos;s likely range
                  </text>
                </g>
              );
            })()}
        </svg>
      )}
    </div>
  );
}
