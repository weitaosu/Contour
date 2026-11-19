"use client";

import { scaleLinear } from "d3-scale";
import { COLORS, MARGIN, niceMax } from "./common";
import { useSize } from "./useSize";
import { GAIN } from "./ProfitChart";

/**
 * Every outcome sorted from worst to best (x = share of outcomes, y = profit), for Contour (solid)
 * and the regular bet (dashed). Where Contour is above the regular bet the gap is shaded green
 * ("money you don't lose"); where it's below, grey ("upside you give up"). Each shaded area is its
 * average in dollars, since the x axis is probability.
 */

export const OUTCOMES = 100;

/** Profit at each of the 100 percentiles: buckets sorted by profit, then read off at (k + ½)%. */
export function sortedOutcomes(profit: readonly number[], probs: readonly number[]): number[] {
  const rows = profit.map((v, j) => ({ v, p: probs[j] })).filter((r) => r.p > 0).sort((a, b) => a.v - b.v);
  const total = rows.reduce((a, r) => a + r.p, 0) || 1;
  const out: number[] = [];
  let j = 0;
  let cum = rows[0]?.p / total || 0;
  for (let k = 0; k < OUTCOMES; k++) {
    const u = (k + 0.5) / OUTCOMES;
    while (u > cum && j < rows.length - 1) cum += rows[++j].p / total;
    out.push(rows[j]?.v ?? 0);
  }
  return out;
}

