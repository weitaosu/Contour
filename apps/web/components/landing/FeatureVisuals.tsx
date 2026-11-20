"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMorph } from "@/components/charts/useTween";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";

/**
 * Small product moments for the "Express conviction with precision" grid: each shows the piece of the
 * app its card describes (the key numbers, the view against the market, the outcome table, the
 * confidence picker), gently cycling through a few illustrative states. They move only while on
 * screen, and hold still for anyone who prefers reduced motion.
 */

const LOSS = "#c73e54";
const GAIN = "#12846a";
const VIOLET = "#6042f5";

/** Steps 0…count−1 every `ms`, but only while the element is on screen and motion is welcome. */
function useCycle<T extends HTMLElement>(count: number, ms: number) {
  const ref = useRef<T>(null);
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => setStep((s) => (s + 1) % count), ms);
    return () => clearInterval(t);
  }, [visible, count, ms]);
  return [ref, step] as const;
}

const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`w-full rounded-[14px] bg-white shadow-[0_1px_2px_rgba(16,16,40,0.04)] ${className}`}>{children}</div>
);

const dollars = (v: number) => `$${Math.round(Math.abs(v))}`;
const signed = (v: number) => (Math.round(v) === 0 ? "$0" : `${v > 0 ? "+" : "−"}${dollars(v)}`);
const tone = (v: number) => (Math.round(v) > 0 ? GAIN : Math.round(v) < 0 ? LOSS : "#8a8a96");

