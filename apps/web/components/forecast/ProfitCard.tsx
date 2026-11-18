"use client";

import type { Ladder, Quote } from "@contour/core";
import { GAIN, ProfitChart } from "@/components/charts/ProfitChart";
import { OutcomeBars } from "@/components/charts/OutcomeBars";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { ifItLands, isWin, rangeShort, runs, whenPhrase } from "@/lib/outcomes";
import { pct, usd } from "@/lib/format";

const dollars = (n: number) => usd(n, Math.abs(n) >= 100 ? 0 : 2);
const signedUsd = (n: number) => `${n > 0.004 ? "+" : n < -0.004 ? "−" : ""}${usd(Math.abs(n))}`;

export function ProfitCard({
  ladder,
  quote,
  stake,
  belief,
  hover,
  onHover,
  likely,
  source,
  note,
  now = null,
  asOf = null,
}: {
  ladder: Ladder;
  quote: Omit<Quote, "raw">;
  stake: number;
  /** The user's view; null for positions with no view (spreads), which hides "by yours". */
  belief: number[] | null;
  hover: number | null;
  onHover: (j: number | null) => void;
  likely: { from: number; to: number } | null;
  source: "desk quote" | "preview";
  /** One extra line under the headline (e.g. how a spread pays). */
  note?: string;
  /** The underlying's live price, marked on the chart. */
  now?: { value: number; label: string } | null;
  /** When the chart's prices were taken: it holds still between refreshes while the order ticket stays live. */
  asOf?: string | null;
}) {
  const payouts = quote.payoutByBucket;
  const pl = payouts.map((p) => p - stake);
  const wins = payouts.map((p) => isWin(p, stake));
  const zones = runs(wins, (w) => w);
  const small = zones.length === 0;
  const best = payouts.indexOf(Math.max(...payouts));
  const chanceMkt = ladder.marketProb.reduce((s, p, j) => s + (wins[j] ? p : 0), 0);
  const chanceYou = belief ? belief.reduce((s, p, j) => s + (wins[j] ? p : 0), 0) : null;
  const likeliest = ladder.marketProb.indexOf(Math.max(...ladder.marketProb));
  // With a live price, the default reading is "if it ends where it is now", like a brokerage P/L
  // chart; otherwise the outcome the market rates likeliest.
  const nowBucket = now && ladder.cuts ? ladder.cuts.filter((c) => now.value >= c).length : null;
  const focus = hover ?? nowBucket ?? likeliest;
  const focusPl = pl[focus];
  const ev = quote.evUnderMarket;

  return (
    <section className="card fade-up flex flex-col gap-6" aria-labelledby="pl-headline">
      {/* the one-sentence answer */}
      <div>
        <p className="eyebrow">In plain words</p>
        <p id="pl-headline" className="mt-2 text-[22px] font-bold leading-snug text-inkstone md:text-[26px]" aria-live="polite">
          {small ? (
            <>
              At this confidence your money barely moves: you end with{" "}
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
        </p>
        {small && belief && <p className="mt-1 text-slate">Trust your view more under Confidence for a bigger swing either way.</p>}
        {note && <p className="mt-1 text-slate">{note}</p>}
      </div>

      {/* scrubbed readout */}
      <div className="-mx-2 rounded-[24px] bg-porcelain px-4 pb-3 pt-5 sm:mx-0 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className="text-[14px] text-slate">
              {hover === null ? (
                <span className="text-smoke">{nowBucket !== null ? `Price now ${now!.label} · ` : "Most likely, by the market · "}</span>
              ) : null}
              {ifItLands(ladder, focus)}
            </p>
            <p className={`tnum mt-1 text-[36px] font-bold leading-none md:text-[44px] ${focusPl > 0.004 ? "text-gain" : "text-inkstone"}`}>
              <AnimatedNumber value={focusPl} format={signedUsd} />
            </p>
            <p className="tnum mt-2 text-[14px] text-slate">
              {focusPl >= 0 ? "+" : "−"}
              {pct(Math.abs(focusPl) / stake)} · you get {usd(payouts[focus])} back of your {dollars(stake)}
            </p>
          </div>
          <p className="text-[13px] text-smoke">
            {ladder.cuts ? (
              <>
                <span className="sm:hidden">Tap or slide across the bars</span>
                <span className="hidden sm:inline">Point at a bar, or use ← → keys</span>
              </>
            ) : (
              "Point at an outcome"
            )}
          </p>
        </div>
        <div className="mt-4">
          {!ladder.cuts ? (
            <OutcomeBars
              labels={ladder.bucketLabels}
              pl={pl}
              wins={wins}
              order={ladder.marketProb.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i)}
              hover={hover}
              onHover={onHover}
            />
          ) : (
          <ProfitChart
            pl={pl}
            wins={wins}
            stake={stake}
            hover={hover}
            onHover={onHover}
            cutLabels={ladder.cutLabels}
            bucketLabels={ladder.bucketLabels}
            likely={ladder.cuts ? likely : null}
            cuts={ladder.cuts}
            now={now}
          />
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 pb-1 text-[13px] text-slate">
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-[3px]" style={{ background: GAIN }} /> You make money
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-[3px] bg-ash" /> You get back less
          </span>
          {ladder.cuts && (
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-0 border-l-[1.5px] border-dashed border-slate" /> Break-even
            </span>
          )}
          {now && (
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-0 border-l-[1.5px] border-signal-violet" /> Price now
            </span>
          )}
          <span className="text-smoke">
            · {source}
            {asOf ? ` · prices as of ${asOf}` : ""}
          </span>
        </div>
      </div>

      {/* the four numbers */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile label="Max gain" value={<span className="text-gain">{signedUsd(quote.maxPayout - stake)}</span>} sub={ladder.cuts ? `if it lands ${rangeShort(ladder, best, best)}` : `if ${ladder.bucketLabels[best]} wins`} />
        <Tile label="Max loss" value={signedUsd(quote.minPayout - stake)} sub={`you keep at least ${dollars(quote.minPayout)}`} />
        <Tile
          label="Profit zone"
          value={small ? "None" : <span className={zones.length > 1 ? "text-[20px]" : ""}>{zones.map(([a, b]) => rangeShort(ladder, a, b)).join(" or ")}</span>}
          sub={small ? "gains are under 1%" : `${wins.filter(Boolean).length} of ${wins.length} outcomes`}
        />
        <Tile
          label="Chance of profit"
          value={pct(chanceMkt)}
          sub={
            <>
              <Meter p={chanceMkt} you={chanceYou} />
              <span className="mt-1 block">
                {oneIn(chanceMkt)} by the market
                {chanceYou !== null && (
                  <>
                    {" "}
                    · <span className="font-bold text-signal-violet">{pct(chanceYou)}</span> by yours
                  </>
                )}
              </span>
            </>
          }
        />
      </div>

      <MoneySplit quote={quote} stake={stake} winsWhere={small ? null : whenPhrase(ladder, zones)} chance={chanceMkt} />

      <p className="-mt-2 text-[14px] text-slate">
        If the market&apos;s odds are right, you&apos;d get back <span className="tnum font-bold text-inkstone">{usd(ev)}</span> on average
        {stake - ev > 0.005 ? (
          <>
            , <span className="tnum">{usd(stake - ev)}</span> less than you put in:{" "}
            <span className="tnum">{usd(quote.feesUsd)}</span> in Gemini fees
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
    </section>
  );
}

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
export function MoneySplit({
  quote,
  stake,
  winsWhere,
  chance,
  title,
}: {
  quote: Omit<Quote, "raw">;
  stake: number;
  winsWhere: string | null;
  chance: number;
  title?: string;
}) {
  const contracts = quote.legs.reduce((a, l) => a + l.usd, 0);
  // Quotes stored before fees were modeled have no fee fields: treat them as zero rather than NaN.
  const fees = quote.feesUsd ?? 0;
  const cash = quote.cashUsd;
  const atRisk = stake - quote.minPayout;
  const share = (x: number) => `${Math.max(0, (x / stake) * 100)}%`;
  const nContracts = quote.legs.reduce((a, l) => a + l.qty, 0);
  return (
    <div className="rounded-[20px] bg-porcelain px-5 py-5 md:px-6">
      <p className="stat-label">{title ?? `Where your ${usd(stake, 0)} goes`}</p>
      <div className="mt-3 flex h-4 w-full overflow-hidden rounded-full bg-mist" role="img" aria-label={`${usd(contracts)} contracts, ${usd(fees)} fees, ${usd(cash)} cash`}>
        <span className="h-full bg-signal-violet" style={{ width: share(contracts), transition: "width 420ms cubic-bezier(.2,.8,.2,1)" }} />
        <span className="h-full bg-slate" style={{ width: share(fees), minWidth: fees > 0 ? 3 : 0, transition: "width 420ms cubic-bezier(.2,.8,.2,1)" }} />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-[14px]">
        <div>
          <dt className="flex items-center gap-1.5 text-slate">
            <span className="h-2.5 w-2.5 rounded-full bg-signal-violet" /> Contracts
          </dt>
          <dd className="tnum font-bold text-inkstone">{usd(contracts)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-slate">
            <span className="h-2.5 w-2.5 rounded-full bg-slate" /> Gemini fees
          </dt>
          <dd className="tnum font-bold text-inkstone">{quote.feesUsd === undefined ? "not itemized" : usd(fees)}</dd>
        </div>
        <div>
          <dt className="flex items-center gap-1.5 text-slate">
            <span className="h-2.5 w-2.5 rounded-full bg-mist ring-1 ring-ash" /> Kept as cash
          </dt>
          <dd className="tnum font-bold text-inkstone">{usd(cash)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-[14px] leading-relaxed text-inkstone">
        Only <b className="tnum">{usd(atRisk)}</b> is really at risk. The contracts {winsWhere ? <>pay $1 each {winsWhere}</> : <>pay $1 each in their outcomes</>}
        {nContracts > 0 ? <> ({nContracts.toLocaleString("en-US", { maximumFractionDigits: 2 })} in total)</> : null}; the {usd(cash)} in cash comes back to you whatever happens. So this is
        a <b className="tnum">{usd(atRisk)}</b> bet that wins <b className="tnum">{oneIn(chance)}</b> times by the market&apos;s odds.
      </p>
    </div>
  );
}

export function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[20px] bg-porcelain px-5 py-4">
      <span className="stat-label">{label}</span>
      <span className="tnum text-[24px] font-bold leading-tight text-inkstone">{value}</span>
      <span className="text-[13px] leading-snug text-slate">{sub}</span>
    </div>
  );
}

/** Chance meter: grey fill for the market's odds, a violet tick at yours. */
function Meter({ p, you }: { p: number; you: number | null }) {
  return (
    <span className="relative mt-1 block h-[6px] w-full overflow-visible rounded-full bg-mist" aria-hidden="true">
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
