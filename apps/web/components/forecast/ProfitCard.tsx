"use client";

import { memo, type ReactNode } from "react";
import type { Ladder, Quote } from "@contour/core";
import { GAIN, ProfitChart } from "@/components/charts/ProfitChart";
import { OutcomeBars } from "@/components/charts/OutcomeBars";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { ifItLands, isWin, rangeShort, runs, whenPhrase } from "@/lib/outcomes";
import { notableUnused, pct, usd } from "@/lib/format";
import { Fill } from "./Panel";

const dollars = (n: number) => usd(n, Math.abs(n) >= 100 ? 0 : 2);
const signedUsd = (n: number) => `${n > 0.004 ? "+" : n < -0.004 ? "−" : ""}${usd(Math.abs(n))}`;

/**
 * Said in place of the usual headline when there's no trade to show: before any view is picked, or
 * when the view is too close to the market's. The chart stays (faded) so the panel never changes
 * shape under a curve that's being dragged.
 */
export interface SummaryStatus {
  title: string;
  detail?: ReactNode;
}

/**
 * "What you make": the position in one plain sentence, a readout of one outcome, and the profit
 * chart. Memoized: it's the heaviest panel, and while a curve is being dragged the screen
 * re-renders every frame with these inputs unchanged until the position is re-solved.
 */