/** Increase upside, limit downside: the loss you accept and the profit it buys, moving together. */
const TRADEOFFS = [
  { loss: 40, profit: 80 },
  { loss: 25, profit: 45 },
  { loss: 60, profit: 130 },
];
export function TradeoffVisual() {
  const [ref, step] = useCycle<HTMLDivElement>(TRADEOFFS.length, 2600);
  const t = TRADEOFFS[step];
  return (
    <div ref={ref} className="w-full max-w-[400px]">
      <Card className="grid grid-cols-3 gap-3 px-5 py-6 sm:px-7 sm:py-8">
        <div className="min-w-0">
          <p className="text-[12px] text-[#70707d] sm:text-[13px]">Your budget</p>
          <p className="tnum mt-2 text-[22px] font-semibold leading-none text-[#010110] sm:text-[26px]">$100</p>
        </div>
        <div className="min-w-0">
          <p className="text-[12px] text-[#70707d] sm:text-[13px]">Maximum loss</p>
          <p className="mt-2 text-[22px] font-semibold leading-none sm:text-[26px]" style={{ color: LOSS }}>
            <AnimatedNumber value={t.loss} format={dollars} />
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[12px] text-[#70707d] sm:text-[13px]">Maximum profit</p>
          <p className="mt-2 text-[22px] font-semibold leading-none sm:text-[26px]" style={{ color: GAIN }}>
            +<AnimatedNumber value={t.profit} format={dollars} />
          </p>
        </div>
      </Card>
    </div>
  );
}

/** A bell curve as an SVG path across a 0–300 wide, 0–100 tall box (baseline at y = 95). */
function bell(center: number, spread: number, height: number) {
  const pts: string[] = [];
  for (let x = 0; x <= 300; x += 5) {
    const y = 95 - height * Math.exp(-((x - center) ** 2) / (2 * spread ** 2));
    pts.push(`${x === 0 ? "M" : "L"}${x} ${y.toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Express views more precisely: your forecast reshaping (higher, a tight range, lower) against the market's. */
const VIEWS = [
  [190, 34, 84],
  [132, 22, 92],
  [80, 36, 80],
];
export function ViewVisual() {
  const [ref, step] = useCycle<HTMLDivElement>(VIEWS.length, 2800);
  const [center, spread, height] = useMorph(VIEWS[step], 900);
  const market = bell(130, 48, 62);
  const yours = bell(center, spread, height);
  return (
    <div ref={ref} className="w-full max-w-[330px]">
      <svg viewBox="0 0 300 100" className="block w-full" aria-hidden="true">
        <path d={`${yours} L300 95 L0 95 Z`} fill={VIOLET} fillOpacity="0.1" />
        <path d={market} fill="none" stroke="#b9b9c6" strokeWidth="1.6" />
        <path d={yours} fill="none" stroke={VIOLET} strokeWidth="2.2" />
      </svg>
      <div className="mt-3 flex justify-between text-[12.5px]">
        <span className="flex items-center gap-2 text-[#70707d]">
          <span className="h-[2px] w-4 rounded bg-[#b9b9c6]" aria-hidden="true" />
          Market
        </span>
        <span className="flex items-center gap-2" style={{ color: VIOLET }}>
          <span className="h-[2px] w-4 rounded" style={{ background: VIOLET }} aria-hidden="true" />
          Your view
        </span>
      </div>
    </div>
  );
}

/** See every outcome: one contract against Contour, outcome by outcome, as the position changes. */
const LABELS = ["Below $72", "$72–$76", "$76 or above"];
const ONE = [-40, -40, 80];
const CONTOURS = [
  [-40, 20, 80],
  [-25, 35, 60],
  [-15, 50, 45],
];
function MoneyCell({ value }: { value: number }) {
  return (
    <td className="py-2.5 font-semibold" style={{ color: tone(value), transition: "color 300ms ease" }}>
      <AnimatedNumber value={value} format={signed} />
    </td>
  );
}
export function OutcomesVisual() {
  const [ref, step] = useCycle<HTMLDivElement>(CONTOURS.length, 2600);
  const contour = CONTOURS[step];
  return (
    <div ref={ref} className="w-full max-w-[420px]">
      <Card className="px-4 py-3 sm:px-5 sm:py-4">
        <table className="tnum w-full text-left text-[12.5px] sm:text-[13.5px]">
          <thead>
            <tr className="text-[11.5px] text-[#70707d] sm:text-[12.5px]">
              <th className="pb-2.5 font-normal">Scenario</th>
              <th className="pb-2.5 font-normal">Single</th>
              <th className="pb-2.5 font-normal">Contour</th>
              <th className="pb-2.5 font-normal">Difference</th>
            </tr>
          </thead>
          <tbody>
            {LABELS.map((label, i) => (
              <tr key={label} className="border-t border-[#ececf2]">
                <td className="py-2.5 text-[#2e2e3d]">{label}</td>
                <MoneyCell value={ONE[i]} />
                <MoneyCell value={contour[i]} />
                <MoneyCell value={contour[i] - ONE[i]} />
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** Hedge, don't guess: the highlight slides between how closely to follow your view. */
const OPTIONS = ["100%", "75%", "50%", "Other"];
const PICKS = [1, 2, 0];
export function ConfidenceVisual() {
  const [ref, step] = useCycle<HTMLDivElement>(PICKS.length, 2400);
  const on = PICKS[step];
  return (
    <div ref={ref} className="w-full max-w-[360px]">
      <Card className="px-5 py-6 sm:px-7 sm:py-7">
        <p className="text-[15px] font-semibold text-[#010110] sm:text-[16px]">Confidence</p>
        <div className="relative mt-4 grid grid-cols-4 gap-1 rounded-full bg-[#f1f1f5] p-1">
          {/* the highlight, sliding under the options (each a quarter of the track) */}
          <span
            aria-hidden="true"
            className="absolute inset-y-1 left-1 rounded-full"
            style={{
              width: "calc((100% - 0.5rem - 0.75rem) / 4)",
              transform: `translateX(calc(${on} * (100% + 0.25rem)))`,
              background: VIOLET,
              transition: "transform 520ms var(--spring-soft, cubic-bezier(.2,.8,.2,1))",
            }}
          />
          {OPTIONS.map((o, i) => (
            <span
              key={o}
              className={`relative rounded-full py-1.5 text-center text-[13px] font-semibold ${i === on ? "text-white" : "text-[#70707d]"}`}
              style={{ transition: "color 300ms ease" }}
            >
              {o}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
