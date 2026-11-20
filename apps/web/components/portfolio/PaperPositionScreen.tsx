"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, ExternalLink } from "lucide-react";
import type { Ladder } from "@contour/core";
import { ProfitChart } from "@/components/charts/ProfitChart";
import { OutcomeBars } from "@/components/charts/OutcomeBars";
import { LiveDot, LivePrice, spotText } from "@/components/forecast/LivePrice";
import { isWin, ifItLands, runs, whenPhrase } from "@/lib/outcomes";
import { usePaperPosition, strategyName } from "@/lib/paper";
import { useLive } from "@/lib/live";
import { cents, pct, settleLabel, untilLabel, usd } from "@/lib/format";
import type { PaperContractResult, PaperPositionDetail } from "@/lib/desk";
import { ValueChart } from "./ValueChart";
import { Activity, pnlPct, signedUsd, tone } from "./PortfolioScreen";
import { TradeTicket } from "./TradeTicket";

/** The stored outcome layout, in the shape the shared outcome-wording helpers read (labels, cuts, unit). */
const qtyText = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const asLadder = (d: PaperPositionDetail) => ({ ...d.ladder, marketProb: d.ladder.marketProb }) as unknown as Ladder;

/**
 * One paper position in full, after a brokerage's position page: what it's worth now and how that's
 * moved, what it pays in each outcome, the contracts behind it valued at the bids, its activity, and a
 * ticket to buy more of the same view or sell part of it.
 */
