"use client";

import { useMemo, useState } from "react";
import { scaleLinear } from "d3-scale";
import { COLORS } from "@/components/charts/common";
import { GAIN } from "@/components/charts/ProfitChart";
import { useSize } from "@/components/charts/useSize";
import { Segmented } from "@/components/ui/Segmented";
import { usd } from "@/lib/format";
import type { PaperMark } from "@/lib/desk";

const DAY = 86_400_000;
/** The brokerage-standard ranges: a day, 5 days, a month, 6 months, a year, all time. */
const RANGES = [
  { value: "1D", label: "1D", ms: DAY, phrase: "past day" },
  { value: "5D", label: "5D", ms: 5 * DAY, phrase: "past 5 days" },
  { value: "1M", label: "1M", ms: 30 * DAY, phrase: "past month" },
  { value: "6M", label: "6M", ms: 182 * DAY, phrase: "past 6 months" },
  { value: "1Y", label: "1Y", ms: 365 * DAY, phrase: "past year" },
  { value: "ALL", label: "All", ms: Infinity, phrase: "all time" },
] as const;
export type Range = (typeof RANGES)[number]["value"];

const timeLabel = (at: number, span: number) =>
  span <= 86_400_000
    ? new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Value over time, like a brokerage's portfolio chart: one line, green when it's above where the range
 * started and grey when below, with a dashed line at the reference (cost basis or starting cash).
 * Scrubbing reports the point under the pointer so the page's big number can follow it.
 */
