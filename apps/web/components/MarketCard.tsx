"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, ViewTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import { ArrowRight } from "lucide-react";
import { desk, type MarketSummary } from "@/lib/desk";
import { pct, settleLabel, untilLabel, usd } from "@/lib/format";
import { isWin, WIN_MARGIN } from "@/lib/outcomes";
import { COLORS } from "./charts/common";
import { useSize } from "./charts/useSize";

const EASE = "cubic-bezier(.22,.61,.36,1)";
/** Every card's example position is $100 (the desk's teaser). */
const STAKE_USD = 100;

/** True once the element has been at least partly on screen (it stays true). */
function useSeen(ref: React.RefObject<HTMLElement | null>) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") return setSeen(true);
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

/**
 * The app's damped spring (the physics behind --spring in globals.css: ζ 0.72, about 4% overshoot,
 * settled in about 620 ms), so the bars move exactly like the pills, panels and page transitions.
 */
const SPRING_W = 12; // rad/s
const SPRING_Z = 0.72;
/** When the curve's left-to-right draw (1 s, cubic-bezier(.22,.61,.36,1)) reaches fraction f of the width, in ms. */
function drawTime(f: number) {
  const bx = (t: number) => 3 * 0.22 * t * (1 - t) ** 2 + 3 * 0.36 * t * t * (1 - t) + t ** 3;
  const by = (t: number) => 3 * 0.61 * t * (1 - t) ** 2 + 3 * 1 * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const m = (lo + hi) / 2;
    if (by(m) < f) lo = m;
    else hi = m;
  }
  return 1000 * bx((lo + hi) / 2);
}
const reduceMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * The profit-or-loss bars, animated on the app's spring and written straight to the SVG every frame
 * (no React render mid-motion, so 60 cards stay smooth):
 * - they grow out of the break-even line, left to right, the first time the card comes on screen;
 * - on hover a ripple runs along them in step with the curve redrawing above, each bar lifting and
 *   settling back, so nothing disappears;
 * - when the prices refresh they morph from where they are to the new heights.
 * The best and worst labels ride on their bars' tops. Reduced motion: they just appear.
 */
