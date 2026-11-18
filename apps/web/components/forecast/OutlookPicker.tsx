"use client";

import { useRef, useState } from "react";
import { ChevronDown, Crosshair, MoveHorizontal, ShieldCheck, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { StrategyDef, StrategyKey } from "./strategies";

export type Outlook = "higher" | "lower" | "near" | "move";

/** How far each hump of a split ("big move") view sits from its center, in market standard deviations. */
export const SPLIT_OFFSET = 1.5;

/**
 * Each outlook is a preset for the two-slider belief: shift the market's center by `x` market
 * standard deviations and scale its width by `w`. `split` makes it two humps, one either side of
 * the center. The Fine-tune sliders start from these values. Tuned so every outlook trades at the
 * lowest confidence on the live SOL, copper, gold and WTI ladders.
 */
export const OUTLOOKS: { key: Outlook; title: string; icon: LucideIcon; x: number; w: number; split?: boolean; sub: (c: string) => string; curve: Curve }[] = [
  { key: "higher", title: "Higher", icon: TrendingUp, x: 0.8, w: 0.85, sub: (c) => `above ${c}`, curve: { mu: 63, s: 11 } },
  { key: "lower", title: "Lower", icon: TrendingDown, x: -0.8, w: 0.85, sub: (c) => `below ${c}`, curve: { mu: 37, s: 11 } },
  { key: "near", title: "Stays near", icon: Crosshair, x: 0, w: 0.55, sub: (c) => `around ${c}`, curve: { mu: 50, s: 7.5 } },
  { key: "move", title: "Big move", icon: MoveHorizontal, x: 0, w: 0.7, split: true, sub: (c) => `far from ${c}`, curve: { mu: 50, s: 9, split: 23 } },
];

type Curve = { mu: number; s: number; split?: number };
const MARKET_CURVE: Curve = { mu: 50, s: 14 };

/** A bell (or two half-height bells) as an SVG path on a 100 x 40 box; equal area for every width, clipped at the top. */
function bell({ mu, s, split }: Curve) {
  const g = (x: number, m: number) => (300 / s) * Math.exp(-0.5 * ((x - m) / s) ** 2);
  const pts: string[] = [];
  for (let x = 0; x <= 100; x += 2) {
    const h = split ? (g(x, mu - split) + g(x, mu + split)) / 2 : g(x, mu);
    pts.push(`${x},${(38 - Math.min(36, h)).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

export function OutlookPicker({
  value,
  onPick,
  center,
  expected,
  live = false,
  protect,
  more,
}: {
  value: Outlook | null;
  onPick: (o: Outlook) => void;
  /** The price the outlooks are relative to: the live price when there is one, else the market's expected price. */
  center: string;
  /** The market's expected settlement price. */
  expected: string;
  /** Whether `center` is the live price (it then ticks with the header). */
  live?: boolean;
  /** Offered on price ladders: protect a holding instead of trading a view. */
  protect?: { on: boolean; name: string; onClick: () => void };
  /** Less common strategies, folded away under "More strategies". */
  more?: { items: StrategyDef[]; active: StrategyKey | null; onPick: (k: StrategyKey) => void };
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const showMore = moreOpen || !!more?.active;
  const active = value ? OUTLOOKS.findIndex((o) => o.key === value) : -1;
  const move = (i: number) => {
    const j = (i + OUTLOOKS.length) % OUTLOOKS.length;
    onPick(OUTLOOKS[j].key);
    refs.current[j]?.focus();
  };
  return (
    <section className="card @container">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div>
          <p className="eyebrow">Step 1 · Your outlook</p>
          <h2 className="card-title mt-1">What do you think will happen?</h2>
        </div>
        <p className="text-[14px] text-slate">
          {live ? (
            <>
              Compared with today&apos;s <span className="tnum font-bold text-inkstone">{center}</span> · market expects{" "}
              <span className="tnum font-bold text-inkstone">{expected}</span> at settlement
            </>
          ) : (
            <>
              The market expects about <span className="tnum font-bold text-inkstone">{expected}</span>
            </>
          )}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Your outlook"
        className="mt-5 grid grid-cols-2 gap-3 @xl:grid-cols-4"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            move(active + 1);
          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            move(active < 0 ? OUTLOOKS.length - 1 : active - 1);
          }
        }}
      >
        {OUTLOOKS.map((o, i) => {
          const on = i === active;
          const Icon = o.icon;
          return (
            <button
              key={o.key}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (active < 0 && i === 0) ? 0 : -1}
              onClick={() => onPick(o.key)}
              className={`ease group flex flex-col gap-1 rounded-[20px] border bg-porcelain px-4 pb-3 pt-4 text-left hover:-translate-y-0.5 ${
                on ? "border-signal-violet shadow-[0_0_0_3px_rgba(89,79,244,0.14)]" : "border-mist hover:border-ash"
              }`}
            >
              <span className={`flex items-center gap-2 whitespace-nowrap font-bold ${on ? "text-signal-violet" : "text-inkstone"}`}>
                <Icon size={18} strokeWidth={2} aria-hidden="true" />
                {o.title}
              </span>
              <span className="tnum text-[14px] text-slate">{o.sub(center)}</span>
              <svg viewBox="0 0 100 40" className="mt-1 h-10 w-full" aria-hidden="true" preserveAspectRatio="none">
                <path d={bell(MARKET_CURVE)} fill="none" stroke="var(--color-ash)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                <path
                  d={`${bell(o.curve)} L100,38 L0,38 Z`}
                  fill={on ? "rgba(89,79,244,0.12)" : "rgba(89,79,244,0.06)"}
                  stroke="var(--color-signal-violet)"
                  strokeWidth={on ? 2.25 : 1.5}
                  strokeOpacity={on ? 1 : 0.55}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </button>
          );
        })}
      </div>
      <p className="mt-3 flex items-center gap-4 text-[14px] text-smoke">
        <span className="inline-flex items-center gap-2">
          <span className="h-0 w-4 border-t-[1.5px] border-dashed border-ash" /> Market
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-[3px] w-4 rounded-full bg-signal-violet" /> You
        </span>
        {value === null && !protect?.on && <span className="text-slate">· Pick one, or drag the curve on the chart</span>}
      </p>
      {protect && (
        <button
          type="button"
          aria-pressed={protect.on}
          onClick={protect.onClick}
          className={`ease mt-4 flex w-full items-center gap-4 rounded-[20px] border px-5 py-4 text-left ${
            protect.on ? "border-signal-violet bg-porcelain shadow-[0_0_0_3px_rgba(89,79,244,0.14)]" : "border-dashed border-ash bg-transparent hover:border-signal-violet hover:bg-porcelain"
          }`}
        >
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${protect.on ? "bg-signal-violet text-white" : "bg-mist text-inkstone"}`}>
            <ShieldCheck size={20} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className={`block font-bold ${protect.on ? "text-signal-violet" : "text-inkstone"}`}>Already own {protect.name}? Protect what you hold</span>
            <span className="block text-[14px] text-slate">No view needed. Get paid back if the price falls below a floor you choose.</span>
          </span>
        </button>
      )}
      {more && more.items.length > 0 && (
        <div className="mt-3 border-t border-mist pt-3">
          <button
            type="button"
            aria-expanded={showMore}
            aria-controls="more-strategies"
            onClick={() => setMoreOpen((o) => !o)}
            className="ease -mx-2 flex w-[calc(100%+16px)] items-center justify-between rounded-[14px] px-2 py-2 text-left hover:bg-porcelain"
          >
            <span>
              <span className="block font-bold text-inkstone">More strategies</span>
              <span className="block text-[13px] text-slate">{more.items.map((s) => s.title).join(" · ")} · for when you know what you want</span>
            </span>
            <ChevronDown size={20} strokeWidth={1.75} className={`ease shrink-0 text-inkstone ${showMore ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {showMore && (
            <div id="more-strategies" role="radiogroup" aria-label="More strategies" className="fade-up mt-2 grid gap-2 @xl:grid-cols-2">
              {more.items.map((s) => {
                const on = more.active === s.key;
                const Icon = s.icon;
                return (
                  <button
                    key={s.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => more.onPick(s.key)}
                    className={`ease flex items-start gap-3 rounded-[16px] border bg-porcelain px-4 py-3 text-left ${
                      on ? "border-signal-violet shadow-[0_0_0_3px_rgba(89,79,244,0.14)]" : "border-mist hover:border-ash"
                    }`}
                  >
                    <Icon size={18} strokeWidth={2} className={`mt-0.5 shrink-0 ${on ? "text-signal-violet" : "text-slate"}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className={`font-bold ${on ? "text-signal-violet" : "text-inkstone"}`}>{s.title}</span>
                        <span className="rounded-full bg-cloud px-2 py-px text-[11px] font-medium uppercase tracking-wide text-smoke">{s.level}</span>
                      </span>
                      <span className="block text-[13px] leading-snug text-slate">{s.sub}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
