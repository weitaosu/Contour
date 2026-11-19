"use client";

import { useRef, useState } from "react";
import { ChevronDown, ChevronsDown, ChevronsUp, ChevronUp, Equal, RotateCcw, Shuffle, Trophy, type LucideIcon } from "lucide-react";
import { TAKE_STEPS, weightForChance } from "@contour/core";
import { pct, usd } from "@/lib/format";

const ICONS: Record<number, LucideIcon> = { [-2]: ChevronsDown, [-1]: ChevronDown, 0: Equal, 1: ChevronUp, 2: ChevronsUp };
/** Rows shown before "Show more": the favorites, plus any outcome you've given a take. */
const FIRST_ROWS = 8;

const levelOf = (w: number) => TAKE_STEPS.find((s) => Math.abs(s.ratio - w) < 1e-6 * s.ratio)?.level ?? null;

/** A round upper end for every row's bar, so bars compare across rows (10%, 20%, ... 100%). */
const scaleFor = (xs: number[]) => Math.min(1, Math.max(0.1, Math.ceil(Math.max(...xs) * 10 + 0.5) / 10));

/**
 * Your odds for a market with named outcomes (elections, nominations, Fed decisions), as a ranked
 * list. One tap per outcome says whether it's more or less likely than the market thinks; dragging
 * its bar sets an exact chance. Everything else rescales so the odds still add up to 100%.
 */
