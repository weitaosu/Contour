"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { ArrowRight } from "lucide-react";
import type { MarketSummary } from "@/lib/desk";
import { pct, settleLabel, settleShort, untilLabel, usd } from "@/lib/format";
import { COLORS } from "./charts/common";
import { useSize } from "./charts/useSize";

const EASE = "cubic-bezier(.22,.61,.36,1)";

/**
 * Grey market curve with the violet example view over it. On hover the geometry never moves:
 * only emphasis changes (line weight, fill depth, a halo on the peak, a left-to-right brightening of the payout bars).
 */
function CardChart({ market, view, payouts, hovered, height = 92 }: { market: number[]; view: number[] | null; payouts: number[] | null; hovered: boolean; height?: number }) {
  const { ref, width } = useSize<HTMLDivElement>();
  const clipId = useId().replace(/:/g, "");
  const w = width || 300;
  const n = market.length;
  const max = Math.max(...market, ...(view ?? [])) * 1.08 || 1;
  const x = scaleLinear().domain([0, n - 1]).range([2, w - 2]);
  const y = scaleLinear().domain([0, max]).range([height - 2, 8]);
  const pts = (vals: number[]) => vals.map((p, j) => [x(j), y(p)] as [number, number]);
  const a = area<[number, number]>().x((d) => d[0]).y0(height).y1((d) => d[1]).curve(curveMonotoneX);
  const l = line<[number, number]>().x((d) => d[0]).y((d) => d[1]).curve(curveMonotoneX);
  const peak = view ? view.indexOf(Math.max(...view)) : -1;
  const maxPay = payouts ? Math.max(...payouts) : 1;
  // A new key on every hover re-mounts the animated layers, so the left-to-right draw replays.
  const play = hovered ? "play" : "rest";

  return (
    <div ref={ref} className="w-full" aria-hidden="true">
      {width > 0 && (
        <svg width={w} height={height + (payouts ? 30 : 0)} className="overflow-visible">
          <defs>
            <clipPath id={clipId}>
              <rect key={play} x={0} y={0} width={w} height={height} className={hovered ? "reveal-x" : ""} />
            </clipPath>
          </defs>
          <path d={a(pts(market)) ?? ""} fill={COLORS.mist} />
          {view && (
            <>
              <path
                d={a(pts(view)) ?? ""}
                fill={COLORS.violet}
                clipPath={`url(#${clipId})`}
                style={{ fillOpacity: hovered ? 0.17 : 0.08, transition: `fill-opacity 450ms ${EASE}` }}
              />
              <path
                key={`l-${play}`}
                d={l(pts(view)) ?? ""}
                pathLength={1}
                className={hovered ? "draw" : ""}
                fill="none"
                stroke={COLORS.violet}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ strokeWidth: hovered ? 2.75 : 1.75, transition: `stroke-width 350ms ${EASE}` }}
              />
            </>
          )}
          <path d={l(pts(market)) ?? ""} fill="none" stroke={COLORS.smoke} strokeWidth={1.25} strokeDasharray="4 4" />
          {peak >= 0 && view && (
            <g key={`p-${play}`} transform={`translate(${x(peak)}, ${y(view[peak])})`} className={hovered ? "fade-in" : ""} style={hovered ? { animationDelay: `${Math.round((peak / Math.max(1, n - 1)) * 800)}ms` } : undefined}>
              <circle r={11} fill={COLORS.violet} style={{ opacity: hovered ? 0.14 : 0, transition: `opacity 500ms ${EASE}` }} />
              <circle r={3.75} fill={COLORS.white} stroke={COLORS.violet} strokeWidth={2} />
            </g>
          )}
          {payouts && (
            <g transform={`translate(0, ${height + 8})`}>
              {payouts.map((p, j) => {
                const bw = (w - 4) / n;
                const profit = p > 100;
                const h = Math.max(3, Math.min(22, (p / maxPay) * 22));
                return (
                  <rect
                    key={`${j}-${play}`}
                    x={2 + j * bw + 1}
                    y={22 - h}
                    width={Math.max(1, bw - 2)}
                    height={h}
                    rx={2}
                    fill={profit ? COLORS.violet : COLORS.ash}
                    className={hovered ? "rise" : ""}
                    style={{
                      animationDelay: hovered ? `${120 + j * 35}ms` : undefined,
                      fillOpacity: profit ? (hovered ? 1 : 0.55) : 0.5,
                      transition: `fill-opacity 380ms ${EASE}`,
                    }}
                  />
                );
              })}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

function CategoricalBars({ m, hovered }: { m: MarketSummary; hovered: boolean }) {
  const focus = m.teaser?.focus;
  const rows = m.marketProb
    .map((p, j) => ({ p, label: m.bucketLabels[j] }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 4);
  const scaleMax = Math.max(...rows.map((r) => r.p), focus?.yourProb ?? 0) * 1.05;
  const w = (v: number) => `${(v / scaleMax) * 100}%`;
  return (
    <div className="flex flex-col gap-3 py-1">
      {rows.map((r) => {
        const isFocus = r.label === focus?.label;
        const add = isFocus && focus ? focus.yourProb - r.p : 0;
        return (
          <div
            key={r.label}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 text-[14px]"
            style={{ opacity: hovered && !isFocus ? 0.5 : 1, transition: `opacity 450ms ${EASE}` }}
          >
            <span className={`truncate ${isFocus ? "font-bold text-inkstone" : "text-inkstone"}`}>{r.label}</span>
            <span className="tnum flex items-baseline gap-1 font-bold text-inkstone">
              {pct(r.p)}
              {isFocus && focus && (
                <span className="text-signal-violet">
                  →{" "}
                  {/* counts up from the market's odds on hover; rests on the example odds */}
                  <CountUp from={r.p} to={focus.yourProb} play={hovered} />
                </span>
              )}
            </span>
            <span
              className="relative col-span-2 block overflow-hidden rounded-full bg-mist"
              style={{ height: isFocus && hovered ? 10 : 8, transition: `height 400ms ${EASE}` }}
            >
              <span className="absolute inset-y-0 left-0 rounded-full bg-ash" style={{ width: w(r.p) }} />
              {isFocus && add > 0 && (
                <span
                  key={hovered ? "grow" : "rest"}
                  className={`absolute inset-y-0 overflow-hidden rounded-r-full bg-signal-violet ${hovered ? "grow-x" : ""}`}
                  style={{
                    left: `calc(${w(r.p)} - 4px)`,
                    width: `calc(${w(add)} + 4px)`,
                    boxShadow: hovered ? "0 0 0 3px rgba(89,79,244,0.18)" : "0 0 0 0 rgba(89,79,244,0)",
                    transition: `box-shadow 450ms ${EASE}`,
                  }}
                >
                  {hovered && <span key="sheen" className="sheen absolute inset-y-0 left-0 w-1/3 bg-porcelain/45" />}
                </span>
              )}
            </span>
          </div>
        );
      })}
      {focus && (
        <span className="flex items-center gap-4 text-[12.5px] text-smoke">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-full bg-ash" /> Market odds
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-full bg-signal-violet" /> Extra odds in the example view
          </span>
        </span>
      )}
    </div>
  );
}

/** Shows `to`; when `play` turns on, eases from `from` up to `to`. */
function CountUp({ from, to, play }: { from: number; to: number; play: boolean }) {
  const [target, setTarget] = useState(to);
  const [start, setStart] = useState(to);
  useEffect(() => {
    if (!play) {
      setStart(to);
      setTarget(to);
      return;
    }
    setStart(from);
    const t = setTimeout(() => setTarget(to), 30);
    return () => clearTimeout(t);
  }, [play, from, to]);
  return <CountValue key={`${start}-${play}`} initial={start} target={target} />;
}

function CountValue({ initial, target }: { initial: number; target: number }) {
  const [v, setV] = useState(initial);
  useEffect(() => {
    if (initial === target) return setV(target);
    let raf = 0;
    const t0 = performance.now();
    const dur = 750;
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = 1 - Math.pow(1 - k, 3);
      setV(initial + (target - initial) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [initial, target]);
  return <span className="tnum">{pct(v)}</span>;
}

export function MarketCard({ m }: { m: MarketSummary }) {
  const [hovered, setHovered] = useState(false);
  const soon = new Date(m.expiry).getTime() - Date.now() < 24 * 3600_000;
  const t = m.teaser;
  const kind = m.kind === "threshold" ? `${m.strikeCount} strikes` : m.kind === "categorical" ? `${m.bucketCount} candidates` : `${m.bucketCount} ranges`;
  return (
    <Link
      href={`/m/${m.ticker}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className="card group flex flex-col gap-4 !p-6 transition-[transform,background-color] duration-500 ease-[cubic-bezier(.22,.61,.36,1)] hover:-translate-y-0.5 hover:bg-[#f3f2fe]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow truncate" title={settleLabel(m.expiry)}>Settles {settleShort(m.expiry)}</span>
        {m.sample ? (
          <span className="tag !border !border-dashed !border-ash !bg-transparent !py-0.5 !text-[13px] text-slate">Sample · made-up prices</span>
        ) : (
          <span className={`tag tnum !py-0.5 !text-[13px] ${soon ? "tag-active" : "tag-white"}`}>{untilLabel(m.expiry)}</span>
        )}
      </div>
      <div>
        <h3 className="card-title ease text-inkstone group-hover:text-signal-violet">{m.title}</h3>
        {m.readout.center ? (
          <p className="mt-1 text-[14px] text-slate">
            Market says <span className="tnum font-bold text-inkstone">{m.readout.center}</span> <span className="tnum">± {m.readout.spread}</span>
          </p>
        ) : m.readout.leader ? (
          <p className="mt-1 text-[14px] text-slate">
            Market favourite: <span className="font-bold text-inkstone">{m.readout.leader}</span> · <span className="tnum">{pct(m.readout.leaderProb ?? 0)}</span> chance
          </p>
        ) : null}
      </div>

      {m.kind === "categorical" ? (
        <CategoricalBars m={m} hovered={hovered} />
      ) : (
        <CardChart market={m.marketProb} view={t?.belief ?? null} payouts={t?.trade ? t.payouts : null} hovered={hovered} />
      )}

      {m.kind === "categorical" && t?.focus ? (
        <div className="rounded-2xl bg-porcelain px-4 py-3 text-[14px] leading-snug">
          <span className="text-slate">
            Think <b className="text-inkstone">{t.focus.label}</b> is underrated? Say{" "}
            <b className="tnum text-signal-violet">{pct(t.focus.yourProb)}</b> instead of <span className="tnum">{pct(t.focus.marketProb)}</span>:
          </span>
          <span className="mt-1 block text-inkstone">
            $100 pays <b className="tnum text-signal-violet">{usd(t.focus.paysIfWins, 0)}</b> if that happens, at least <b className="tnum">{usd(t.worst, 0)}</b> otherwise.
          </span>
        </div>
      ) : t?.trade ? (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-porcelain px-4 py-3">
          <div className="text-[14px] leading-tight">
            <span className="text-slate">Example view, $100</span>
            <span className="mt-0.5 block tnum font-bold text-inkstone">
              {usd(t.worst, 0)} – <span className="text-signal-violet">{usd(t.best, 0)}</span>
            </span>
          </div>
          <div className="text-right text-[14px] leading-tight">
            <span className="text-slate">profit if right</span>
            <span className="mt-0.5 block tnum font-bold text-signal-violet">{pct(t.probProfitYou)}</span>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-slate">
          {m.kind === "categorical" ? "Set a probability for each outcome and trade the whole field." : "Tight market: bring a sharper view to find an edge."}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="truncate whitespace-nowrap text-[13px] text-smoke tnum" title={`${m.quotedCount} quoted`}>
          {kind}
          {m.volume ? ` · $${m.volume >= 10_000 ? `${Math.round(m.volume / 1000)}k` : Math.round(m.volume).toLocaleString("en-US")} traded` : ""}
        </span>
        <span className="inline-flex max-w-0 shrink-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[14px] font-bold text-signal-violet opacity-0 transition-[max-width,opacity] duration-500 ease-[cubic-bezier(.22,.61,.36,1)] group-hover:max-w-[160px] group-hover:opacity-100 group-focus-visible:max-w-[160px] group-focus-visible:opacity-100">
          Shape your view <ArrowRight size={16} strokeWidth={2} />
        </span>
      </div>
    </Link>
  );
}
