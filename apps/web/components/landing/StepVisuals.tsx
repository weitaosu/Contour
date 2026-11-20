"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { compile, fromMarket, likelyRange, marketMoments, type Ladder } from "@contour/core";
import { desk, type MarketSummary } from "@/lib/desk";
import exampleLadder from "@/lib/example-ladder.json";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { ProfitChart } from "@/components/charts/ProfitChart";
import { Fill } from "@/components/forecast/Panel";
import { oneIn, Tile } from "@/components/forecast/ProfitCard";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { pct, usd, usd0 } from "@/lib/format";
import { isWin, runs, whenPhrase } from "@/lib/outcomes";
import { pickFeatured } from "@/lib/featured";

/**
 * The visuals beside each "How it works" step, built from the app's own pieces and math: the
 * section list, the two charts from inside a market (reshaping through example views, as on the
 * markets page), and the review summary. Live from the desk when it answers; otherwise the saved
 * example ladder, so the section is never blank.
 */

/** Same example views as the markets page preview. */
const VIEWS = [
  { label: "A tighter view", shift: 0, scale: 0.6 },
  { label: "A bullish view", shift: 0.6, scale: 0.8 },
  { label: "A tighter view", shift: 0, scale: 0.6 },
  { label: "A bearish view", shift: -0.6, scale: 0.8 },
];
const BULLISH = 1;
const STAKE = 100;
const EXAMPLE = exampleLadder.ladder as unknown as Ladder;

const useMarkets = () => useQuery({ queryKey: ["markets"], queryFn: desk.markets, staleTime: 60_000, retry: 1 });

/** The featured ladder (a SOL price market when there is one), or the saved example. */
function useLadder(): Ladder | null {
  const markets = useMarkets();
  const ticker = markets.data ? (pickFeatured(markets.data.markets)?.ticker ?? null) : null;
  const ladder = useQuery({ queryKey: ["ladder", ticker], queryFn: () => desk.ladder(ticker!), enabled: ticker !== null, staleTime: 30_000, retry: 1 });
  if (ladder.data) return ladder.data.ladder;
  if (markets.isError || ladder.isError || (markets.data && ticker === null)) return EXAMPLE;
  return null;
}

/** Steps through the example views while `running`; holds still with reduced motion. */
function usePhase(running: boolean) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!running || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const i = setInterval(() => setPhase((p) => (p + 1) % VIEWS.length), 2800);
    return () => clearInterval(i);
  }, [running]);
  return phase;
}

function useView(ladder: Ladder | null, phase: number) {
  return useMemo(() => {
    if (!ladder) return null;
    const spec = VIEWS[phase];
    const belief = fromMarket(ladder, spec.shift * marketMoments(ladder).sd, spec.scale);
    const quote = compile({ ladder, belief, confidence: 1, stakeUsd: STAKE });
    const wins = quote.payoutByBucket.map((p) => isWin(p, STAKE));
    const zones = runs(wins, (w) => w);
    const chance = ladder.marketProb.reduce((s, q, j) => s + (wins[j] ? q : 0), 0);
    const [a, b] = likelyRange(ladder.marketProb, 0.5);
    return { ladder, spec, belief, quote, wins, zones, chance, likely: { from: a, to: b } };
  }, [ladder, phase]);
}

const Placeholder = () => <div className="h-full w-full animate-pulse rounded-[14px] bg-cloud" />;

