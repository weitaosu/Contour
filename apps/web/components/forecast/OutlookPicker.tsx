"use client";

import { useRef, useState } from "react";
import { ChevronDown, Crosshair, MoveHorizontal, ShieldCheck, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { StrategyDef, StrategyKey } from "./strategies";
import { StepBadge } from "./Panel";

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
  step = 1,
  prompt = false,
  settles,
  unavailable = [],
}: {
  /** Outlooks with no tradable position on this market at any strength or confidence. */
  unavailable?: Outlook[];
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
  step?: number;
  /** Nothing picked yet: mark this as where to start. */
  prompt?: boolean;
  /** When the market settles, for the "Now" price's explanation. */
  settles?: string;
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
  const chip = (on: boolean) =>
    `ease flex min-w-0 flex-col rounded-[14px] border bg-porcelain px-3 py-1 text-left hover:-translate-y-0.5 ${
      on ? "border-signal-violet shadow-[0_0_0_3px_rgba(89,79,244,0.14)]" : "border-mist hover:border-ash"
    }`;
  return (
    <section
      aria-labelledby="outlook-title"
      className={`ease rounded-[24px] bg-cloud p-3 ${prompt ? "shadow-[0_0_0_2px_rgba(89,79,244,0.35)]" : ""}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="min-w-0 px-1 lg:w-[196px] lg:shrink-0">
          <h2 id="outlook-title" className="flex flex-wrap items-center gap-2 text-[16px] font-bold leading-tight text-inkstone">
            <StepBadge n={step} />
            What will happen?
            {prompt && <span className="rounded-full bg-signal-violet px-2 py-px text-[11px] font-bold uppercase tracking-wide text-white">Start here</span>}
          </h2>
          <p className="tnum mt-1 text-[12.5px] leading-snug text-smoke">
            {live ? (
              <>
                <span title={`Gemini's last trade. The market settles on its reference index${settles ? ` at ${settles}` : ""}, which can differ slightly.`}>
                  Now <span className="font-bold text-inkstone">{center}</span>
                </span>{" "}
                ·{" "}
                <span title="The market's average outcome, read from its odds across all the strikes. Approximate: the open-ended outcomes at either end have no fixed value.">
                  expects ≈ <span className="font-bold text-inkstone">{expected}</span>
                </span>
              </>
            ) : (
              <>
                Market expects about <span className="font-bold text-inkstone">{expected}</span>
              </>
            )}
          </p>
        </div>
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <div
            role="radiogroup"
            aria-label="Your outlook"
            className="contents"
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
              const off = unavailable.includes(o.key) && !on;
              return (
                <button
                  key={o.key}
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-disabled={off}
                  disabled={off}
                  title={off ? `No ${o.title.toLowerCase()} position is worth buying at these prices, even at full confidence.` : undefined}
                  tabIndex={on || (active < 0 && i === 0) ? 0 : -1}
                  onClick={() => !off && onPick(o.key)}
                  className={`${chip(on)} ${off ? "pointer-events-none opacity-45" : ""}`}
                >
                  <span className="flex items-center justify-between gap-1.5">
                    <span className={`truncate text-[15px] font-bold leading-tight ${on ? "text-signal-violet" : "text-inkstone"}`}>{o.title}</span>
                  {/* the shape of this outlook against the market's (dashed) */}
                  <svg viewBox="0 0 100 40" className="h-5 w-8 shrink-0 max-xl:lg:hidden" aria-hidden="true" preserveAspectRatio="none">
                    <path d={bell(MARKET_CURVE)} fill="none" stroke="var(--color-ash)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                    <path
                      d={`${bell(o.curve)} L100,38 L0,38 Z`}
                      fill={on ? "rgba(89,79,244,0.14)" : "rgba(89,79,244,0.06)"}
                      stroke="var(--color-signal-violet)"
                      strokeWidth={on ? 2.25 : 1.5}
                      strokeOpacity={on ? 1 : 0.6}
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  </span>
                  <span className="tnum mt-0.5 block truncate text-[12.5px] text-slate">{off ? "no trade at these prices" : o.sub(center)}</span>
                </button>
              );
            })}
          </div>
          {protect && (
            <button type="button" aria-pressed={protect.on} onClick={protect.onClick} className={`${chip(protect.on)} ${protect.on ? "" : "border-dashed"}`}>
              <span className="flex items-center justify-between gap-1.5">
                <span className={`truncate text-[15px] font-bold leading-tight ${protect.on ? "text-signal-violet" : "text-inkstone"}`}>Protect</span>
                <ShieldCheck size={18} strokeWidth={2} className={`shrink-0 ${protect.on ? "text-signal-violet" : "text-slate"}`} aria-hidden="true" />
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] text-slate" title={`Already own ${protect.name}? Get paid back if it falls. No view needed.`}>
                insure your {protect.name}
              </span>
            </button>
          )}
        </div>
      </div>
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
            <div id="more-strategies" role="radiogroup" aria-label="More strategies" className="fade-up mt-2 grid gap-2 md:grid-cols-2">
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