export function PaperPositionScreen({ id }: { id: string }) {
  const { account, data: d, isError, error, refetch } = usePaperPosition(id);
  const params = useSearchParams();
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(params.get("opened") ? "opened" : null);
  const live = useLive(d?.ticker ?? "", !!d && d.status === "open");
  const spot = live.data?.spot ?? null;

  if (isError)
    return (
      <div className="page py-24">
        <Link href="/me" className="inline-flex items-center gap-1.5 text-[14px] font-bold text-signal-violet">
          <ArrowLeft size={15} /> Portfolio
        </Link>
        <h1 className="title mt-4">This position can&apos;t be shown</h1>
        <p className="mt-4 max-w-xl text-slate">{(error as Error).message}</p>
      </div>
    );
  if (!d || !account)
    return (
      <div className="page py-16">
        <div className="h-5 w-24 rounded-full bg-cloud" />
        <div className="mt-6 h-10 w-[480px] max-w-full rounded-full bg-cloud" />
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="card h-[520px]" />
          <div className="card h-[420px]" />
        </div>
      </div>
    );

  const open = d.status === "open";
  const ladder = asLadder(d);
  // Open: the headline is how it's moved since it was bought, measured from its value at the mark
  // then. The entry cost (fees and half the spread, paid once) is listed beside it, not netted in.
  const boughtAt = d.costUsd - d.entryCostUsd;
  const pnl = open ? d.moveUsd : d.realizedUsd;
  const basis = open ? boughtAt : d.investedUsd;
  const shown = scrub ?? (open ? d.valueUsd : d.returnedUsd);
  const pl = d.schedule.map((s) => s - d.costUsd);
  const wins = d.schedule.map((s) => isWin(s, d.costUsd));
  const zones = runs(wins, (w) => w);
  const chance = d.ladder.marketProb.reduce((s, p, j) => s + (wins[j] ? p : 0), 0);
  const nowMark = spot && d.ladder.kind === "threshold" ? { value: spot.price, label: spot.price >= 1000 ? `$${Math.round(spot.price).toLocaleString("en-US")}` : spotText(spot.price) } : null;
  const nowBucket = nowMark && d.ladder.cuts ? d.ladder.cuts.filter((c) => nowMark.value >= c).length : null;
  const likeliest = d.ladder.marketProb.indexOf(Math.max(...d.ladder.marketProb));
  const focus = hover ?? nowBucket ?? likeliest;
  const name = d.ticker.replace(/\d.*$/, "");
  const order = d.ladder.marketProb.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);

  return (
    <div className="page pb-24 pt-8 md:pt-10">
      <Link href="/me" className="ease inline-flex items-center gap-1.5 text-[14px] font-bold text-signal-violet hover:text-inkstone">
        <ArrowLeft size={15} strokeWidth={2.4} /> Portfolio
      </Link>

      {notice && (
        <div className="fade-up mt-4 flex items-start justify-between gap-4 rounded-[20px] bg-porcelain px-5 py-4 shadow-[0_0_0_1.5px_rgba(26,171,139,0.35)]">
          <p className="flex items-start gap-3 text-inkstone">
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-gain" aria-hidden="true" />
            <span>
              {notice === "opened" ? (
                <>
                  <b>Position opened.</b> {qtyText(d.contracts)} contracts across {d.legs.length} {d.ladder.kind === "threshold" ? (d.legs.length === 1 ? "strike" : "strikes") : d.legs.length === 1 ? "outcome" : "outcomes"} filled at Gemini&apos;s asks
                  for {usd(d.investedUsd)} of paper cash.
                </>
              ) : (
                notice
              )}
            </span>
          </p>
          <button type="button" className="shrink-0 text-[14px] font-bold text-slate hover:text-inkstone" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <header className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">
            {d.category ?? "Market"} · {strategyName[d.strategy]} · Settles {settleLabel(d.expiry)}
            {open && !d.awaiting ? ` · ${untilLabel(d.expiry)}` : ""}
          </p>
          <h1 className="title mt-2">{d.title}</h1>
          {d.viewLabel && <p className="mt-2 text-slate">{d.viewLabel}</p>}
          {d.demo && (
            <p className="mt-2 inline-block rounded-full bg-signal-violet/10 px-3 py-1 text-[13px] font-bold text-signal-violet">
              Demo: a made-up past market, with sample trades and history
            </p>
          )}
          {spot && open && <LivePrice spot={spot} name={name} />}
        </div>
        {!d.demo && (
          <Link href={`/m/${encodeURIComponent(d.ticker)}`} className="btn btn-quiet shrink-0 !py-2 !text-[14px]">
            Open market <ExternalLink size={14} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        )}
      </header>

      <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6 max-lg:contents">
          {/* What it's worth: the number, how it's moved, and its chart */}
          <section className="card min-w-0 max-lg:order-1">
            <p className="stat-label flex items-center gap-3">
              {open ? (d.awaiting ? "Market closed · awaiting result" : "Market value") : d.status === "settled" ? "Paid out at settlement" : "Sold for"}
              {open && d.pricing === "live" && <LiveDot label="" />}
            </p>
            <p className="tnum mt-1 text-[40px] font-bold leading-none text-inkstone md:text-[48px]">{usd(shown)}</p>
            <p className={`tnum mt-2 text-[16px] font-bold ${tone(pnl)}`}>
              {signedUsd(pnl)}
              {pnlPct(pnl, basis)}{" "}
              <span className="font-normal text-smoke">{open ? "since you bought" : `on ${usd(d.investedUsd)} put in`}</span>
            </p>
            {open && d.realizedUsd !== 0 && (
              <p className={`tnum mt-1 text-[14px] ${tone(d.realizedUsd)}`}>{signedUsd(d.realizedUsd)} already booked from partial sales</p>
            )}
            {open && (
              // The rest of the picture: the return after the entry cost, that cost, and what selling would fetch.
              <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-[16px] bg-porcelain px-4 py-3">
                  <dt className="stat-label !text-[12px]">Total return</dt>
                  <dd className={`tnum text-[18px] font-bold ${tone(d.unrealizedUsd)}`}>{signedUsd(d.unrealizedUsd)}</dd>
                  <dd className="text-[12.5px] leading-snug text-slate">on {usd(d.costUsd)} cost, entry cost included</dd>
                </div>
                <div className="rounded-[16px] bg-porcelain px-4 py-3" title="Gemini's buy fee, plus paying the ask rather than the midpoint. Every trade pays it once, on the way in; holding to a win still pays $1 a contract.">
                  <dt className="stat-label !text-[12px]">Entry cost</dt>
                  <dd className="tnum text-[18px] font-bold text-inkstone">{signedUsd(-d.entryCostUsd)}</dd>
                  <dd className="text-[12.5px] leading-snug text-slate">
                    {usd(d.feesPaidUsd)} fees + {usd(Math.max(0, d.entryCostUsd - d.feesPaidUsd))} spread, paid once
                  </dd>
                </div>
                <div className="rounded-[16px] bg-porcelain px-4 py-3" title="What selling all of it now would fetch: Gemini's bids, after the sell fee. Not guaranteed; prices move.">
                  <dt className="stat-label !text-[12px]">Cash out now</dt>
                  <dd className="tnum text-[18px] font-bold text-inkstone">{d.cashOutUsd !== null ? usd(d.cashOutUsd) : "no bid"}</dd>
                  <dd className="text-[12.5px] leading-snug text-slate">at the bids, after sell fees</dd>
                </div>
              </dl>
            )}
            {d.pricing === "frozen" && <p className="mt-2 text-[14px] text-slate">Gemini is offline, so this uses its last saved prices and trading is paused.</p>}
            {d.pricing === "none" && open && <p className="mt-2 text-[14px] text-slate">No live price right now, so this is the last recorded value.</p>}
            <div className="mt-5">
              <ValueChart
                points={d.history}
                reference={basis}
                referenceLabel={open ? "Bought at" : "Put in"}
                now={open ? d.valueUsd : d.returnedUsd}
                onScrub={(p) => setScrub(p?.valueUsd ?? null)}
              />
            </div>
          </section>

          {/* If it settles: payout by outcome, with the price now */}
          {d.status !== "closed" && (
            <section className="card min-w-0 max-lg:order-3">
              <p className="eyebrow">{d.status === "settled" ? "How it settled" : "If it settles"}</p>
              <p className="mt-2 text-[20px] font-bold leading-snug text-inkstone md:text-[22px]">
                {d.status === "settled" ? (
                  <>
                    It settled on <span className="text-signal-violet">{d.outcomeLabel ?? "the result"}</span>, paying {usd(d.payoutUsd ?? 0)}.
                  </>
                ) : zones.length ? (
                  <>
                    You make money <span className="text-signal-violet">{whenPhrase(ladder, zones)}</span>.
                  </>
                ) : (
                  <>It pays back {usd(Math.min(...d.schedule))} to {usd(Math.max(...d.schedule))}, whatever happens.</>
                )}
              </p>
              {open && (
                <p className="mt-1 text-slate">
                  {pct(chance)} chance of a profit by the market&apos;s odds now · pays {usd(Math.min(...d.schedule))} to {usd(Math.max(...d.schedule))}
                </p>
              )}
              {open && (
                <div className="-mx-2 mt-5 rounded-[24px] bg-porcelain px-4 pb-3 pt-4 sm:mx-0 md:px-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <p className="text-[14px] text-slate">
                      {hover === null ? <span className="text-smoke">{nowBucket !== null ? `Price now ${nowMark!.label} · ` : "Most likely · "}</span> : null}
                      {ifItLands(ladder, focus)}
                    </p>
                    <p className="tnum">
                      <span className={`text-[24px] font-bold ${pl[focus] > 0.004 ? "text-gain" : "text-inkstone"}`}>{signedUsd(pl[focus])}</span>
                      <span className="ml-2 text-[14px] text-slate">pays {usd(d.schedule[focus])}</span>
                    </p>
                  </div>
                  <div className="mt-3">
                    {d.ladder.cuts ? (
                      <ProfitChart
                        pl={pl}
                        wins={wins}
                        stake={d.costUsd}
                        hover={hover}
                        onHover={setHover}
                        cutLabels={d.ladder.cutLabels}
                        bucketLabels={d.ladder.bucketLabels}
                        cuts={d.ladder.cuts}
                        height={240}
                      />
                    ) : (
                      <OutcomeBars labels={d.ladder.bucketLabels} pl={pl} wins={wins} order={order} hover={hover} onHover={setHover} />
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Closed or settled: how each contract ended */}
          {!open && d.contractResults.length > 0 && <ContractResults d={d} />}

          {/* The contracts behind it */}
          {d.legs.length > 0 && (
            <section className="card min-w-0 max-lg:order-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="card-title">
                  What you hold: {qtyText(d.contracts)} contracts on {d.legs.length} {d.ladder.kind === "threshold" ? (d.legs.length === 1 ? "strike" : "strikes") : d.legs.length === 1 ? "outcome" : "outcomes"}
                </h2>
                <span className="text-[13px] text-smoke">valued at the mark, the midpoint of bid and ask</span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[620px] text-[14px]">
                  <thead>
                    <tr className="text-left text-[12.5px] text-smoke">
                      <th className="pb-2 font-medium">Contract</th>
                      <th className="pb-2 text-right font-medium">Qty</th>
                      <th className="pb-2 text-right font-medium">Avg price</th>
                      <th className="pb-2 text-right font-medium" title="Gemini's bid / ask right now">Bid / ask</th>
                      <th className="pb-2 text-right font-medium">Mark</th>
                      <th className="pb-2 text-right font-medium">Value</th>
                      <th className="pb-2 text-right font-medium">Return</th>
                    </tr>
                  </thead>
                  <tbody className="text-inkstone">
                    {d.legs.map((l) => (
                      <tr key={`${l.symbol}-${l.side}`} className="border-t border-mist">
                        <td className="py-2">
                          <span className="mr-1.5 rounded-full bg-mist px-1.5 py-px text-[11px] font-bold">{l.side.toUpperCase()}</span>
                          {l.label}
                        </td>
                        <td className="tnum py-2 text-right">{l.qty.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                        <td className="tnum py-2 text-right text-slate">{cents(l.avgPrice)}</td>
                        <td className="tnum py-2 text-right text-slate">
                          {l.bid !== null ? cents(l.bid) : "—"} / {l.ask !== null ? cents(l.ask) : "—"}
                        </td>
                        <td className="tnum py-2 text-right">{l.mark !== null ? cents(l.mark) : "—"}</td>
                        <td className="tnum py-2 text-right font-bold">{l.valueUsd !== null ? usd(l.valueUsd) : "—"}</td>
                        <td className={`tnum py-2 text-right font-bold ${l.pnlUsd !== null ? tone(l.pnlUsd) : "text-slate"}`}>{l.pnlUsd !== null ? signedUsd(l.pnlUsd) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[13px] text-slate">
                Each contract pays $1 if its side wins. Bought for {usd(d.legs.reduce((s, l) => s + l.costUsd, 0))}, including {usd(d.legs.reduce((s, l) => s + l.feesUsd, 0))} in Gemini fees
                {d.cashInPositionUsd > 0.004 ? `, plus ${usd(d.cashInPositionUsd)} held as cash` : ""}.
              </p>
            </section>
          )}

          <section className="min-w-0 max-lg:order-5">
            <h2 className="card-title mb-3">Activity</h2>
            <Activity trades={d.trades} showTitle={false} />
          </section>
        </div>

        <div className="min-w-0 max-lg:order-2 lg:sticky lg:top-[96px]">
          <TradeTicket
            account={account}
            position={d}
            onDone={(msg) => {
              setNotice(msg);
              refetch();
            }}
          />
        </div>
      </div>
    </div>
  );
}

const resultText = (c: PaperContractResult) =>
  c.result === "won"
    ? "Won · $1 each"
    : c.result === "lost"
      ? "Lost · $0"
      : c.result === "sold"
        ? `Sold at ${cents(c.avgSellPrice ?? 0)}`
        : c.result === "mixed"
          ? `Sold ${qtyText(c.soldQty)} at ${cents(c.avgSellPrice ?? 0)}, ${qtyText(c.settledQty)} ${c.won ? "won" : "lost"}`
          : "Still held";

/** A closed or settled position, contract by contract: what each cost, how it ended, and what it paid back. */
function ContractResults({ d }: { d: PaperPositionDetail }) {
  const rows = d.contractResults;
  const settled = d.status === "settled";
  const won = rows.filter((c) => c.result === "won" || (c.result === "mixed" && c.won)).length;
  return (
    <section className="card min-w-0 max-lg:order-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="card-title">{settled ? "How each contract settled" : "How each contract closed"}</h2>
        <span className="text-[13px] text-smoke">
          {settled ? `${won} of ${rows.length} won${d.outcomeLabel ? ` on ${d.outcomeLabel}` : ""}` : `all ${rows.length} sold`}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] text-[14px]">
          <thead>
            <tr className="text-left text-[12.5px] text-smoke">
              <th className="pb-2 font-medium">Contract</th>
              <th className="pb-2 text-right font-medium">Bought</th>
              <th className="pb-2 text-right font-medium">Cost</th>
              <th className="pb-2 font-medium pl-6">Result</th>
              <th className="pb-2 text-right font-medium">Paid back</th>
              <th className="pb-2 text-right font-medium">Return</th>
            </tr>
          </thead>
          <tbody className="text-inkstone">
            {rows.map((c) => {
              const good = c.result === "won" || (c.result === "sold" && c.pnlUsd > 0);
              return (
                <tr key={`${c.symbol}-${c.side}`} className="border-t border-mist">
                  <td className="py-2">
                    <span className="mr-1.5 rounded-full bg-mist px-1.5 py-px text-[11px] font-bold">{c.side.toUpperCase()}</span>
                    {c.label}
                  </td>
                  <td className="tnum py-2 text-right text-slate">
                    {qtyText(c.qty)} at {cents(c.avgPrice)}
                  </td>
                  <td className="tnum py-2 text-right">{usd(c.costUsd)}</td>
                  <td className="py-2 pl-6">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[12.5px] font-bold ${
                        c.result === "won" ? "bg-gain/15 text-gain" : c.result === "lost" ? "bg-mist text-slate" : good ? "bg-gain/10 text-gain" : "bg-mist text-inkstone"
                      }`}
                    >
                      {resultText(c)}
                    </span>
                  </td>
                  <td className="tnum py-2 text-right font-bold">{usd(c.returnedUsd)}</td>
                  <td className={`tnum py-2 text-right font-bold ${tone(c.pnlUsd)}`}>{signedUsd(c.pnlUsd)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[13px] text-slate">
        {settled
          ? "A contract pays $1 if its side matches the result and nothing otherwise; costs include Gemini's buy fees."
          : "Sold at Gemini's bids; what came back is after the sell fee, and costs include the buy fee."}{" "}
        In all: {usd(rows.reduce((a, c) => a + c.costUsd, 0))} in, {usd(rows.reduce((a, c) => a + c.returnedUsd, 0))} back.
      </p>
    </section>
  );
}