export const ProfitSummary = memo(function ProfitSummary({
  ladder,
  quote,
  stake,
  hasView,
  hover,
  onHover,
  likely,
  note,
  now = null,
  status = null,
  live = false,
}: {
  ladder: Ladder;
  quote: Omit<Quote, "raw">;
  stake: number;
  /** Whether the view could be followed more closely (not a spread, not already 100%), for the tip. */
  hasView: boolean;
  hover: number | null;
  onHover: (j: number | null) => void;
  likely: { from: number; to: number } | null;
  /** One extra line under the headline (e.g. how a spread pays). */
  note?: string;
  /** The underlying's live price, marked on the chart. */
  now?: { value: number; label: string } | null;
  status?: SummaryStatus | null;
  /** The view is being dragged (see ProfitChart). */
  live?: boolean;
}) {
  const payouts = quote.payoutByBucket;
  const pl = payouts.map((p) => p - stake);
  const wins = payouts.map((p) => isWin(p, stake));
  const zones = runs(wins, (w) => w);
  const small = zones.length === 0;
  const likeliest = ladder.marketProb.indexOf(Math.max(...ladder.marketProb));
  // With a live price, the default reading is "if it ends where it is now", like a brokerage P/L
  // chart; otherwise the outcome the market rates likeliest.
  const nowBucket = now && ladder.cuts ? ladder.cuts.filter((c) => now.value >= c).length : null;
  const focus = hover ?? nowBucket ?? likeliest;
  const focusPl = pl[focus];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {/* the one-sentence answer */}
      <div>
        <p id="pl-headline" className="text-[18px] font-bold leading-snug text-inkstone xl:text-[19px]" aria-live="polite">
          <span
            key={live ? "live" : status ? status.title : small ? `s${Math.round(quote.minPayout)}-${Math.round(quote.maxPayout)}` : whenPhrase(ladder, zones)}
            className={live ? "" : "text-swap"}
          >
          {status ? (
            status.title
          ) : small ? (
            <>
              Your money barely moves at this confidence: you end with{" "}
              <span className="tnum text-signal-violet">
                {dollars(quote.minPayout)} to {dollars(quote.maxPayout)}
              </span>
              .
            </>
          ) : (
            <>
              You make money <span className="text-signal-violet">{whenPhrase(ladder, zones)}</span>.
            </>
          )}
          </span>
        </p>
        {status?.detail ? (
          <div className="mt-0.5 text-[13.5px] text-slate">{status.detail}</div>
        ) : (
          small && hasView && <p className="mt-0.5 text-[13.5px] text-slate">Follow your view more closely for a bigger swing either way.</p>
        )}
        {note && <p className="mt-1 text-[14px] text-slate">{note}</p>}
      </div>

      {/* readout + chart: faded while there's no trade, back as soon as there is */}
      <div className={`flex min-h-0 flex-1 flex-col rounded-[18px] bg-cloud px-3 pb-2 pt-2.5 transition-opacity duration-300 md:px-4 ${status ? "opacity-45" : ""}`}>
        {/* One outcome read out: where it is now by default, or whichever bar you point at. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <p className="min-w-0 truncate text-[13.5px] text-slate">
            {hover === null && nowBucket !== null ? (
              <>
                If it ends at today&apos;s <span className="tnum font-bold text-inkstone">{now!.label}</span>
              </>
            ) : (
              <>
                {hover === null && <span className="text-smoke">Most likely · </span>}
                {ifItLands(ladder, focus)}
              </>
            )}
          </p>
          <p className="tnum flex items-baseline gap-2">
            <span className={`text-[22px] font-bold leading-none ${focusPl > 0.004 ? "text-gain" : "text-inkstone"}`}>
              <AnimatedNumber value={focusPl} format={signedUsd} />
            </span>
            <span className="text-[13px] text-slate">{usd(payouts[focus])} back</span>
          </p>
        </div>
        {ladder.cuts ? (
          <Fill fallback={160} className="mt-1 h-[220px] lg:h-auto lg:min-h-[150px] lg:flex-1">
            {(h) => (
              <ProfitChart
                pl={pl}
                wins={wins}
                stake={stake}
                hover={hover}
                onHover={onHover}
                cutLabels={ladder.cutLabels}
                bucketLabels={ladder.bucketLabels}
                likely={likely}
                likelyBracket={false}
                live={live}
                cuts={ladder.cuts}
                height={h}
              />
            )}
          </Fill>
        ) : (
          <div className="mt-2 flex min-h-0 flex-1 flex-col">
            <OutcomeBars
              labels={ladder.bucketLabels}
              pl={pl}
              wins={wins}
              order={ladder.marketProb.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)}
              hover={hover}
              onHover={onHover}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[12.5px] text-slate" title={ladder.cuts ? "Point at a bar to read it" : "Point at an outcome"}>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: GAIN }} /> You make money
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-ash" /> You get back less
          </span>
          {ladder.cuts && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-0 border-l-[1.5px] border-dashed border-slate" /> Break-even
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

/** The four numbers people ask first: best case, worst case, where it pays, and how likely that is. */
export const KeyNumbers = memo(function KeyNumbers({
  ladder,
  quote,
  stake,
  belief,
  faded = false,
  square = false,
}: {
  ladder: Ladder;
  quote: Omit<Quote, "raw">;
  stake: number;
  /** The user's view; null for positions with no view (spreads), which hides "by yours". */
  belief: number[] | null;
  faded?: boolean;
  /** Two by two at every width (beside another panel), instead of one row of four on wide screens. */
  square?: boolean;
}) {
  const payouts = quote.payoutByBucket;
  const wins = payouts.map((p) => isWin(p, stake));
  const zones = runs(wins, (w) => w);
  const small = zones.length === 0;
  const best = payouts.indexOf(Math.max(...payouts));
  const chanceMkt = ladder.marketProb.reduce((s, p, j) => s + (wins[j] ? p : 0), 0);
  const chanceYou = belief ? belief.reduce((s, p, j) => s + (wins[j] ? p : 0), 0) : null;
  return (
    <div className={`grid grid-cols-2 gap-2 transition-opacity duration-300 ${square ? "h-full auto-rows-fr" : "lg:grid-cols-4"} ${faded ? "opacity-45" : ""}`}>
      <Tile
        compact
        label="Most you can make"
        value={<span className="text-gain">{signedUsd(quote.maxPayout - stake)}</span>}
        sub={ladder.cuts ? `if it lands ${rangeShort(ladder, best, best)}` : `if ${ladder.bucketLabels[best]} wins`}
      />
      <Tile compact label="Most you can lose" value={signedUsd(quote.minPayout - stake)} sub={`you keep at least ${dollars(quote.minPayout)}`} />
      <Tile
        compact
        label="Profit zone"
        value={small ? "None" : <span className={zones.length > 1 ? "text-[16px]" : ""}>{zones.map(([a, b]) => rangeShort(ladder, a, b)).join(" or ")}</span>}
        sub={small ? "gains are under 1%" : `${wins.filter(Boolean).length} of ${wins.length} outcomes`}
      />
      <Tile
        compact
        label="Chance of profit"
        value={
          <span className="flex items-center gap-3">
            {pct(chanceMkt)}
            <Meter p={chanceMkt} you={chanceYou} />
          </span>
        }
        sub={
          <>
            {oneIn(chanceMkt).replace(/^about /, "")} by the market
            {chanceYou !== null && (
              <>
                {" "}
                · <span className="font-bold text-signal-violet">{pct(chanceYou)}</span> yours
              </>
            )}
          </>
        }
      />
    </div>
  );
});

/** "If the market's odds are right": the average outcome, and what fees and spreads cost. */
/** "1 in 6": chances people can picture. */
export function oneIn(p: number) {
  if (!(p > 0)) return "never";
  if (p >= 0.5) return `${Math.round(p * 10)} in 10`;
  return `about 1 in ${Math.round(1 / p)}`;
}

/**
 * What to expect: the average result if your view is right, and if the market's is (the cost of
 * trading), plus how much of the amount the closest match to the view actually uses.
 */
export const Expectation = memo(function Expectation({
  quote,
  stake,
  used,
  hasView,
  confidence,
}: {
  quote: Omit<Quote, "raw">;
  /** The amount the user set. */
  stake: number;
  /** What the position actually takes from it (the rest isn't needed). */
  used: number;
  /** Spreads carry no view of their own, so there's no "if your view is right" line. */
  hasView: boolean;
  /** How closely the view is followed (null when there's no view): below 1 it puts in less on purpose. */
  confidence: number | null;
}) {
  if (!quote.legs.length) return <p className="text-[13.5px] leading-snug text-slate">Nothing to buy at this view yet, so nothing is used.</p>;
  const ifYou = quote.evUnderBelief - stake;
  const ifMarket = quote.evUnderMarket - stake;
  const spread = Math.max(0, -ifMarket - quote.feesUsd);
  const rows: [string, React.ReactNode, React.ReactNode][] = [
    ...(hasView
      ? [
          [
            "If your view is right",
            <span key="v" className={ifYou > 0.005 ? "text-gain" : ""}>
              {signedUsd(ifYou)}
            </span>,
            "on average, by your odds",
          ] as [string, React.ReactNode, React.ReactNode],
        ]
      : []),
    [
      "If the market is right",
      signedUsd(ifMarket),
      <>
        {usd(quote.feesUsd)} Gemini fees{spread >= 0.005 ? <> + {usd(spread)} paying the ask</> : null}
      </>,
    ],
    ["Amount used", usd(used), notableUnused(stake - used)
        ? confidence !== null && confidence < 1
          ? `of your ${usd(stake, 0)}: following your view at ${pct(confidence)} puts in less`
          : `of your ${usd(stake, 0)}: the closest match to your view needs no more`
        : `all of your ${usd(stake, 0)}`,
    ],
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2.5 text-[13.5px]">
      {rows.map(([label, value, sub]) => (
        <div key={label} className="contents">
          <dt className="min-w-0 leading-snug">
            <span className="block text-inkstone">{label}</span>
            <span className="block text-[12.5px] text-slate">{sub}</span>
          </dt>
          <dd className="tnum text-right text-[17px] font-bold leading-tight text-inkstone">{value}</dd>
        </div>
      ))}
    </dl>
  );
});


export function Tile({ label, value, sub, compact = false }: { label: string; value: React.ReactNode; sub: React.ReactNode; compact?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col rounded-[18px] bg-porcelain ${compact ? "px-4 py-2" : "gap-1 px-5 py-4"}`}>
      <span className={compact ? "text-[11.5px] uppercase leading-tight tracking-[0.075em] text-smoke" : "stat-label"}>{label}</span>
      <span className={`tnum font-bold leading-tight text-inkstone ${compact ? "text-[19px]" : "text-[24px]"}`}>{value}</span>
      <span className={`leading-snug text-slate ${compact ? "line-clamp-2 text-[12.5px]" : "text-[13px]"}`}>{sub}</span>
    </div>
  );
}

/** Chance meter: grey fill for the market's odds, a violet tick at yours. */
function Meter({ p, you }: { p: number; you: number | null }) {
  return (
    <span className="relative block h-[6px] w-full min-w-0 flex-1 overflow-visible rounded-full bg-mist" aria-hidden="true">
      <span className="block h-full rounded-full bg-inkstone" style={{ width: `${Math.round(p * 100)}%`, transition: "width 420ms cubic-bezier(.2,.8,.2,1)" }} />
      {you !== null && (
        <span
          className="absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-full bg-signal-violet"
          style={{ left: `calc(${Math.round(you * 100)}% - 1.5px)`, transition: "left 420ms cubic-bezier(.2,.8,.2,1)" }}
        />
      )}
    </span>
  );
}
