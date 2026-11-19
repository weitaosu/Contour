"use client";

import { memo, type ReactNode } from "react";
import { paysIn, type Ladder, type Quote } from "@contour/core";
import { GAIN, ProfitChart } from "@/components/charts/ProfitChart";
import { OutcomeBars } from "@/components/charts/OutcomeBars";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { ifItLands, isWin, rangeShort, runs, whenPhrase } from "@/lib/outcomes";
import { pct, usd } from "@/lib/format";
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
  regular = false,
}: {
  ladder: Ladder;
  quote: Omit<Quote, "raw">;
  stake: number;
  /** Whether there's a view behind the position (spreads have none), for the "trust your view more" tip. */
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
  /** Also draw the regular payout: the whole stake on the single best contract (as in "vs betting on one contract"). */
  regular?: boolean;
}) {
  const payouts = quote.payoutByBucket;
  const cmp = regular ? quote.comparison : null;
  const cmpIndex = cmp ? ladder.instruments.findIndex((i) => i.symbol === cmp.symbol) : -1;
  const regularPl =
    cmp && cmpIndex >= 0
      ? payouts.map((_, j) => (paysIn(ladder, cmpIndex, cmp.side, j) ? cmp.qty : 0) - (cmp.qty * cmp.price + cmp.fee))
      : null;
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
          small && hasView && <p className="mt-0.5 text-[13.5px] text-slate">Trust your view more under Confidence for a bigger swing either way.</p>
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
            {regularPl && (
              <span className="text-[13px] text-slate">
                · one contract <span className="font-bold text-inkstone">{signedUsd(regularPl[focus])}</span>
              </span>
            )}
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
                now={now}
                height={h}
                compare={regularPl && cmp ? [{ pl: regularPl, label: `All ${usd(stake, 0)} on ${cmp.side.toUpperCase()} ${cmp.label}` }] : []}
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
          {regularPl && cmp && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-inkstone" /> Regular payout: all {usd(stake, 0)} on {cmp.side.toUpperCase()} {cmp.label}
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
}: {
  ladder: Ladder;
  quote: Omit<Quote, "raw">;
  stake: number;
  /** The user's view; null for positions with no view (spreads), which hides "by yours". */
  belief: number[] | null;
  faded?: boolean;
}) {
  const payouts = quote.payoutByBucket;
  const wins = payouts.map((p) => isWin(p, stake));
  const zones = runs(wins, (w) => w);
  const small = zones.length === 0;
  const best = payouts.indexOf(Math.max(...payouts));
  const chanceMkt = ladder.marketProb.reduce((s, p, j) => s + (wins[j] ? p : 0), 0);
  const chanceYou = belief ? belief.reduce((s, p, j) => s + (wins[j] ? p : 0), 0) : null;
  return (
    <div className={`grid grid-cols-2 gap-2 transition-opacity duration-300 lg:grid-cols-4 ${faded ? "opacity-45" : ""}`}>
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
export const EvNote = memo(function EvNote({ quote, stake, compact = false }: { quote: Omit<Quote, "raw">; stake: number; compact?: boolean }) {
  const ev = quote.evUnderMarket;
  if (compact)
    return (
      <p className="text-[13px] leading-snug text-slate" title="The gap to what you put in is Gemini's fees and buying at the asking price: the cost of trading on your view.">
        Average back if the market&apos;s right: <span className="tnum font-bold text-inkstone">{usd(ev)}</span>
      </p>
    );
  return (
    <p className="text-[14px] text-slate">
      If the market&apos;s odds are right, you&apos;d get back <span className="tnum font-bold text-inkstone">{usd(ev)}</span> on average
      {stake - ev > 0.005 ? (
        <>
          , <span className="tnum">{usd(stake - ev)}</span> less than you put in: <span className="tnum">{usd(quote.feesUsd)}</span> in Gemini fees
          {stake - ev - quote.feesUsd > 0.005 ? (
            <>
              {" "}
              and <span className="tnum">{usd(stake - ev - quote.feesUsd)}</span> from buying at the asking price
            </>
          ) : null}
          . That&apos;s the cost of trading on your view.
        </>
      ) : (
        "."
      )}
    </p>
  );
});

/** "1 in 6": chances people can picture. */
export function oneIn(p: number) {
  if (!(p > 0)) return "never";
  if (p >= 0.5) return `${Math.round(p * 10)} in 10`;
  return `about 1 in ${Math.round(1 / p)}`;
}

/**
 * Where the stake actually goes. A $10 position is not a $10 bet: most of it can sit as cash, and
 * only the contracts plus fees are at risk. Showing the split keeps "risk $1 to make $5" honest.
 */
export const MoneySplit = memo(function MoneySplit({
  quote,
  stake,
  winsWhere,
  chance,
  title,
  bare = false,
  compact = false,
}: {
  quote: Omit<Quote, "raw">;
  stake: number;
  winsWhere: string | null;
  chance: number;
  title?: string;
  /** Without its own box and title, for a tab or panel that already frames it. */
  bare?: boolean;
  /** One short sentence instead of the full explanation, for the one-screen workspace. */
  compact?: boolean;
}) {
  const contracts = quote.legs.reduce((a, l) => a + l.usd, 0);
  // Quotes stored before fees were modeled have no fee fields: treat them as zero rather than NaN.
  const fees = quote.feesUsd ?? 0;
  const cash = quote.cashUsd;
  const atRisk = stake - quote.minPayout;
  const share = (x: number) => `${Math.max(0, (x / stake) * 100)}%`;
  const nContracts = quote.legs.reduce((a, l) => a + l.qty, 0);
  return (
    <div className={bare ? "" : "rounded-[20px] bg-porcelain px-5 py-5 md:px-6"}>
      {!bare && <p className="stat-label">{title ?? `Where your ${usd(stake, 0)} goes`}</p>}
      <div className={`${bare ? "" : "mt-3 "}flex ${compact ? "h-3" : "h-4"} w-full overflow-hidden rounded-full bg-mist`} role="img" aria-label={`${usd(contracts)} contracts, ${usd(fees)} fees, ${usd(cash)} cash`}>
        <span className="h-full bg-signal-violet" style={{ width: share(contracts), transition: "width 420ms cubic-bezier(.2,.8,.2,1)" }} />
        <span className="h-full bg-slate" style={{ width: share(fees), minWidth: fees > 0 ? 3 : 0, transition: "width 420ms cubic-bezier(.2,.8,.2,1)" }} />
      </div>
      <dl className={`grid grid-cols-3 gap-3 ${compact ? "mt-2.5 text-[13.5px]" : "mt-3 text-[14px]"}`}>
        <div>
          <dt className="flex items-center gap-1.5 text-slate">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-signal-violet" /> Contracts
          </dt>
          <dd className="tnum font-bold text-inkstone">{usd(contracts)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-slate">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate" /> {compact ? "Fees" : "Gemini fees"}
          </dt>
          <dd className="tnum font-bold text-inkstone">{quote.feesUsd === undefined ? "not itemized" : usd(fees)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-slate">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-mist ring-1 ring-ash" /> {compact ? "Cash" : "Kept as cash"}
          </dt>
          <dd className="tnum font-bold text-inkstone">{usd(cash)}</dd>
        </div>
      </dl>
      {compact ? (
        <p className="mt-2.5 text-[13.5px] leading-snug text-inkstone">
          {quote.legs.length === 0 ? (
            <>Nothing at risk yet: no contract is worth its price at this view.</>
          ) : (
            <>
              Only <b className="tnum">{usd(atRisk)}</b> is at risk, a bet that wins <b className="tnum">{oneIn(chance)}</b> times; the cash comes back regardless.
            </>
          )}
        </p>
      ) : quote.legs.length === 0 ? (
        <p className="mt-3 text-[14px] leading-relaxed text-inkstone">
          Nothing is at risk yet: at this view no contract is worth its price, so all <b className="tnum">{usd(cash)}</b> would stay as cash.
        </p>
      ) : (
        <p className="mt-3 text-[14px] leading-relaxed text-inkstone">
          Only <b className="tnum">{usd(atRisk)}</b> is really at risk. The contracts {winsWhere ? <>pay $1 each {winsWhere}</> : <>pay $1 each in their outcomes</>}
          {nContracts > 0 ? <> ({nContracts.toLocaleString("en-US", { maximumFractionDigits: 2 })} in total)</> : null}; the {usd(cash)} in cash comes back to you whatever happens. So this is
          a <b className="tnum">{usd(atRisk)}</b> bet that wins <b className="tnum">{oneIn(chance)}</b> times by the market&apos;s odds.
        </p>
      )}
    </div>
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