const money = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : `${Math.round(a)}`;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}$${s}`;
};

export function OutcomesChart({
  contour,
  regular,
  stake,
  hover,
  onHover,
  height = 320,
}: {
  contour: number[];
  regular: number[] | null;
  stake: number;
  hover: number | null;
  onHover: (k: number | null) => void;
  height?: number;
}) {
  const { ref, width: measured } = useSize<HTMLDivElement>();
  const width = measured || 640;
  const left = MARGIN.left;
  const right = width - MARGIN.right;
  const top = 34;
  const bottom = 40;
  const n = contour.length;
  const step = (right - left) / n;
  const xk = (k: number) => left + k * step;

  // A long-shot regular bet would flatten everything: past ~3x Contour's best its top is cut.
  const cMax = Math.max(...contour, 0);
  const cMin = Math.min(...contour, 0);
  const rMax = regular ? Math.max(...regular) : 0;
  const rMin = regular ? Math.min(...regular) : 0;
  const cap = Math.max(cMax * 3, stake * 0.6, 1);
  const hi = niceMax(Math.max(cMax, Math.min(rMax, cap)) * 1.08);
  const lo = -niceMax(Math.max(-cMin, -rMin, stake * 0.05) * 1.08);
  const cut = regular !== null && rMax > hi;
  const y = scaleLinear().domain([lo, hi]).range([height - bottom, top]);
  const yc = (v: number) => y(Math.min(v, hi));
  const y0 = y(0);

  const stepPath = (vals: number[]) => vals.map((v, k) => `${k ? "L" : "M"}${xk(k)},${yc(v)} L${xk(k + 1)},${yc(v)}`).join(" ");

  // Shaded gaps and their averages (each slice is 1% of outcomes).
  let saved = 0;
  let given = 0;
  let savedX = 0;
  let givenX = 0;
  if (regular)
    for (let k = 0; k < n; k++) {
      const d = contour[k] - regular[k];
      if (d > 0) {
        saved += d / n;
        savedX += k * d;
      } else if (d < 0) {
        given += -d / n;
        givenX += k * -d;
      }
    }
  const savedAt = saved > 0 ? savedX / (saved * n) : 0;
  const givenAt = given > 0 ? givenX / (given * n) : 0;

  const firstWin = (vals: number[]) => vals.findIndex((v) => v > 0.005);
  const cw = firstWin(contour);
  const rw = regular ? firstWin(regular) : -1;
  const pct = (k: number) => `${k}%`;

  const pick = (clientX: number, el: SVGSVGElement) => {
    const px = clientX - el.getBoundingClientRect().left;
    if (px < left || px > right) return null;
    return Math.min(n - 1, Math.max(0, Math.floor((px - left) / step)));
  };
  const clampX = (x: number, pad = 80) => Math.min(right - pad, Math.max(left + pad, x));

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {measured > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Outcomes sorted worst to best. Contour starts winning at ${cw < 0 ? 100 : cw}%${regular ? `, the regular bet at ${rw < 0 ? 100 : rw}%` : ""}.`}
          style={{ touchAction: "pan-y" }}
          onPointerMove={(e) => onHover(pick(e.clientX, e.currentTarget))}
          onPointerDown={(e) => onHover(pick(e.clientX, e.currentTarget))}
          onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
        >
          {y.ticks(5).map((t) => (
            <g key={t}>
              <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.slate : COLORS.mist} strokeWidth={t === 0 ? 1.25 : 1} />
              <text x={left - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12.5} fill={COLORS.smoke} className="tnum">
                {money(t)}
              </text>
            </g>
          ))}

          {/* shaded gaps */}
          {regular &&
            contour.map((c, k) => {
              const r = regular[k];
              if (Math.abs(c - r) < 0.005) return null;
              const a = yc(Math.max(c, r));
              const b = yc(Math.min(c, r));
              return <rect key={k} x={xk(k)} y={a} width={step + 0.5} height={Math.max(0, b - a)} fill={c > r ? GAIN : COLORS.ash} opacity={c > r ? 0.32 : 0.4} />;
            })}

          {/* off-the-chart wins of the regular bet: hatched, with their real size */}
          {cut &&
            regular &&
            (() => {
              const runs: [number, number][] = [];
              regular.forEach((v, k) => {
                if (v > hi) {
                  const last = runs[runs.length - 1];
                  if (last && last[1] === k - 1) last[1] = k;
                  else runs.push([k, k]);
                }
              });
              return runs.map(([a, b], i) => {
                const x0 = xk(a);
                const x1 = xk(b + 1);
                const mid = (x0 + x1) / 2;
                return (
                  <g key={`cut${i}`}>
                    <defs>
                      <pattern id={`oc-hatch${i}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <line x1="0" y1="0" x2="0" y2="6" stroke={COLORS.slate} strokeWidth="1.5" strokeOpacity="0.35" />
                      </pattern>
                    </defs>
                    <rect x={x0} y={top - 10} width={x1 - x0} height={10} fill={`url(#oc-hatch${i})`} />
                    <text x={mid > right - 140 ? x1 : mid} y={top - 16} textAnchor={mid > right - 140 ? "end" : "middle"} fontSize={12} fontWeight={700} fill={COLORS.slate} className="tnum">
                      ↑ really {money(Math.max(...regular.slice(a, b + 1)))} in {b - a + 1} of 100 (off the chart)
                    </text>
                  </g>
                );
              });
            })()}

          {regular && <path d={stepPath(regular)} fill="none" stroke={COLORS.slate} strokeWidth={2.5} strokeDasharray="7 5" strokeLinejoin="round" />}
          <path d={stepPath(contour)} fill="none" stroke={COLORS.violet} strokeWidth={2.5} strokeLinejoin="round" />

          {/* area labels */}
          {regular && saved > 0.5 && (
            <text x={clampX(xk(savedAt * n))} y={Math.min(height - bottom - 8, y(0) + 34)} textAnchor="middle" fontSize={12.5} fontWeight={700} fill="#0f6e56" stroke={COLORS.white} strokeWidth={4} paintOrder="stroke">
              money you don&apos;t lose ≈ {money(saved).replace("+", "")} on average
            </text>
          )}
          {regular && given > 0.5 && (
            <text x={clampX(xk(givenAt * n))} y={Math.max(top + 14, y(Math.min(hi, rMax)) + 28)} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={COLORS.slate} stroke={COLORS.white} strokeWidth={4} paintOrder="stroke">
              upside you give up ≈ {money(given).replace("+", "")} on average
            </text>
          )}

          {/* where each bet starts winning */}
          {cw >= 0 && (
            <g>
              <line x1={xk(cw)} x2={xk(cw)} y1={y0 - 7} y2={y0 + 7} stroke={COLORS.violet} strokeWidth={3} />
              <text x={clampX(xk(cw), 70)} y={y0 - 12} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={COLORS.violet} stroke={COLORS.white} strokeWidth={4} paintOrder="stroke">
                Contour starts winning ({pct(cw)})
              </text>
            </g>
          )}
          {regular && rw >= 0 && (
            <g>
              <line x1={xk(rw)} x2={xk(rw)} y1={y0 - 7} y2={y0 + 7} stroke={COLORS.slate} strokeWidth={3} />
              <text
                x={rw > 75 ? xk(rw) - 8 : xk(rw) + 8}
                y={y0 + 18}
                textAnchor={rw > 75 ? "end" : "start"}
                fontSize={12.5}
                fill={COLORS.slate}
                stroke={COLORS.white}
                strokeWidth={4}
                paintOrder="stroke"
              >
                regular starts winning ({pct(rw)})
              </text>
            </g>
          )}

          {[0, 25, 50, 75, 100].map((k) => (
            <text key={k} x={xk(k)} y={height - bottom + 18} textAnchor={k === 0 ? "start" : k === 100 ? "end" : "middle"} fontSize={12.5} fill={COLORS.smoke} className="tnum">
              {k}%
            </text>
          ))}
          <text x={left} y={height - 6} fontSize={12} fill={COLORS.smoke}>
            worst outcomes
          </text>
          <text x={(left + right) / 2} y={height - 6} textAnchor="middle" fontSize={12} fill={COLORS.smoke}>
            share of outcomes, sorted worst → best
          </text>
          <text x={right} y={height - 6} textAnchor="end" fontSize={12} fill={COLORS.smoke}>
            best outcomes
          </text>

          {hover !== null && <line x1={xk(hover) + step / 2} x2={xk(hover) + step / 2} y1={top} y2={height - bottom} stroke={COLORS.ink} strokeOpacity={0.3} pointerEvents="none" />}
        </svg>
      )}
    </div>
  );
}
