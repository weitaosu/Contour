"use client";

import { useMemo, useState } from "react";
import { paysIn, type Ladder, type Quote } from "@contour/core";
import { OutcomesChart, sortedOutcomes } from "@/components/charts/OutcomesChart";
import { DistributionChart } from "@/components/charts/DistributionChart";
import { MonteCarloChart } from "@/components/charts/MonteCarloChart";
import { PillChoice } from "@/components/zone/controls";
import { usd } from "@/lib/format";

/**
 * Test page: what the position makes across 100 equally likely outcomes, worst to best, against the
 * regular bet (the whole stake on the single best contract). Odds from your view or the market's.
 */
export function OutcomesPanel({ ladder, quote, stake, belief }: { ladder: Ladder; quote: Omit<Quote, "raw">; stake: number; belief: number[] | null }) {
  // Market's odds by default, so this matches "vs betting on one contract"; your view is one click away.
  const [odds, setOdds] = useState<"you" | "market">("market");
  const [hover, setHover] = useState<number | null>(null);
  const probs = odds === "you" && belief ? belief : ladder.marketProb;

  const contourProfit = quote.payoutByBucket.map((p) => p - stake);
  const cmp = quote.comparison;
  const cmpIndex = cmp ? ladder.instruments.findIndex((i) => i.symbol === cmp.symbol) : -1;
  const regularProfit =
    cmp && cmpIndex >= 0 ? quote.payoutByBucket.map((_, j) => (paysIn(ladder, cmpIndex, cmp.side, j) ? cmp.qty : 0) - (cmp.qty * cmp.price + cmp.fee)) : null;

  const contour = useMemo(() => sortedOutcomes(contourProfit, probs), [contourProfit.join(","), probs]); // eslint-disable-line react-hooks/exhaustive-deps
  const regular = useMemo(() => (regularProfit ? sortedOutcomes(regularProfit, probs) : null), [regularProfit?.join(","), probs]); // eslint-disable-line react-hooks/exhaustive-deps

  const wins = (v: number[]) => v.filter((x) => x > 0.005).length;
  // Wins in 100 under both sets of odds, so a view far from the market can't hide behind the toggle.
  const both = useMemo(() => {
    const w = (profit: number[] | null, pr: readonly number[]) => (profit ? Math.round(100 * profit.reduce((a, v, j) => a + (v > 0.005 ? pr[j] : 0), 0)) : null);
    return {
      contour: { market: w(contourProfit, ladder.marketProb), you: belief ? w(contourProfit, belief) : null },
      regular: { market: w(regularProfit, ladder.marketProb), you: belief && regularProfit ? w(regularProfit, belief) : null },
    };
  }, [contourProfit.join(","), regularProfit?.join(","), belief, ladder.marketProb]); // eslint-disable-line react-hooks/exhaustive-deps
  // The regular bet's contract: your chance against the market's. Flag a big gap (3x, or 15 points).
  const gap =
    cmp && cmpIndex >= 0 && belief
      ? (() => {
          const you = ladder.marketProb.reduce((a, _, j) => a + (paysIn(ladder, cmpIndex, cmp.side, j) ? belief[j] : 0), 0);
          const mkt = ladder.marketProb.reduce((a, p, j) => a + (paysIn(ladder, cmpIndex, cmp.side, j) ? p : 0), 0);
          const far = you > 0.02 && (you >= 3 * mkt || you - mkt >= 0.15);
          return far ? { you, mkt } : null;
        })()
      : null;
  const avg = (v: number[]) => v.reduce((a, x) => a + x, 0) / v.length;
  const stats = (v: number[]) => ({ wins: wins(v), worst: Math.min(...v), best: Math.max(...v), avg: avg(v) });
  const C = stats(contour);
  const R = regular ? stats(regular) : null;
  // The same numbers straight from the buckets, for the distribution cards.
  const chance = (profit: number[] | null, test: (v: number) => boolean) => (profit ? profit.reduce((a, v, j) => a + (test(v) ? probs[j] : 0), 0) : 0);
  const typicalWin = (profit: number[] | null) => {
    if (!profit) return 0;
    const rows = profit.map((v, j) => ({ v, p: probs[j] })).filter((r) => r.v > 0.005).sort((a, b) => a.v - b.v);
    const tot = rows.reduce((a, r) => a + r.p, 0);
    let c = 0;
    for (const r of rows) {
      c += r.p;
      if (c >= tot / 2) return r.v;
    }
    return 0;
  };
  const loseAll = (v: number) => v <= -stake * 0.99;
  const contourRet = contourProfit.map((v) => v / stake);
  const regularRet = regularProfit ? regularProfit.map((v) => v / stake) : null;
  const signed = (n: number) => `${n > 0.004 ? "+" : n < -0.004 ? "−" : ""}${usd(Math.abs(n))}`;

  const card = (label: string, c: string, r: string | null) => (
    <div key={label} className="rounded-[14px] bg-porcelain p-2.5">
      <p className="text-[12.5px] text-smoke">{label}</p>
      <p className="tnum text-[20px] font-bold text-inkstone">
        {c} {r !== null && <span className="text-[13px] font-normal text-slate">vs {r}</span>}
      </p>
    </div>
  );
  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-slate">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0 w-4 border-t-[2.5px] border-signal-violet" /> Contour
      </span>
      {cmp && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0 w-4 border-t-[2.5px] border-dashed border-slate" /> Regular bet: all {usd(stake, 0)} on {cmp.side.toUpperCase()} {cmp.label}
        </span>
      )}
      <span>Odds: {odds === "you" ? "your view" : "the market's"}</span>
    </div>
  );

  return (
    <section aria-labelledby="outcomes-title" className="min-w-0 rounded-[24px] bg-cloud p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="outcomes-title" className="text-[16px] font-bold leading-tight text-inkstone">
            How the two bets compare
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-slate">Contour against the regular bet (the whole stake on the single best contract), for the same {usd(stake, 0)}.</p>
        </div>
        <div className="w-[260px]">
          <PillChoice
            label="Whose odds"
            options={[
              { value: "you", label: "Your view", disabled: !belief },
              { value: "market", label: "Market's odds" },
            ]}
            value={odds}
            onChange={setOdds}
          />
        </div>
      </header>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {(
          [
            ["Contour", both.contour, "text-signal-violet"],
            ["Regular bet", both.regular, "text-graphite"],
          ] as const
        ).map(([name, w, cls]) =>
          w.market === null ? null : (
            <p key={name} className="tnum rounded-[14px] bg-porcelain px-3 py-2 text-[14px] text-slate">
              <b className={cls}>{name}</b> wins <b className="text-inkstone">{w.market} in 100</b> by the market&apos;s odds
              {w.you !== null && (
                <>
                  , <b className="text-inkstone">{w.you} in 100</b> by your view
                </>
              )}
            </p>
          ),
        )}
      </div>
      {gap && cmp && (
        <p className="mt-2 rounded-[14px] bg-porcelain px-3 py-2 text-[13.5px] text-slate">
          <b className="text-inkstone">Your view is far from the market here.</b> You give {cmp.side.toUpperCase()} &ldquo;{cmp.label}&rdquo; a{" "}
          <b className="text-inkstone">{Math.round(gap.you * 100)}%</b> chance; the market says <b className="text-inkstone">{Math.max(1, Math.round(gap.mkt * 100))}%</b>
          {gap.mkt > 0 ? ` (${(gap.you / gap.mkt).toFixed(gap.you / gap.mkt >= 10 ? 0 : 1)}× more likely)` : ""}. Most of what &ldquo;your view&rdquo; shows comes from that gap.
        </p>
      )}

      {/* 1. every outcome, worst to best */}
      <div className="mt-3 rounded-[18px] bg-porcelain px-3 pb-3 pt-3">
        <p className="text-[14px] font-bold text-inkstone">Every outcome, worst to best</p>
        <p className="mb-1 text-[12.5px] text-slate">The gap between the lines is the trade: green is money you don&apos;t lose, grey is upside you give up. Each area is its average in dollars.</p>
        {legend}
        <p className="tnum mt-1 min-h-[20px] text-[13px] text-slate">
          {hover !== null ? (
            <>
              At {hover}% of outcomes: Contour <b className="text-inkstone">{signed(contour[hover])}</b>
              {regular && (
                <>
                  {" "}· regular bet <b className="text-inkstone">{signed(regular[hover])}</b>
                </>
              )}
            </>
          ) : (
            "Point at the chart to read it."
          )}
        </p>
        <OutcomesChart contour={contour} regular={regular} stake={stake} hover={hover} onHover={setHover} height={320} />
        <div className="mt-2 grid grid-cols-3 gap-2">
          {card("Chance you win", `${C.wins}%`, R ? `${R.wins}%` : null)}
          {card("Worst case", signed(C.worst), R ? signed(R.worst) : null)}
          {card("Best case", signed(C.best), R ? signed(R.best) : null)}
        </div>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        {/* 2. chance of each result */}
        <div className="min-w-0 rounded-[18px] bg-porcelain px-3 pb-3 pt-3">
          <p className="text-[14px] font-bold text-inkstone">Chance of each result</p>
          <p className="mb-1 text-[12.5px] text-slate">Exact probabilities: profit on the bottom, how likely on the side.</p>
          {legend}
          <DistributionChart contour={contourProfit} regular={regularProfit} probs={probs} stake={stake} height={300} />
          <div className="mt-2 grid grid-cols-3 gap-2">
            {card("Chance you win", `${Math.round(chance(contourProfit, (v) => v > 0.005) * 100)}%`, regularProfit ? `${Math.round(chance(regularProfit, (v) => v > 0.005) * 100)}%` : null)}
            {card("Chance you lose it all", `${Math.round(chance(contourProfit, loseAll) * 100)}%`, regularProfit ? `${Math.round(chance(regularProfit, loseAll) * 100)}%` : null)}
            {card("Typical win", signed(typicalWin(contourProfit)), regularProfit ? signed(typicalWin(regularProfit)) : null)}
          </div>
        </div>

        {/* 3. Monte Carlo */}
        <div className="min-w-0 rounded-[18px] bg-porcelain px-3 pb-3 pt-3">
          <p className="text-[14px] font-bold text-inkstone">20 bets in a row</p>
          <p className="mb-1 text-[12.5px] text-slate">
            Monte Carlo: 3,000 simulated runs of 20 bets, each putting 25% of the bankroll on this position. Lines are the median run, bands the middle 80%.
          </p>
          {legend}
          <MonteCarloChart contourRet={contourRet} regularRet={regularRet} probs={probs} height={300} />
          <p className="mt-2 text-[12.5px] text-slate">
            By the market&apos;s odds both usually shrink a little (spreads and fees). By your view, the steadier bet compounds better even when its average per bet is lower.
          </p>
        </div>
      </div>
    </section>
  );
}
