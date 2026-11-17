"use client";

import { Minus, Plus, RotateCcw } from "lucide-react";
import { pct, usd } from "@/lib/format";

/** Set your own odds for each candidate; the others rescale so everything still sums to 100%. */
export function setOne(values: number[], i: number, v: number): number[] {
  const target = Math.min(0.97, Math.max(0.001, v));
  const rest = values.reduce((a, x, j) => (j === i ? a : a + x), 0);
  const scale = rest > 0 ? (1 - target) / rest : 0;
  return values.map((x, j) => (j === i ? target : Math.max(0.0005, x * scale)));
}

export function CandidateEditor({
  labels,
  market,
  belief,
  payouts,
  stake,
  onChange,
}: {
  labels: string[];
  market: number[];
  belief: number[];
  payouts: number[];
  stake: number;
  onChange: (b: number[]) => void;
}) {
  const order = market.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const maxP = Math.max(...market, ...belief);
  return (
    <section className="card">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="card-title">Your odds for each candidate</h2>
          <p className="mt-1 text-[14px] text-slate">Exactly one wins. Raise the ones you think the market underrates; everyone else adjusts so it adds up to 100%.</p>
        </div>
        <button className="btn btn-quiet !py-2 !text-[14px]" onClick={() => onChange([...market])}>
          <RotateCcw size={15} strokeWidth={1.75} /> Same as market
        </button>
      </div>
      <div className="mt-4 hidden flex-wrap items-center gap-4 text-[13px] text-slate md:flex">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-full bg-ash" /> market odds
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-full bg-signal-violet" /> odds you add
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-full border-[1.5px] border-dashed border-slate" /> odds you take away
        </span>
      </div>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-1 text-[14px] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]">
        <span className="stat-label">Candidate</span>
        <span className="stat-label hidden md:block">Market vs you</span>
        <span className="stat-label text-center">Your odds</span>
        <span className="stat-label text-right">Pays if wins</span>
        {order.map((i) => {
          const diff = belief[i] - market[i];
          const up = diff > 0.005;
          const down = diff < -0.005;
          const win = payouts[i] > stake + 1e-9;
          return (
            <div key={i} className="contents">
              <span className={`truncate border-t border-mist py-3 ${up ? "font-bold text-signal-violet" : "text-inkstone"}`}>{labels[i]}</span>
              <span className="hidden border-t border-mist py-3 md:block">
                {/* one bar: grey = market odds; violet = odds you add; hollow = odds you take away */}
                <span className="relative block h-2.5 overflow-hidden rounded-full bg-porcelain">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full bg-ash"
                    style={{ width: `${(Math.min(market[i], belief[i]) / maxP) * 100}%`, transition: "width 450ms cubic-bezier(.22,.61,.36,1)" }}
                  />
                  <span
                    className="absolute inset-y-0 rounded-r-full bg-signal-violet"
                    style={{
                      left: `calc(${(market[i] / maxP) * 100}% - 3px)`,
                      width: up ? `calc(${((belief[i] - market[i]) / maxP) * 100}% + 3px)` : "0%",
                      transition: "width 450ms cubic-bezier(.22,.61,.36,1), left 450ms cubic-bezier(.22,.61,.36,1)",
                    }}
                  />
                  <span
                    className="absolute inset-y-0 rounded-r-full border-[1.5px] border-dashed border-slate"
                    style={{
                      left: `${(belief[i] / maxP) * 100}%`,
                      width: down ? `${((market[i] - belief[i]) / maxP) * 100}%` : "0%",
                      opacity: down ? 1 : 0,
                      transition: "width 450ms cubic-bezier(.22,.61,.36,1), left 450ms cubic-bezier(.22,.61,.36,1), opacity 300ms ease",
                    }}
                  />
                </span>
              </span>
              <span className="flex items-center justify-center gap-1.5 border-t border-mist py-2">
                <button
                  aria-label={`Lower ${labels[i]}`}
                  className="ease flex h-8 w-8 items-center justify-center rounded-full bg-porcelain text-inkstone hover:bg-mist active:scale-90"
                  onClick={(e) => onChange(setOne(belief, i, belief[i] - (e.shiftKey ? 0.05 : 0.01)))}
                >
                  <Minus size={14} strokeWidth={2} />
                </button>
                <span className="w-[76px] whitespace-nowrap text-center">
                  <span className={`tnum block font-bold ${up ? "text-signal-violet" : "text-inkstone"}`}>{pct(belief[i])}</span>
                  <span className="tnum block text-[12px] text-smoke">
                    mkt {pct(market[i])}
                    <span className={up ? "text-signal-violet" : ""}>{up ? " ▲" : down ? " ▼" : ""}</span>
                  </span>
                </span>
                <button
                  aria-label={`Raise ${labels[i]}`}
                  className="ease flex h-8 w-8 items-center justify-center rounded-full bg-signal-violet text-porcelain hover:bg-[#4a40e6] active:scale-90"
                  onClick={(e) => onChange(setOne(belief, i, belief[i] + (e.shiftKey ? 0.05 : 0.01)))}
                >
                  <Plus size={14} strokeWidth={2} />
                </button>
              </span>
              <span className={`tnum border-t border-mist py-3 text-right font-bold ${win ? "text-signal-violet" : "text-inkstone"}`}>{usd(payouts[i], 0)}</span>
            </div>
          );
        })}
      </div>
      {belief.every((b, i) => Math.abs(b - market[i]) < 0.005) && (
        <p className="mt-4 rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-slate">
          Your odds match the market&apos;s. Any position shown comes only from small gaps between Gemini&apos;s quoted prices and its own mid-prices, not from a
          view. Raise a candidate you believe in to see how the position changes.
        </p>
      )}
      <p className="mt-4 text-[13px] text-smoke">Tip: shift-click moves 5 points. Payouts are for your whole position, whoever wins.</p>
    </section>
  );
}
