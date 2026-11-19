"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, ChevronRight, RotateCcw } from "lucide-react";
import { desk, type PaperPortfolio, type PaperPositionSummary, type PaperTrade } from "@/lib/desk";
import { strategyName, usePortfolio } from "@/lib/paper";
import { pct, settleLabel, untilLabel, usd } from "@/lib/format";
import { Segmented } from "@/components/ui/Segmented";
import { LiveDot } from "@/components/forecast/LivePrice";
import { ValueChart } from "./ValueChart";

export const signedUsd = (n: number) => `${n > 0.004 ? "+" : n < -0.004 ? "−" : ""}${usd(Math.abs(n))}`;
export const tone = (n: number) => (n > 0.004 ? "text-gain" : n < -0.004 ? "text-inkstone" : "text-slate");
export const pnlPct = (pnl: number, cost: number) => (cost > 0.004 ? ` (${pnl >= 0 ? "+" : "−"}${pct(Math.abs(pnl) / cost, 1)})` : "");

type Tab = "open" | "closed" | "activity";

/**
 * The paper portfolio in one view, after brokerage and prediction-market apps: the account's value
 * with its chart (Robinhood), a strip of cash, positions value and P&L, then open positions, closed
 * ones and the activity log as tabs (Kalshi). Positions are valued at what they'd sell for now.
 */
/** `embedded`: shown inside the Record tab, under its view switch (less top space). */
export function PortfolioScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const { account, data, isError, error } = usePortfolio();
  const [tab, setTab] = useState<Tab>("open");
  const [scrub, setScrub] = useState<number | null>(null);

  if (isError)
    return (
      <div className="page py-24">
        <p className="eyebrow">Portfolio</p>
        <h1 className="title mt-2">The portfolio can&apos;t load right now</h1>
        <p className="mt-4 max-w-xl text-slate">{(error as Error).message}. The desk may be offline; it retries every few seconds.</p>
      </div>
    );
  if (!data || !account)
    return (
      <div className="page py-16">
        <div className="h-6 w-56 rounded-full bg-cloud" />
        <div className="mt-4 h-12 w-72 rounded-full bg-cloud" />
        <div className="card mt-8 h-[260px]" />
        <div className="card mt-6 h-[320px]" />
      </div>
    );

  const t = data.totals;
  const open = data.positions.filter((p) => p.status === "open");
  const done = data.positions.filter((p) => p.status !== "open");
  const shown = scrub ?? t.totalUsd;
  const change = shown - t.startUsd;
  // The headline P&L: how open positions have moved since they were bought. Entry costs (fees and
  // half the spread, paid once) and closed results sit in the all-time line below it.
  const move = open.reduce((s, p) => s + p.moveUsd, 0);
  const entry = open.reduce((s, p) => s + p.entryCostUsd, 0);
  const openCost = open.reduce((s, p) => s + p.costUsd, 0);

  return (
    <div className={`page pb-24 ${embedded ? "pt-5 md:pt-6" : "pt-10 md:pt-14"}`}>
      <header className="flex flex-col gap-1">
        <p className="eyebrow flex items-center gap-3">
          Paper portfolio <LiveDot label="Valued live" />
        </p>
        <h1 className="tnum mt-1 text-[40px] font-bold leading-none text-inkstone md:text-[52px]">{usd(shown)}</h1>
        {data.demoAt !== null && (
          <p className="mt-1 text-[13px] text-smoke">
            Demo account: the history before {new Date(data.demoAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} and positions tagged Demo are sample data. The
            open positions are real paper trades at today&apos;s prices.
          </p>
        )}
        {scrub !== null ? (
          <p className={`tnum mt-1 text-[16px] font-bold ${tone(change)}`}>
            {signedUsd(change)} ({change >= 0 ? "+" : "−"}
            {pct(Math.abs(change) / t.startUsd, 2)}) <span className="font-normal text-smoke">vs your starting cash, at that point</span>
          </p>
        ) : (
          <>
            <p className={`tnum mt-1 text-[16px] font-bold ${tone(move)}`}>
              {signedUsd(move)}
              {pnlPct(move, openCost)} <span className="font-normal text-smoke">since you bought</span>
            </p>
            <p className="tnum text-[14px] text-slate">
              All time {signedUsd(change)} ({change >= 0 ? "+" : "−"}
              {pct(Math.abs(change) / t.startUsd, 2)})
              {entry > 0.004 || Math.abs(t.realizedUsd) > 0.004
                ? ` · includes ${[entry > 0.004 ? `${usd(entry)} entry costs` : null, Math.abs(t.realizedUsd) > 0.004 ? `${signedUsd(t.realizedUsd)} from closed trades` : null].filter(Boolean).join(" and ")}`
                : ""}
            </p>
          </>
        )}
      </header>

      <section className="card mt-6">
        <ValueChart points={data.history} reference={t.startUsd} referenceLabel="Started with" now={t.totalUsd} onScrub={(p) => setScrub(p?.valueUsd ?? null)} />
      </section>

      {/* the stat strip: where the money is, and how it's doing */}
      <section aria-label="Account" className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Cash" value={usd(t.cashUsd)} sub="buying power" />
        <Stat label="Positions" value={usd(t.positionsUsd)} sub={`at the mark · ${usd(t.cashOutUsd)} to cash out`} />
        <Stat label="Since you bought" value={<span className={tone(move)}>{signedUsd(move)}</span>} sub={entry > 0.004 ? `open positions · ${usd(entry)} entry costs aside` : "open positions"} />
        <Stat label="Closed return" value={<span className={tone(t.realizedUsd)}>{signedUsd(t.realizedUsd)}</span>} sub="realized" />
        <Stat label="Open positions" value={String(t.openCount)} sub={`${done.length} closed or settled`} />
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Positions"
            value={tab}
            onChange={setTab}
            options={[
              { value: "open", label: `Open · ${open.length}` },
              { value: "closed", label: `Closed & settled · ${done.length}` },
              { value: "activity", label: "Activity" },
            ]}
          />
          <p className="max-w-xl text-[13px] text-smoke">
            Positions are valued at the mark, the midpoint of Gemini&apos;s bid and ask, as brokerages value holdings. Selling now fetches the bid, shown when you sell.
          </p>
        </div>
        <div className="mt-4">
          {tab === "activity" ? (
            <Activity trades={data.trades} />
          ) : (tab === "open" ? open : done).length === 0 ? (
            <Empty tab={tab} />
          ) : (
            <PositionList positions={tab === "open" ? open : done} />
          )}
        </div>
      </section>

      <ResetAccount account={account} data={data} />
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-[20px] bg-cloud px-5 py-4">
      <span className="stat-label">{label}</span>
      <span className="tnum truncate text-[22px] font-bold leading-tight text-inkstone">{value}</span>
      <span className="text-[13px] text-slate">{sub}</span>
    </div>
  );
}