export function ValueChart({
  points,
  reference,
  referenceLabel,
  now,
  height = 200,
  onScrub,
  defaultRange = "ALL",
}: {
  points: PaperMark[];
  /** Drawn dashed: what the value is measured against. */
  reference: number;
  referenceLabel: string;
  /** The current value, appended as the last point so the line ends where the big number is. */
  now: number;
  height?: number;
  onScrub?: (p: PaperMark | null) => void;
  defaultRange?: Range;
}) {
  const { ref, width: measured } = useSize<HTMLDivElement>();
  const width = measured || 600;
  const [range, setRange] = useState<Range>(defaultRange);
  const [hover, setHover] = useState<number | null>(null);

  const all = useMemo(() => {
    const t = Date.now();
    const pts = [...points.filter((p) => p.at < t - 1000), { at: t, valueUsd: now }];
    return pts;
  }, [points, now]);
  // Every range is offered, as brokerages do; one longer than the history just shows all of it.
  const available = RANGES;
  const r = RANGES.find((x) => x.value === range)!;
  const cutoff = Number.isFinite(r.ms) ? Date.now() - r.ms : -Infinity;
  const pts = all.filter((p) => p.at >= cutoff);
  const series = pts.length >= 2 ? pts : [{ at: (pts[0]?.at ?? Date.now()) - 60_000, valueUsd: pts[0]?.valueUsd ?? now }, ...pts];

  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const t0 = series[0].at;
  const t1 = series[series.length - 1].at;
  const vals = series.map((p) => p.valueUsd).concat(reference);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < Math.max(0.5, Math.abs(hi) * 0.002)) {
    const mid = (hi + lo) / 2;
    const half = Math.max(0.5, Math.abs(mid) * 0.002);
    lo = mid - half;
    hi = mid + half;
  }
  const x = scaleLinear().domain([t0, t1 === t0 ? t0 + 1 : t1]).range([pad.l, width - pad.r]);
  const y = scaleLinear().domain([lo, hi]).range([height - pad.b, pad.t]).nice();
  const up = series[series.length - 1].valueUsd >= series[0].valueUsd - 1e-9;
  const stroke = up ? GAIN : COLORS.slate;
  const path = series.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.valueUsd).toFixed(1)}`).join(" ");
  const area = `${path} L${x(t1).toFixed(1)},${height - pad.b} L${x(t0).toFixed(1)},${height - pad.b} Z`;
  const hp = hover !== null ? series[hover] : null;
  // The change over the range (to the scrubbed point, if any), like the line under a brokerage's chart.
  const first = series[0].valueUsd;
  const endV = hp ? hp.valueUsd : series[series.length - 1].valueUsd;
  const delta = endV - first;
  const deltaPct = first > 0 ? delta / first : 0;
  const shortRange = Number.isFinite(r.ms) && series[0].at > Date.now() - r.ms + 60_000 && range !== "ALL";

  const pick = (px: number) => {
    let best = 0;
    for (let i = 1; i < series.length; i++) if (Math.abs(x(series[i].at) - px) < Math.abs(x(series[best].at) - px)) best = i;
    return best;
  };

  return (
    <div>
      <p className={`tnum mb-2 text-[14px] font-bold ${delta > 0.004 ? "text-gain" : delta < -0.004 ? "text-inkstone" : "text-slate"}`}>
        {delta > 0.004 ? "+" : delta < -0.004 ? "−" : ""}
        {usd(Math.abs(delta))} ({delta >= 0 ? "+" : "−"}
        {(Math.abs(deltaPct) * 100).toFixed(2)}%){" "}
        <span className="font-normal text-smoke">{hp ? `${r.phrase === "all time" ? "since the start" : r.phrase.replace("past", "over the")}, to that point` : shortRange ? `since ${timeLabel(series[0].at, t1 - t0)}` : r.phrase}</span>
      </p>
      <div ref={ref} className="relative w-full select-none" style={{ height }}>
        {measured > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Value over time: from ${usd(series[0].valueUsd)} to ${usd(series[series.length - 1].valueUsd)}`}
            style={{ touchAction: "pan-y" }}
            onPointerMove={(e) => {
              const i = pick(e.clientX - e.currentTarget.getBoundingClientRect().left);
              setHover(i);
              onScrub?.(series[i]);
            }}
            onPointerLeave={() => {
              setHover(null);
              onScrub?.(null);
            }}
          >
            <defs>
              <linearGradient id="value-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity={0.16} />
                <stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </linearGradient>
            </defs>
            <line x1={pad.l} x2={width - pad.r} y1={y(reference)} y2={y(reference)} stroke={COLORS.ash} strokeDasharray="3 4" />
            <text x={width - pad.r} y={y(reference) - 5} textAnchor="end" fontSize={11.5} fill={COLORS.smoke}>
              {referenceLabel} {usd(reference)}
            </text>
            <path d={area} fill="url(#value-fill)" />
            <path d={path} fill="none" stroke={stroke} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
            {hp ? (
              <g pointerEvents="none">
                <line x1={x(hp.at)} x2={x(hp.at)} y1={pad.t - 6} y2={height - pad.b} stroke={COLORS.ink} strokeOpacity={0.3} />
                <circle cx={x(hp.at)} cy={y(hp.valueUsd)} r={4.5} fill={COLORS.white} stroke={stroke} strokeWidth={2} />
                <text
                  x={Math.min(width - pad.r, Math.max(pad.l, x(hp.at)))}
                  y={height - 6}
                  textAnchor={x(hp.at) < 70 ? "start" : x(hp.at) > width - 70 ? "end" : "middle"}
                  fontSize={11.5}
                  fill={COLORS.slate}
                  className="tnum"
                >
                  {timeLabel(hp.at, t1 - t0)}
                </text>
              </g>
            ) : (
              <>
                <circle cx={x(t1)} cy={y(series[series.length - 1].valueUsd)} r={7} fill={stroke} className="pulse-ring" />
                <circle cx={x(t1)} cy={y(series[series.length - 1].valueUsd)} r={4} fill={stroke} stroke={COLORS.white} strokeWidth={1.5} />
                <text x={pad.l} y={height - 6} fontSize={11.5} fill={COLORS.smoke} className="tnum">
                  {timeLabel(t0, t1 - t0)}
                </text>
                <text x={width - pad.r} y={height - 6} textAnchor="end" fontSize={11.5} fill={COLORS.smoke}>
                  now
                </text>
              </>
            )}
          </svg>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Chart range" options={available.map((a) => ({ value: a.value, label: a.label }))} value={range} onChange={setRange} />
        {points.length < 2 && <span className="text-[13px] text-smoke">Fills in as prices update, a point a minute.</span>}
      </div>
    </div>
  );
}
