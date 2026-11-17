"use client";

import type { Quote } from "@contour/core";
import { Stat } from "@/components/ui/Stat";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { pct, usd } from "@/lib/format";

export function FiveNumbers({ quote, stake, title }: { quote: Omit<Quote, "raw">; stake: number; title?: string }) {
  const ev = quote.evUnderMarket;
  const cost = stake - ev;
  const money = (n: number) => usd(n);
  return (
    <section className="rounded-[36px] border border-mist bg-porcelain px-6 py-7 md:px-8">
      {title && <p className="eyebrow mb-5">{title}</p>}
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-5">
        <Stat label="Stake" value={<AnimatedNumber value={stake} format={money} />} />
        <Stat label="Worst case" value={<AnimatedNumber value={quote.minPayout} format={money} />} />
        <Stat label="Best case" value={<AnimatedNumber value={quote.maxPayout} format={money} />} />
        <Stat
          label="If you're right"
          value={
            <span className="text-signal-violet">
              <AnimatedNumber value={quote.probProfitBelief} format={(n) => pct(n)} />
            </span>
          }
          sub={<ProbBar p={quote.probProfitBelief} violet />}
        />
        <Stat label="If market's right" value={<AnimatedNumber value={quote.probProfitMarket} format={(n) => pct(n)} />} sub={<ProbBar p={quote.probProfitMarket} />} />
      </div>
      <p className="mt-6 border-t border-mist pt-5 text-inkstone">
        If the market is right, this position is expected to return{" "}
        <span className="font-bold">
          <AnimatedNumber value={ev} format={money} />
        </span>
        {cost > 0.005 ? <span className="text-slate">, so you pay about {usd(cost)} in spread to express your view.</span> : <span className="text-slate">.</span>}
      </p>
    </section>
  );
}

/** Chance-of-profit meter: thin track, rounded fill that eases to the value. */
function ProbBar({ p, violet }: { p: number; violet?: boolean }) {
  return (
    <span className="mt-1 block h-[6px] w-full max-w-[140px] overflow-hidden rounded-full bg-mist" aria-hidden="true">
      <span
        className={`block h-full rounded-full ${violet ? "bg-signal-violet" : "bg-smoke"}`}
        style={{ width: `${Math.round(p * 100)}%`, transition: "width 420ms cubic-bezier(.2,.8,.2,1)" }}
      />
    </span>
  );
}