/** "$1.5M", "$105k", "$3,828": how much a section trades, at a glance. */
const volumeText = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 10_000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v).toLocaleString("en-US")}`;

/** 1 · Every section of Gemini, busiest first, with what traded in the last 24 hours. */
export function SectionsVisual() {
  const q = useMarkets();
  const sections = (q.data?.sections ?? []).slice(0, 8);
  if (!sections.length) return q.isError ? <p className="p-4 text-[14px] text-slate">Live sections appear here when the market data is reachable.</p> : <Placeholder />;
  const max = Math.max(1, ...sections.map((s) => s.volume24h));
  return (
    <div className="flex h-full flex-col">
      <p className="text-[13px] text-smoke">Every section of Gemini, busiest first</p>
      <ul className="mt-3 flex min-h-0 flex-1 flex-col justify-between">
        {sections.map((s, i) => (
          <li key={s.category} className="flex flex-col gap-1.5">
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-bold text-inkstone">{s.category}</span>
              <span className="tnum text-[13.5px] text-smoke">{volumeText(s.volume24h)}</span>
            </span>
            <span className="flex items-center gap-3">
              {/* square-root scale, so a $1k section still shows next to a $100k one */}
              <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-mist">
                <span
                  className="grow-x block h-full rounded-full bg-ash"
                  style={{ width: `${Math.max(3, Math.sqrt(s.volume24h / max) * 100)}%`, animationDelay: `${i * 60}ms` }}
                />
              </span>
              <span className="tnum shrink-0 text-[12.5px] text-slate">
                {s.tradable}/{s.events} tradable
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 2 · The forecast curve, reshaping through example outlooks against the market's (dashed). */
export function OutlookVisual({ running }: { running: boolean }) {
  const ladder = useLadder();
  const view = useView(ladder, usePhase(running));
  const [hover, setHover] = useState<number | null>(null);
  if (!view) return <Placeholder />;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] text-smoke">{view.ladder.category}</p>
          <p className="truncate text-[16px] font-bold leading-tight text-inkstone">{view.ladder.title}</p>
        </div>
        <span key={view.spec.label} className="fade-in shrink-0 rounded-full bg-signal-violet/10 px-3 py-1 text-[13px] font-bold text-signal-violet">
          {view.spec.label}
        </span>
      </div>
      <Fill fallback={260} className="mt-3 min-h-0 flex-1">
        {(h) => (
          <ProbabilityChart
            bucketLabels={view.ladder.bucketLabels}
            cutLabels={view.ladder.cutLabels}
            cuts={view.ladder.cuts}
            market={view.ladder.marketProb}
            you={view.belief}
            hover={hover}
            onHover={setHover}
            height={h}
          />
        )}
      </Fill>
    </div>
  );
}

/** 3 · What $100 makes in every outcome, reshaping with the view, plus the three numbers that matter. */
export function PayoffVisual({ running }: { running: boolean }) {
  const ladder = useLadder();
  const view = useView(ladder, usePhase(running));
  const [hover, setHover] = useState<number | null>(null);
  if (!view) return <Placeholder />;
  const { quote } = view;
  return (
    <div className="flex h-full flex-col">
      <p className="line-clamp-2 text-[14px] font-bold leading-snug text-inkstone sm:text-[15px]">
        {view.zones.length ? (
          <>
            $100 makes money <span className="text-signal-violet">{whenPhrase(view.ladder, view.zones)}</span>
          </>
        ) : (
          "Too close to the market to trade"
        )}
      </p>
      <Fill fallback={220} className="mt-2 min-h-0 flex-1">
        {(h) => (
          <ProfitChart
            pl={quote.payoutByBucket.map((p) => p - STAKE)}
            wins={view.wins}
            stake={STAKE}
            hover={hover}
            onHover={setHover}
            cutLabels={view.ladder.cutLabels}
            bucketLabels={view.ladder.bucketLabels}
            cuts={view.ladder.cuts}
            likely={view.likely}
            likelyBracket={false}
            height={h}
          />
        )}
      </Fill>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-[14px] bg-cloud px-2.5 py-2 sm:px-3">
          <p className="text-[9.5px] uppercase leading-tight tracking-[0.04em] text-smoke sm:text-[11px] sm:tracking-[0.075em]">Really at risk</p>
          <p className="tnum mt-0.5 text-[15px] font-bold sm:text-[17px] text-inkstone">
            <AnimatedNumber value={STAKE - quote.minPayout} format={usd0} />
          </p>
        </div>
        <div className="rounded-[14px] bg-cloud px-2.5 py-2 sm:px-3">
          <p className="text-[9.5px] uppercase leading-tight tracking-[0.04em] text-smoke sm:text-[11px] sm:tracking-[0.075em]">Most you can make</p>
          <p className="tnum mt-0.5 text-[15px] font-bold sm:text-[17px] text-gain">
            +<AnimatedNumber value={quote.maxPayout - STAKE} format={usd0} />
          </p>
        </div>
        <div className="rounded-[14px] bg-cloud px-2.5 py-2 sm:px-3">
          <p className="text-[9.5px] uppercase leading-tight tracking-[0.04em] text-smoke sm:text-[11px] sm:tracking-[0.075em]">Chance of profit</p>
          <p className="tnum mt-0.5 text-[15px] font-bold sm:text-[17px] text-inkstone">
            {pct(view.chance)} <span className="hidden text-[12px] font-medium text-slate sm:inline">{oneIn(view.chance)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

const dollars = (n: number) => usd(n, Math.abs(n) >= 100 ? 0 : 2);
const settles = (iso: string) =>
  `${new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`;

/** 4 · The review summary, simplified: when you make money, and the four numbers you sign for. */
export function ReviewVisual() {
  const ladder = useLadder();
  const view = useView(ladder, BULLISH);
  if (!view) return <Placeholder />;
  const { quote } = view;
  // As in the review dialog: whatever isn't spent on contracts or fees stays yours in every outcome.
  const kept = quote.cashUsd;
  const pay = STAKE - kept;
  return (
    <div className="flex h-full flex-col sm:justify-center">
      <p className="text-[18px] font-bold sm:text-[20px] leading-tight text-inkstone">{view.ladder.title}</p>
      <p className="mt-1 text-[13.5px] text-slate">Settles {settles(view.ladder.expiry)}</p>
      <p className="mt-4 rounded-[18px] bg-porcelain px-5 py-3 text-[16px] font-bold leading-snug text-inkstone shadow-[0_0_0_1.5px_rgba(96,66,245,0.28),0_12px_32px_-14px_rgba(96,66,245,0.45)]">
        {view.zones.length ? (
          <>
            You make money <span className="text-signal-violet">{whenPhrase(view.ladder, view.zones)}</span>.
          </>
        ) : (
          <>At this setting your money barely moves.</>
        )}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-[20px] bg-cloud p-1.5">
        <Tile compact label="You pay" value={usd(pay)} sub={kept > 0.005 ? `of your ${usd(STAKE)}` : "test USDC"} />
        <Tile compact label="Best case" value={<span className="text-gain">+{dollars(quote.maxPayout - STAKE)}</span>} sub={`${usd(quote.maxPayout - kept)} paid out`} />
        <Tile compact label="Worst case" value={`−${dollars(STAKE - quote.minPayout)}`} sub={`${usd(quote.minPayout - kept)} paid back`} />
        <Tile compact label="Chance of profit" value={pct(view.chance)} sub="by the market's odds" />
      </div>
    </div>
  );
}
