"use client";

import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { OutlookVisual, PayoffVisual, ReviewVisual, SectionsVisual } from "./StepVisuals";
import { s } from "./styles";

type Step = { title: string; body: string; Visual: ComponentType<{ running: boolean }>; label: string };

/** Each step pairs with a live piece of the app: its section list, its two charts, its review summary. */
const STEPS: Step[] = [
  {
    title: "Pick a market",
    body: "Browse every popular section of Gemini, busiest first. Each card shows the odds and what a view on it could pay.",
    Visual: SectionsVisual,
    label: "Gemini sections ranked by what traded in the last 24 hours, with how many markets in each can be traded as one curve.",
  },
  {
    title: "Choose your outlook",
    body: "Say what will happen: higher, lower, stays near, a big move, or protect what you hold. Then drag the curve to set where and how sure.",
    Visual: OutlookVisual,
    label: "A forecast curve reshaping through example outlooks, drawn against the market's own curve.",
  },
  {
    title: "Compare the payoff",
    body: "See the most you can make and lose, where you profit, your chance of profit, and the exact contracts you'd buy at Gemini's prices.",
    Visual: PayoffVisual,
    label: "What $100 makes at every settlement price for each outlook, with the amount at risk, the most you can make and the chance of profit.",
  },
  {
    title: "Review your bet",
    body: "Read a plain summary of what you pay and the best and worst case, then sign once with your wallet to lock the payout on Solana.",
    Visual: ReviewVisual,
    label: "The review summary: when you make money, what you pay, the best and worst case, and the chance of profit.",
  },
];

/** How long each step stays up while the selector advances on its own. */
const ADVANCE_MS = 6500;

export function StepSelector() {
  const [active, setActive] = useState(0);
  // Advances on its own until someone picks a step, and never with reduced motion.
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setAuto(false);
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!auto || !visible) return;
    const t = setTimeout(() => setActive((a) => (a + 1) % STEPS.length), ADVANCE_MS);
    return () => clearTimeout(t);
  }, [active, auto, visible]);

  const choose = (i: number, focus = false) => {
    setAuto(false);
    setActive(i);
    if (focus) tabs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const last = STEPS.length - 1;
    const next = { ArrowDown: active + 1, ArrowRight: active + 1, ArrowUp: active - 1, ArrowLeft: active - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    choose((next + STEPS.length) % STEPS.length, true);
  };

  const running = auto && visible;
  const current = STEPS[active];

  return (
    // Phones: heading, then the screen, then the steps, so a tapped step changes the image just above it.
    // Wide screens: heading and steps on the left, the screen spanning both rows on the right.
    <div ref={root} className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[auto_auto] lg:gap-x-20 lg:gap-y-[56px]">
      <h2 id={`${id}-title`} className={`${s.display} text-[clamp(32px,4vw,42px)] leading-[1.15] lg:col-start-1 lg:row-start-1 lg:self-end`}>
        How it works. <span className="text-[#70707d]">From a market to a position in four steps.</span>
      </h2>
      <div className="order-3 lg:order-none lg:col-start-1 lg:row-start-2">
        <div role="tablist" aria-labelledby={`${id}-title`} aria-orientation="vertical" onKeyDown={onKeyDown} className="flex flex-col">
          {STEPS.map((step, i) => {
            const on = i === active;
            return (
              <button
                key={step.title}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                id={`${id}-tab-${i}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={`${id}-panel`}
                aria-labelledby={`${id}-name-${i}`}
                aria-describedby={`${id}-desc-${i}`}
                tabIndex={on ? 0 : -1}
                onClick={() => choose(i)}
                className="group relative flex w-full gap-4 py-4 pl-6 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6042f5]"
              >
                {/* the rail: grey for every step, filled for the current one (filling over time while it advances) */}
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[2px] bg-[rgba(0,0,0,0.08)]">
                  {on && (
                    <span
                      key={`${active}-${running}`}
                      className={`absolute inset-0 origin-top bg-[#111117] ${running ? "lp-progress" : ""}`}
                      style={running ? { animationDuration: `${ADVANCE_MS}ms` } : undefined}
                    />
                  )}
                </span>
                <span aria-hidden="true" className={`pt-[7px] text-[13px] font-medium tabular-nums ${on ? "text-[#111117]" : "text-[#70707d]"}`}>
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span
                    id={`${id}-name-${i}`}
                    className={`${s.display} block text-[22px] leading-8 tracking-[-0.01em] transition-colors duration-150 lg:text-[26px] ${
                      on ? "text-[#111117]" : "text-[#70707d] group-hover:text-[#111117]"
                    }`}
                  >
                    {step.title}
                  </span>
                  <span className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: on ? "1fr" : "0fr" }}>
                    <span className="overflow-hidden">
                      <span id={`${id}-desc-${i}`} className="block max-w-[42ch] pt-2 text-[15px] leading-[1.55] text-[#737373]">
                        {step.body}
                      </span>
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${active}`}
        className={`${s.stage} ${s.grain} relative order-2 aspect-[2/3] overflow-hidden sm:aspect-[1.25] rounded-[8px] lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:aspect-auto lg:h-[560px] lg:self-center`}
      >
        <span className={`${s.haze} left-[20%] top-[10%] h-[200px] w-[360px]`} aria-hidden="true" />
        <div className={`${s.rim} absolute inset-[6%] rounded-[14px] p-[6px]`}>
          <div className="relative h-full w-full overflow-hidden rounded-[9px] bg-white p-4 sm:p-5">
            <div key={active} role="img" aria-label={current.label} className="fade-in h-full w-full">
              <current.Visual running={visible} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