function PayoutBars(props: {
  heights: number[];
  hiPL: number;
  loPL: number;
  best: number;
  worst: number;
  slot: number;
  gap: number;
  barW: number;
  w: number;
  x: (j: number) => number;
  zeroY: number;
  hovered: boolean;
  visible: boolean;
}) {
  const { heights, hiPL, loPL, best, worst, slot, gap, barW, w, x, zeroY, hovered, visible } = props;
  const n = heights.length;
  const bars = useRef<(SVGRectElement | null)[]>([]);
  const bestLabel = useRef<SVGTextElement | null>(null);
  const worstLabel = useRef<SVGTextElement | null>(null);
  const sim = useRef({ cur: [] as number[], vel: [] as number[], goal: [] as number[], startAt: [] as number[], kickAt: [] as number[], kick: [] as number[], raf: 0 });
  const geo = useRef({ zeroY, best, worst });
  geo.current = { zeroY, best, worst };

  const paint = useCallback(() => {
    const { cur, goal } = sim.current;
    const { zeroY: z, best: b, worst: wo } = geo.current;
    cur.forEach((h, j) => {
      const r = bars.current[j];
      if (!r) return;
      const a = Math.abs(h);
      if (a < 2) {
        // about break-even, or still growing out of the line: a small tick on it
        r.setAttribute("y", String(z - 1));
        r.setAttribute("height", "2");
        r.setAttribute("fill", COLORS.ash);
        r.setAttribute("opacity", "0.6");
      } else {
        r.setAttribute("y", String(h > 0 ? z - a : z));
        r.setAttribute("height", String(a));
        r.setAttribute("fill", h > 0 ? COLORS.violet : COLORS.ash);
        r.setAttribute("opacity", "1");
      }
    });
    const label = (el: SVGTextElement | null, j: number, up: boolean) => {
      if (!el || j < 0 || !goal[j]) return;
      const a = Math.abs(cur[j] ?? 0);
      el.setAttribute("y", String(up ? z - a - 3 : z + a + 10));
      el.setAttribute("opacity", String(Math.max(0, Math.min(1, (a / Math.abs(goal[j]) - 0.35) / 0.5))));
    };
    label(bestLabel.current, b, true);
    label(worstLabel.current, wo, false);
  }, []);

  const run = useCallback(() => {
    const st = sim.current;
    if (st.raf) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.064, Math.max(0, (now - last) / 1000));
      last = now;
      let moving = false;
      for (let j = 0; j < st.cur.length; j++) {
        if (st.kickAt[j] && now >= st.kickAt[j]) {
          st.vel[j] += st.kick[j];
          st.kickAt[j] = 0;
        }
        if (now < st.startAt[j]) {
          moving = true;
          continue;
        }
        // semi-implicit Euler in 4 ms substeps: stable and exact enough for a 620 ms spring
        const subs = Math.max(1, Math.ceil(dt / 0.004));
        const h = dt / subs;
        for (let k = 0; k < subs; k++) {
          const acc = -SPRING_W * SPRING_W * (st.cur[j] - st.goal[j]) - 2 * SPRING_Z * SPRING_W * st.vel[j];
          st.vel[j] += acc * h;
          st.cur[j] += st.vel[j] * h;
        }
        if (Math.abs(st.cur[j] - st.goal[j]) > 0.05 || Math.abs(st.vel[j]) > 0.5 || st.kickAt[j]) moving = true;
        else {
          st.cur[j] = st.goal[j];
          st.vel[j] = 0;
        }
      }
      paint();
      st.raf = moving ? requestAnimationFrame(step) : 0;
    };
    st.raf = requestAnimationFrame(step);
  }, [paint]);

  useEffect(() => () => cancelAnimationFrame(sim.current.raf), []);

  // New heights (first sight, or a price refresh): a left-to-right wave from wherever the bars are.
  const sig = heights.map((h) => h.toFixed(2)).join(",");
  useLayoutEffect(() => {
    const st = sim.current;
    if (st.cur.length !== n) {
      st.cur = heights.map(() => 0);
      st.vel = heights.map(() => 0);
      st.kickAt = heights.map(() => 0);
      st.kick = heights.map(() => 0);
      st.startAt = heights.map(() => 0);
    }
    if (!visible) {
      st.goal = heights.map(() => 0);
      paint();
      return;
    }
    st.goal = [...heights];
    if (reduceMotion()) {
      st.cur = [...heights];
      st.vel = heights.map(() => 0);
      paint();
      return;
    }
    const now = performance.now();
    st.startAt = heights.map((_, j) => now + (j / Math.max(1, n - 1)) * 320);
    paint();
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, n, visible, run, paint]);

  // Hover: a ripple along the bars in step with the curve drawing above. Each bar gets a nudge
  // outwards (up for a gain, down for a loss) and the spring brings it back: one lift, one settle.
  useEffect(() => {
    if (!hovered || !visible || reduceMotion()) return;
    const st = sim.current;
    const now = performance.now();
    for (let j = 0; j < n; j++) {
      const g = st.goal[j] ?? 0;
      if (Math.abs(g) < 2) continue;
      // peak lift ≈ 0.45·v/ω for this spring: about 16% of the bar, at least 2 px
      const lift = Math.max(2, Math.abs(g) * 0.16);
      st.kick[j] = Math.sign(g) * ((lift * SPRING_W) / 0.451);
      st.kickAt[j] = now + drawTime((j + 0.5) / n);
    }
    run();
  }, [hovered, visible, n, run]);

  // re-place after a resize or a hover re-render (React doesn't own y / height / fill)
  useLayoutEffect(() => paint());

  return (
    <>
      {/* break-even: $100 back */}
      <line x1={2} x2={w - 2} y1={zeroY} y2={zeroY} stroke={COLORS.ash} strokeWidth={1} />
      {heights.map((_, j) => (
        <rect
          key={j}
          ref={(el) => {
            bars.current[j] = el;
          }}
          x={2 + j * slot + gap / 2}
          width={barW}
          rx={Math.min(2, barW / 3)}
          style={{ fillOpacity: hovered ? 1 : 0.82, transition: `fill-opacity 380ms ${EASE}` }}
        />
      ))}
      {/* the best and the worst, in dollars, riding on their bars */}
      {best >= 0 && hiPL > STAKE_USD * WIN_MARGIN && (
        <text ref={bestLabel} x={Math.min(w - 18, Math.max(18, x(best)))} textAnchor="middle" fontSize={11} fontWeight={700} fill={COLORS.violet} className="tnum">
          +${Math.round(hiPL)}
        </text>
      )}
      {worst >= 0 && loPL < -STAKE_USD * WIN_MARGIN && (
        <text ref={worstLabel} x={Math.min(w - 18, Math.max(18, x(worst)))} textAnchor="middle" fontSize={11} fontWeight={700} fill={COLORS.slate} className="tnum">
          −${Math.round(-loPL)}
        </text>
      )}
    </>
  );
}