function StatusTag({ p }: { p: PaperPositionSummary }) {
  const cls = "rounded-full px-2 py-px text-[11.5px] font-bold uppercase tracking-wide";
  const demo = p.demo ? <span className={`${cls} bg-signal-violet/10 text-signal-violet`}>Demo</span> : null;
  if (p.status === "settled")
    return (
      <>
        <span className={`${cls} bg-inkstone text-white`}>Settled</span>
        {demo}
      </>
    );
  if (p.status === "closed")
    return (
      <>
        <span className={`${cls} bg-mist text-slate`}>Sold</span>
        {demo}
      </>
    );
  if (p.awaiting) return <span className={`${cls} bg-mist text-inkstone`}>Awaiting result</span>;
  if (p.pricing === "frozen") return <span className={`${cls} bg-mist text-slate`}>Prices frozen</span>;
  if (p.pricing === "none") return <span className={`${cls} bg-mist text-slate`}>Last value</span>;
  return null;
}

/** One row per position: what it is, what it cost, what it's worth, how it's doing, and what it can pay. */
export function PositionList({ positions }: { positions: PaperPositionSummary[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {positions.map((p) => {
        const open = p.status === "open";
        // Open: how it's moved since it was bought (entry cost noted under it). Closed: everything put
        // in vs everything paid back.
        const pnl = open ? p.moveUsd : p.realizedUsd;
        const basis = open ? p.costUsd : p.investedUsd;
        const worth = open ? p.valueUsd : p.returnedUsd;
        const lo = Math.min(...p.schedule);
        const hi = Math.max(...p.schedule);
        return (
          <li key={p.id}>
            <Link
              href={`/portfolio/${p.id}`}
              className="ease group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 rounded-[20px] bg-cloud px-5 py-4 hover:bg-mist md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,0.7fr))_auto]"
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-bold text-inkstone">{p.title}</span>
                  <StatusTag p={p} />
                </span>
                <span className="mt-0.5 block truncate text-[13.5px] text-slate">
                  {p.viewLabel ?? strategyName[p.strategy]} ·{" "}
                  {p.status === "settled" ? `settled on ${p.outcomeLabel ?? "the result"}` : p.status === "closed" ? "sold" : p.awaiting ? "market closed" : `settles ${untilLabel(p.expiry)}`}
                </span>
                {!open && p.results && p.results.length > 0 && <ResultChips results={p.results} />}
              </span>
              <span className="hidden text-right md:block">
                <span className="stat-label block !text-[11.5px]">{open ? "Cost" : "Put in"}</span>
                <span className="tnum font-bold text-inkstone">{usd(basis)}</span>
              </span>
              <span className="hidden text-right md:block">
                <span className="stat-label block !text-[11.5px]">{open ? "Value now" : p.status === "settled" ? "Paid out" : "Sold for"}</span>
                <span className="tnum font-bold text-inkstone">{usd(worth)}</span>
              </span>
              <span className="hidden text-right md:block">
                <span className="stat-label block !text-[11.5px]">{open ? "If it settles" : "Closed"}</span>
                <span className="tnum font-bold text-inkstone">
                  {open ? `${usd(lo, 0)}–${usd(hi, 0)}` : p.closedAt ? new Date(p.closedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
                </span>
              </span>
              <span className="flex items-center gap-3 text-right">
                <span>
                  <span className={`tnum flex items-center justify-end gap-1 font-bold ${tone(pnl)}`}>
                    {pnl > 0.004 ? <ArrowUpRight size={15} strokeWidth={2.4} /> : pnl < -0.004 ? <ArrowDownRight size={15} strokeWidth={2.4} /> : null}
                    {signedUsd(pnl)}
                  </span>
                  <span className="tnum block text-[13px] text-slate">
                    <span className="md:hidden">{usd(worth)} · </span>
                    {open ? (
                      <>
                        since you bought
                        {p.entryCostUsd > 0.004 ? ` · ${usd(p.entryCostUsd)} entry cost` : ""}
                      </>
                    ) : (
                      pnlPct(pnl, basis).replace(/^ \(|\)$/g, "") || "no change"
                    )}
                  </span>
                </span>
                <ChevronRight size={18} className="ease shrink-0 text-ash group-hover:translate-x-0.5 group-hover:text-inkstone" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ tab }: { tab: Tab }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[24px] border border-dashed border-ash px-6 py-8">
      <p className="text-[18px] font-bold text-inkstone">{tab === "open" ? "No open positions yet" : "Nothing closed or settled yet"}</p>
      <p className="max-w-xl text-slate">
        {tab === "open"
          ? "Pick a market, set your outlook and review the hedge. Without a wallet, confirming places a paper trade at Gemini's live prices and it shows up here."
          : "Positions you sell, and ones whose markets settle, move here with their final result."}
      </p>
      {tab === "open" && (
        <Link href="/" className="btn btn-primary">
          Browse markets
        </Link>
      )}
    </div>
  );
}

const kindLabel = (t: PaperTrade) =>
  t.kind === "open" ? "Bought" : t.kind === "add" ? "Bought more" : t.kind === "sell" ? (t.fraction !== null && t.fraction < 0.999 ? `Sold ${pct(t.fraction)}` : "Sold all") : "Settled";

/** Every fill, newest first: what happened, to which position, and the cash it moved. */
export function Activity({ trades, showTitle = true }: { trades: PaperTrade[]; showTitle?: boolean }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (!trades.length) return <p className="rounded-[20px] bg-cloud px-5 py-4 text-slate">No trades yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-mist rounded-[20px] bg-cloud px-5">
      {trades.map((t) => (
        <li key={t.id} className="py-3">
          <button type="button" className="flex w-full items-center justify-between gap-4 text-left" aria-expanded={openId === t.id} onClick={() => setOpenId(openId === t.id ? null : t.id)}>
            <span className="min-w-0">
              <span className="block font-bold text-inkstone">
                {kindLabel(t)}
                {t.kind === "settle" && t.outcome ? <span className="font-normal text-slate"> · {t.outcome}</span> : null}
              </span>
              <span className="block truncate text-[13px] text-slate">
                {showTitle ? `${t.title} · ` : ""}
                {new Date(t.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ·{" "}
                {t.fills.reduce((s, f) => s + f.qty, 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} contracts
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className={`tnum block font-bold ${t.cashUsd >= 0 ? "text-gain" : "text-inkstone"}`}>{signedUsd(t.cashUsd)}</span>
              {(t.kind === "sell" || t.kind === "settle") && <span className={`tnum block text-[13px] ${tone(t.realizedUsd)}`}>{signedUsd(t.realizedUsd)} return</span>}
            </span>
          </button>
          {openId === t.id && (
            <table className="mt-2 w-full text-[13px]">
              <tbody>
                {t.fills.map((f) => (
                  <tr key={`${f.symbol}-${f.side}`} className="border-t border-mist">
                    <td className="py-1">
                      <span className="mr-1.5 rounded-full bg-mist px-1.5 py-px text-[11px] font-bold">{f.side.toUpperCase()}</span>
                      {f.label}
                    </td>
                    <td className="tnum py-1 text-right text-slate">
                      {f.qty.toLocaleString("en-US", { maximumFractionDigits: 2 })} × {t.kind === "settle" ? (f.price ? "$1 (won)" : "$0") : `${Math.round(f.price * 100)}¢`}
                    </td>
                    <td className="tnum py-1 text-right text-slate">{f.feeUsd ? `fee ${usd(f.feeUsd)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Start over: with a fresh demo portfolio, or empty with $10,000. Two clicks, since it deletes every paper position. */
function ResetAccount({ account, data }: { account: string; data: PaperPortfolio }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<null | "demo" | "empty">(null);
  const reset = async (demo: boolean) => {
    setBusy(demo ? "demo" : "empty");
    await desk.paperReset(account, demo);
    await qc.invalidateQueries({ queryKey: ["paper", account] });
    setBusy(null);
    setConfirm(false);
  };
  return (
    <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-mist pt-6 text-[14px] text-slate">
      <span>
        Paper account since {settleLabel(new Date(data.createdAt).toISOString())}, kept in this browser.
      </span>
      {confirm ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-bold text-inkstone">Delete every paper position and start over?</span>
          <button type="button" disabled={!!busy} className="btn btn-quiet !px-4 !py-1.5" onClick={() => reset(true)}>
            {busy === "demo" ? "Building the demo…" : "With a demo portfolio"}
          </button>
          <button type="button" disabled={!!busy} className="btn btn-quiet !px-4 !py-1.5" onClick={() => reset(false)}>
            {busy === "empty" ? "Resetting…" : `Empty, with ${usd(data.totals.startUsd, 0)}`}
          </button>
          <button type="button" className="font-bold text-signal-violet" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" className="inline-flex items-center gap-1.5 font-bold text-signal-violet hover:text-inkstone" onClick={() => setConfirm(true)}>
          <RotateCcw size={14} strokeWidth={2.2} aria-hidden="true" /> Reset paper account
        </button>
      )}
    </div>
  );
}

/** How each contract of a closed position ended, as small chips: won, lost or sold, with its return. */
function ResultChips({ results }: { results: NonNullable<PaperPositionSummary["results"]> }) {
  const shown = results.slice(0, 3);
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5">
      {shown.map((c) => (
        <span
          key={`${c.label}-${c.side}`}
          className={`tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] ${
            c.result === "won" ? "bg-gain/15 text-gain" : c.result === "lost" ? "bg-mist text-slate" : "bg-porcelain text-inkstone"
          }`}
        >
          <b>{c.result === "won" ? "Won" : c.result === "lost" ? "Lost" : c.result === "mixed" ? "Part sold" : "Sold"}</b>
          {c.side.toUpperCase()} {c.label}
          <span className="opacity-80">{signedUsd(c.pnlUsd)}</span>
        </span>
      ))}
      {results.length > shown.length && <span className="rounded-full bg-porcelain px-2 py-0.5 text-[12px] text-slate">+{results.length - shown.length} more</span>}
    </span>
  );
}