export function CandidateEditor({
  labels,
  market,
  weights,
  belief,
  payouts,
  stake,
  onChange,
  hover = null,
  onHover,
  bare = false,
}: {
  labels: string[];
  market: number[];
  /** Per-outcome odds multiplier against the market (1 = the market's odds). */
  weights: number[];
  belief: number[];
  payouts: number[];
  stake: number;
  onChange: (weights: number[]) => void;
  hover?: number | null;
  onHover?: (i: number | null) => void;
  /** Inside a workspace panel that already titles and frames it. */
  bare?: boolean;
}) {
  const order = market.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const [all, setAll] = useState(false);
  const changed = (i: number) => Math.abs(weights[i] - 1) > 1e-9;
  const rows = all ? order : order.filter((i, k) => k < FIRST_ROWS || changed(i));
  const hidden = order.length - rows.length;
  // The bar scale only changes between drags, never under a finger mid-drag.
  const liveScale = scaleFor([...market, ...belief]);
  const dragScale = useRef<number | null>(null);
  const scale = dragScale.current ?? liveScale;

  const fav = order[0];
  const setW = (i: number, w: number) => onChange(weights.map((x, j) => (j === i ? w : x)));
  const quick = [
    { key: "fav", label: "Favorite wins", icon: Trophy, title: `${labels[fav]} is more likely than the market thinks`, w: market.map((_, j) => (j === fav ? TAKE_STEPS[3].ratio : 1)) },
    { key: "upset", label: "An upset", icon: Shuffle, title: `${labels[fav]} is less likely than the market thinks`, w: market.map((_, j) => (j === fav ? TAKE_STEPS[1].ratio : 1)) },
    { key: "reset", label: "Same as market", icon: RotateCcw, title: "Back to the market's odds", w: market.map(() => 1) },
  ];
  const sameW = (a: number[]) => a.every((x, j) => Math.abs(x - weights[j]) < 1e-9);

  const setFromPointer = (i: number, el: HTMLElement, clientX: number) => {
    const r = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (dragScale.current ?? liveScale);
    setW(i, weightForChance(market, weights, i, p));
  };

  return (
    <section className={bare ? "" : "card"} aria-labelledby={bare ? undefined : "odds-title"} aria-label={bare ? "Your odds" : undefined}>
      {!bare && (
        <div>
          <p className="eyebrow">Step 1 · Your outlook</p>
          <h2 id="odds-title" className="card-title mt-1">
            Who do you think the market has wrong?
          </h2>
          <p className="mt-1 max-w-2xl text-[14px] text-slate">
            Exactly one wins. Tap whether each is more or less likely than the market says, or drag a bar to an exact chance. The rest adjust so it all adds up to 100%.
          </p>
        </div>
      )}

      <div className={bare ? "flex items-center justify-between gap-3" : "contents"}>
      <div className={`${bare ? "gap-1.5" : "mt-4 gap-2"} flex flex-wrap`} role="group" aria-label="Quick starts">
        {quick.map((q) => {
          const on = q.key !== "reset" && sameW(q.w);
          const Icon = q.icon;
          return (
            <button
              key={q.key}
              type="button"
              title={q.title}
              aria-pressed={q.key === "reset" ? undefined : on}
              onClick={() => onChange(q.w)}
              className={`ease inline-flex items-center rounded-full border font-bold ${bare ? "gap-1.5 px-3 py-1 text-[13px]" : "gap-2 px-4 py-2 text-[14px]"} ${
                on ? "border-signal-violet bg-signal-violet text-white" : "border-mist bg-porcelain text-inkstone hover:border-ash"
              }`}
            >
              <Icon size={bare ? 13 : 15} strokeWidth={2} aria-hidden="true" />
              {bare && q.key === "reset" ? "Reset" : q.label}
            </button>
          );
        })}
      </div>
      {bare && <span className="shrink-0 self-end text-[12.5px] text-smoke">Pays if it wins</span>}
      </div>

      {!bare && (
      <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[13px] text-slate">
        <span className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3 w-[2px] rounded-full bg-inkstone" /> Market
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-signal-violet" /> You
          </span>
        </span>
        <span className="text-smoke">Pays if it wins</span>
      </div>
      )}

      <ul className="mt-1">
        {rows.map((i) => {
          const level = levelOf(weights[i]);
          // Strong colors only for outcomes you took a view on; the rest just rescaled to make room.
          const mine = changed(i);
          const moved = Math.abs(belief[i] - market[i]) > 0.0005;
          const up = mine && belief[i] > market[i];
          const down = mine && belief[i] < market[i];
          const win = payouts[i] > stake + 0.005;
          const on = hover === i;
          return (
            <li
              key={i}
              onMouseEnter={() => onHover?.(i)}
              onMouseLeave={() => onHover?.(null)}
              className={`ease -mx-2 rounded-[14px] border-t border-mist px-2 first:border-t-0 ${bare ? "py-1" : "py-3"} ${on ? (bare ? "bg-cloud" : "bg-porcelain") : ""}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className={`min-w-0 truncate text-[15px] ${up ? "font-bold text-signal-violet" : down ? "text-slate" : "text-inkstone"}`} title={labels[i]}>
                  {labels[i]}
                </span>
                <span className="flex shrink-0 items-baseline gap-2 text-[14px]">
                  <span className="tnum text-smoke">{pct(market[i], market[i] < 0.1 ? 1 : 0)}</span>
                  {moved && (
                    <>
                      <span className="text-smoke" aria-hidden="true">
                        →
                      </span>
                      <span className={`tnum ${up ? "font-bold text-signal-violet" : down ? "font-bold text-inkstone" : "text-slate"}`}>{pct(belief[i], belief[i] < 0.1 ? 1 : 0)}</span>
                    </>
                  )}
                  <span className={`tnum w-[64px] text-right font-bold ${win ? "text-gain" : "text-inkstone"}`}>{usd(payouts[i], 0)}</span>
                </span>
              </div>
              <div className={`${bare ? "mt-1" : "mt-2"} flex items-center gap-3`}>
                {/* the bar: a dark tick at the market's odds, violet to yours; drag or use ← → to set it */}
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label={`${labels[i]}: your chance`}
                  aria-valuemin={0}
                  aria-valuemax={97}
                  aria-valuenow={Math.round(belief[i] * 1000) / 10}
                  aria-valuetext={`${pct(belief[i], 1)}, market ${pct(market[i], 1)}`}
                  className="group relative h-7 min-w-0 flex-1 cursor-ew-resize rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-violet"
                  style={{ touchAction: "pan-y" }}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    dragScale.current = liveScale;
                    setFromPointer(i, e.currentTarget, e.clientX);
                  }}
                  onPointerMove={(e) => {
                    if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(i, e.currentTarget, e.clientX);
                  }}
                  onPointerUp={() => (dragScale.current = null)}
                  onPointerCancel={() => (dragScale.current = null)}
                  onKeyDown={(e) => {
                    const d = (e.shiftKey ? 0.05 : 0.01) * (e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0);
                    if (!d) return;
                    e.preventDefault();
                    setW(i, weightForChance(market, weights, i, belief[i] + d));
                  }}
                >
                  <span className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full bg-mist">
                    <span className="absolute inset-y-0 left-0 rounded-full bg-ash" style={{ width: `${(market[i] / scale) * 100}%`, transition: "width 420ms cubic-bezier(.2,.8,.2,1)" }} />
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-signal-violet"
                      style={{ width: `${(belief[i] / scale) * 100}%`, opacity: mine ? 0.9 : 0.35, transition: "width 160ms cubic-bezier(.2,.8,.2,1), opacity 240ms ease" }}
                    />
                  </span>
                  <span
                    className="absolute top-1/2 h-4 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-inkstone"
                    style={{ left: `${(market[i] / scale) * 100}%`, transition: "left 420ms cubic-bezier(.2,.8,.2,1)" }}
                    aria-hidden="true"
                  />
                  <span
                    className="ease absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-signal-violet bg-porcelain opacity-0 shadow-sm group-hover:opacity-100 group-focus-visible:opacity-100"
                    style={{ left: `${(belief[i] / scale) * 100}%`, transition: "left 160ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease" }}
                    aria-hidden="true"
                  />
                </div>
                <div role="radiogroup" aria-label={`${labels[i]}: your take`} className="flex shrink-0 items-center gap-0.5 rounded-full bg-mist p-0.5">
                  {TAKE_STEPS.map((s) => {
                    const Icon = ICONS[s.level];
                    const active = level === s.level;
                    const tone = active ? (s.level > 0 ? "bg-signal-violet text-white" : s.level < 0 ? "bg-inkstone text-porcelain" : "bg-porcelain text-inkstone shadow-sm") : "text-slate hover:bg-porcelain hover:text-inkstone";
                    return (
                      <button
                        key={s.level}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={`${labels[i]}: ${s.label}`}
                        title={s.label}
                        onClick={() => setW(i, s.ratio)}
                        className={`ease flex h-7 w-7 items-center justify-center rounded-full ${tone} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-violet`}
                      >
                        <Icon size={15} strokeWidth={2.25} aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {(hidden > 0 || all) && (
        <button type="button" onClick={() => setAll((a) => !a)} className="ease mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[14px] font-bold text-signal-violet hover:bg-porcelain">
          <ChevronDown size={16} strokeWidth={2} className={`ease ${all ? "rotate-180" : ""}`} aria-hidden="true" />
          {all ? "Show fewer" : `Show ${hidden} more (${pct(order.filter((i) => !rows.includes(i)).reduce((s, i) => s + market[i], 0))} combined)`}
        </button>
      )}

      {bare ? (
        // In the workspace, the result panel already says when there's nothing to trade.
        <p
          className="mt-1.5 truncate text-[12.5px] leading-snug text-smoke"
          title="Exactly one outcome wins. Each arrow moves that outcome's odds 1.75× against the rest (3× for a double step), or drag its bar to an exact chance. Payouts are for your whole position."
        >
          <span className="mr-1 inline-block h-3 w-[2px] translate-y-[2px] rounded-full bg-inkstone" aria-hidden="true" />
          market
          <span className="ml-2 mr-1 inline-block h-2 w-3.5 rounded-full bg-signal-violet" aria-hidden="true" />
          you · each arrow moves its odds 1.75× vs the rest, or drag its bar
        </p>
      ) : belief.every((b, i) => Math.abs(b - market[i]) < 0.0005) ? (
        <p className="mt-4 rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-slate">
          Your odds match the market&apos;s, so there&apos;s nothing to trade yet. Tap ▲ on an outcome you believe in, or start with &quot;Favorite wins&quot; or &quot;An upset&quot;.
        </p>
      ) : (
        <p className="mt-4 text-[13px] text-smoke">
          Each step changes that outcome&apos;s odds against the rest by 1.75× (3× for a double step), so it works the same for favorites and longshots. Payouts are
          for your whole position, whoever wins.
        </p>
      )}
    </section>
  );
}