/**
 * Grey market curve with the violet example view over it, and under it what $100 on that view
 * makes or loses in each outcome: bars up from a break-even line where it makes money (violet, the
 * view's colour), down where it gets back less (grey), the best and worst labelled in dollars. One
 * shared scale on every card. On hover the curve redraws left to right and a ripple runs along the
 * bars in step with it (see PayoutBars).
 */
function CardChart({ market, view, payouts, hovered, height = 92 }: { market: number[]; view: number[] | null; payouts: number[] | null; hovered: boolean; height?: number }) {
  const { ref, width } = useSize<HTMLDivElement>();
  const visible = useSeen(ref);
  const clipId = useId().replace(/:/g, "");
  const w = width || 300;
  const n = market.length;
  const max = Math.max(...market, ...(view ?? [])) * 1.08 || 1;
  // One slot per outcome, shared by the curve and the bars, so each bar sits right under its point.
  const slot = (w - 4) / Math.max(1, n);
  const x = (j: number) => 2 + (j + 0.5) * slot;
  const y = scaleLinear().domain([0, max]).range([height - 2, 8]);
  const pts = (vals: number[]) => [[2, y(vals[0])] as [number, number], ...vals.map((p, j) => [x(j), y(p)] as [number, number]), [w - 2, y(vals[n - 1])] as [number, number]];
  const a = area<[number, number]>().x((d) => d[0]).y0(height).y1((d) => d[1]).curve(curveMonotoneX);
  const l = line<[number, number]>().x((d) => d[0]).y((d) => d[1]).curve(curveMonotoneX);
  const peak = view ? view.indexOf(Math.max(...view)) : -1;
  // Profit or loss per outcome, on $100, on one scale shared by every card: the break-even line sits
  // at the same height everywhere, gains rise above it and losses drop below it, and a bar's height
  // means the same dollars on any card (a $10 gain = a $10 loss = a $10 gain elsewhere). Height is
  // the square root of the move against the $100 stake, so a $5 move still shows next to a $100
  // one; the dollar labels carry the exact figures.
  const STAKE = 100;
  const LABEL = 12; // label row above the gains and below the losses
  const REGION = 22; // px for a $100 move either way
  const STRIP_H = LABEL + REGION * 2 + LABEL;
  const zeroY = LABEL + REGION;
  const pl = payouts ? payouts.map((p) => p - STAKE) : [];
  // signed: up for a gain, down for a loss, 0 for about break-even
  const barH = (v: number) => (Math.abs(v) <= STAKE * WIN_MARGIN ? 0 : Math.sign(v) * Math.max(2.5, Math.sqrt(Math.min(1, Math.abs(v) / STAKE)) * REGION));
  const hiPL = Math.max(0, ...pl);
  const loPL = Math.min(0, ...pl);
  const best = pl.length ? pl.indexOf(hiPL) : -1;
  const worst = pl.length ? pl.indexOf(loPL) : -1;
  // bars fill their slot, with a thin even gap (as in the profit chart inside a market)
  const gap = Math.max(1, Math.min(3, slot * 0.15));
  const barW = Math.max(1.5, slot - gap);
  // A new key on every hover re-mounts the animated layers, so the left-to-right draw replays.
  const play = hovered ? "play" : "rest";

  return (
    <div ref={ref} className="w-full" aria-hidden="true">
      {width > 0 && (
        <svg width={w} height={height + (payouts ? STRIP_H + 6 : 0)} className="overflow-visible">
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
            <g transform={`translate(0, ${height + 6})`}>
              <PayoutBars heights={pl.map(barH)} hiPL={hiPL} loPL={loPL} best={best} worst={worst} slot={slot} gap={gap} barW={barW} w={w} x={x} zeroY={zeroY} hovered={hovered} visible={visible} />
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
    .slice(0, 3);
  const scaleMax = Math.max(...rows.map((r) => r.p), focus?.yourProb ?? 0) * 1.05;
  const w = (v: number) => `${(v / scaleMax) * 100}%`;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => {
        const isFocus = r.label === focus?.label;
        const add = isFocus && focus ? focus.yourProb - r.p : 0;
        return (
          <div
            key={r.label}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-[13.5px]"
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
              style={{ height: isFocus && hovered ? 8 : 6, transition: `height 400ms ${EASE}` }}
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

/**
 * A market in the same visual language as the panels inside: a grey panel with the market's curve
 * and an example view over it. On hover it lifts into the "focus" style of the panels you work in
 * (white, violet ring), which is where it takes you.
 */
export function MarketCard({ m }: { m: MarketSummary }) {
  const [hovered, setHovered] = useState(false);
  const qc = useQueryClient();
  // Pointing at a card loads its market, so opening it shows the page at once (no skeleton) and
  // the title can morph straight from the card into the page.
  const prefetch = () => qc.prefetchQuery({ queryKey: ["ladder", m.ticker], queryFn: () => desk.ladder(m.ticker), staleTime: 20_000 });
  const soon = new Date(m.expiry).getTime() - Date.now() < 24 * 3600_000;
  const t = m.teaser;
  const kind = m.kind === "threshold" ? `${m.strikeCount} strikes` : m.kind === "categorical" ? `${m.bucketCount} outcomes` : `${m.bucketCount} ranges`;
  const money = (v: number) => `$${v >= 10_000 ? `${Math.round(v / 1000)}k` : Math.round(v).toLocaleString("en-US")}`;
  // Recent activity, as the front page ranks by it; the lifetime total is in the hover hint.
  const vol = m.volume24h ? `${money(m.volume24h)} in 24h` : m.volume24h === 0 ? "quiet today" : m.volume ? `${money(m.volume)} traded` : null;
  return (
    <Link
      href={`/m/${m.ticker}`}
      transitionTypes={["nav-forward"]}
      onMouseEnter={() => {
        setHovered(true);
        prefetch();
      }}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={prefetch}
      onFocus={() => {
        setHovered(true);
        prefetch();
      }}
      onBlur={() => setHovered(false)}
      style={{ transition: "translate var(--spring-ms) var(--spring), background-color 240ms ease, box-shadow 320ms ease" }}
      className="group flex min-w-0 flex-col gap-3 rounded-[24px] bg-cloud p-4 hover:-translate-y-0.5 hover:bg-porcelain hover:shadow-[0_0_0_1.5px_rgba(89,79,244,0.28),0_12px_32px_-14px_rgba(89,79,244,0.45)] focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(89,79,244,0.6)]"
    >
      <div className="flex items-start justify-between gap-3">
        {/* the same name as the market page's title: opening the card morphs one into the other */}
        <ViewTransition name={`market-title-${m.ticker}`} share="morph" default="none">
          <h3 className="line-clamp-2 min-w-0 text-[16px] font-bold leading-snug text-inkstone">{m.title}</h3>
        </ViewTransition>
        {m.sample ? (
          <span className="shrink-0 rounded-full border border-dashed border-ash px-2 py-0.5 text-[12px] text-slate">Sample</span>
        ) : (
          <span
            className={`tnum shrink-0 rounded-full px-2 py-0.5 text-[12px] ${soon ? "bg-signal-violet text-white" : "bg-porcelain text-inkstone group-hover:bg-cloud"}`}
            title={`Settles ${settleLabel(m.expiry)}`}
          >
            {untilLabel(m.expiry).replace(/^in /, "")}
          </span>
        )}
      </div>
      {m.readout.center ? (
        <p className="-mt-1.5 text-[13.5px] text-slate">
          Market says <span className="tnum font-bold text-inkstone">{m.readout.center}</span> <span className="tnum">± {m.readout.spread}</span>
        </p>
      ) : m.readout.leader ? (
        <p className="-mt-1.5 truncate text-[13.5px] text-slate">
          Favourite <span className="font-bold text-inkstone">{m.readout.leader}</span> · <span className="tnum">{pct(m.readout.leaderProb ?? 0)}</span>
        </p>
      ) : null}

      {m.kind === "categorical" ? (
        <CategoricalBars m={m} hovered={hovered} />
      ) : (
        <CardChart market={m.marketProb} view={t?.belief ?? null} payouts={t?.trade ? t.payouts : null} hovered={hovered} height={60} />
      )}

      {/* What an example view gets, in one line: the same numbers the panels inside lead with */}
      <div className="rounded-[14px] bg-porcelain px-3 py-2 text-[13px] leading-snug group-hover:bg-cloud">
        {m.kind === "categorical" && t?.focus ? (
          <span className="text-slate">
            Rate <b className="text-inkstone">{t.focus.label}</b> <b className="tnum text-signal-violet">{pct(t.focus.yourProb)}</b> (market{" "}
            <span className="tnum">{pct(t.focus.marketProb)}</span>): $100 pays <b className="tnum text-signal-violet">{usd(t.focus.paysIfWins, 0)}</b> if so, at least{" "}
            <b className="tnum text-inkstone">{usd(t.worst, 0)}</b>
          </span>
        ) : t?.trade ? (
          // $100 on the example view: the same three numbers the panels inside a market lead with
          <span className="tnum grid grid-cols-3 gap-x-2">
            <span className="text-[11.5px] leading-tight text-smoke">Worst case</span>
            <span className="text-[11.5px] leading-tight text-smoke">Best case</span>
            <span className="text-right text-[11.5px] leading-tight text-smoke">Profit if right</span>
            <span className="font-bold text-inkstone">{STAKE_USD - t.worst < 0.5 ? "nothing" : `−${usd(STAKE_USD - t.worst, 0)}`}</span>
            <span className="font-bold text-signal-violet">+{usd(Math.max(0, t.best - STAKE_USD), 0)}</span>
            <span className="text-right font-bold text-inkstone">{pct(t.belief.reduce((a, b, j) => a + (isWin(t.payouts[j], STAKE_USD) ? b : 0), 0))}</span>
          </span>
        ) : (
          <span className="text-slate">{m.kind === "categorical" ? "Set your own odds for each outcome and trade the whole field." : "A tight market: bring a sharper view to find an edge."}</span>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 text-[12.5px]">
        <span
          className="tnum truncate text-smoke"
          title={`${m.volume ? `${money(m.volume)} traded since it listed · ` : ""}${m.quotedCount} quoted · settles ${settleLabel(m.expiry)}`}
        >
          {vol ? `${vol} · ` : ""}
          {kind}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 font-bold text-signal-violet opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
          Shape your view <ArrowRight size={14} strokeWidth={2.25} />
        </span>
      </div>
    </Link>
  );
}
