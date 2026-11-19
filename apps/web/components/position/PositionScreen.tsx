"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { forecastHash } from "@contour/core";
import { bytesToHex, cancelPositionIx, readonlyProgram, stateName, unwindPositionIx } from "@contour/chain";
import { Check, CircleDot, Clock, Coins, Lock, ShieldCheck, ArrowRight, ArrowUpRight, CircleCheck } from "lucide-react";
import { desk, type PositionView } from "@/lib/desk";
import { explorerAddr, explorerTx, networkLabel } from "@/lib/env";
import { FOCUS_PANEL, Panel } from "@/components/forecast/Panel";
import { sendTx, useChainConfig, useProgram, useUsdcMint } from "@/lib/chain";
import { cents, notableUnused, pct, qty, settleLabel, short, signed, untilLabel, usd } from "@/lib/format";
import { ProfitChart, GAIN } from "@/components/charts/ProfitChart";
import { oneIn, Tile } from "@/components/forecast/ProfitCard";
import { isWin } from "@/lib/outcomes";
import type { Ladder } from "@contour/core";


interface ChainPosition {
  owner: string;
  stake: number;
  schedule: number[];
  maxPayout: number;
  openedTs: number;
  expiryTs: number;
  state: string;
  outcomeBucket: number;
  scoreBps: number;
  forecastHash: string;
}

function useChainPosition(pubkey: string) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["chain-position", pubkey],
    queryFn: async (): Promise<ChainPosition | null> => {
      try {
        const p = await readonlyProgram(connection).account.position.fetch(new PublicKey(pubkey));
        return {
          owner: p.owner.toBase58(),
          stake: Number(p.stake.toString()) / 1e6,
          schedule: p.schedule.map((x) => Number(x.toString()) / 1e6),
          maxPayout: Number(p.maxPayout.toString()) / 1e6,
          openedTs: Number(p.openedTs.toString()),
          expiryTs: Number(p.expiryTs.toString()),
          state: stateName(p.state as Record<string, unknown>),
          outcomeBucket: p.outcomeBucket,
          scoreBps: p.scoreBps,
          forecastHash: bytesToHex(p.forecastHash),
        };
      } catch {
        return null;
      }
    },
    refetchInterval: 15_000,
  });
}

/** Live updates: the desk pushes decoded Stream events over SSE. */
function useLiveEvents(pubkey: string) {
  const qc = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => {
    // ?static=1 disables the live stream (used for headless screenshots).
    if (new URLSearchParams(window.location.search).has("static")) return;
    const es = new EventSource(desk.streamUrl(pubkey));
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    const bump = () => {
      qc.invalidateQueries({ queryKey: ["position", pubkey] });
      qc.invalidateQueries({ queryKey: ["chain-position", pubkey] });
    };
    for (const ev of ["opened", "accepting", "accepted", "hedged", "settled", "cancelled", "unwound", "note"]) es.addEventListener(ev, bump);
    return () => es.close();
  }, [pubkey, qc]);
  return live;
}

const STEPS = [
  { key: "opened", label: "Opened", icon: Lock },
  { key: "collateral", label: "Collateral posted", icon: Coins },
  { key: "hedged", label: "Hedged", icon: ShieldCheck },
  { key: "awaiting", label: "Awaiting outcome", icon: Clock },
  { key: "settled", label: "Settled", icon: Check },
] as const;

export function PositionScreen({ pubkey }: { pubkey: string }) {
  const deskQ = useQuery({ queryKey: ["position", pubkey], queryFn: () => desk.position(pubkey), refetchInterval: 10_000 });
  const chainQ = useChainPosition(pubkey);
  const live = useLiveEvents(pubkey);
  const [hover, setHover] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(i);
  }, []);

  const view = deskQ.data ?? null;
  const chain = chainQ.data ?? null;
  const quote = view?.quote ?? null;
  // The market's ladder, for real outcome labels and break-even lines (may be gone after settlement).
  const ladderQ = useQuery({ queryKey: ["ladder", quote?.ticker], queryFn: () => desk.ladder(quote!.ticker), enabled: !!quote?.ticker, retry: false });

  if (chainQ.isLoading || deskQ.isLoading)
    return (
      <div className={WRAP}>
        <div className="grid gap-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.45fr)]">
          <div className="h-[520px] rounded-[24px] bg-cloud" />
          <div className="h-[520px] rounded-[24px] bg-cloud" />
        </div>
      </div>
    );
  if (!chain && !view)
    return (
      <div className={WRAP}>
        <section className="flex flex-col rounded-[24px] bg-cloud p-5 xl:p-6">
          <p className="text-[12.5px] uppercase tracking-[0.075em] text-smoke">Position</p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.05] tracking-[0.01em] text-inkstone xl:text-[42px]">Not found yet</h1>
          <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-slate">If you just confirmed, the transaction may still be landing. This page refreshes on its own.</p>
        </section>
      </div>
    );

  const state = chain?.state ?? (view?.position.state.toLowerCase() as string);
  const schedule = chain?.schedule ?? (view?.position.schedule_json ? (JSON.parse(view.position.schedule_json) as string[]).map((x) => Number(x) / 1e6) : []);
  const stake = chain?.stake ?? Number(view?.position.stake_base ?? 0) / 1e6;
  const expiryTs = chain?.expiryTs ?? view?.position.expiry_ts ?? 0;
  const outcome = chain && chain.outcomeBucket !== 255 ? chain.outcomeBucket : (view?.position.outcome_bucket ?? null);
  const labels = quote?.bucketLabels ?? schedule.map((_, i) => `Bucket ${i + 1}`);
  const fills = view?.fills ?? [];
  const title = quote ? quote.ticker : "Position";
  // Paid straight to Contour's account (direct-payment mode) rather than escrowed.
  const payTo = view?.position.pay_to ?? null;

  const reached = {
    opened: true,
    collateral: state === "active" || state === "settled" || (state === "unwound" && !!view?.position.accepted_sig),
    hedged: fills.length > 0,
    awaiting: state === "settled",
    settled: state === "settled",
  };

  const steps = (
    state === "cancelled" || state === "unwound"
      ? [STEPS[0], { key: "closed", label: state === "cancelled" ? "Cancelled, stake refunded" : "Unwound, funds returned", icon: Check }]
      : payTo
        ? STEPS.map((s) => (s.key === "collateral" ? { ...s, label: "Paid to Contour" } : s))
        : STEPS
  ) as { key: string; label: string; icon: typeof Check }[];
  const isDone = (k: string) => k === "closed" || reached[k as keyof typeof reached];
  const openedSig = view?.position.opened_sig ?? null;
  // Just paid: say so first, with the transaction to follow on the explorer.
  const justPaid = !!view && state === "active" && now - view.position.created_at < 15 * 60_000;
  const best = schedule.length ? Math.max(...schedule) : 0;

  return (
    <div className={WRAP}>
      {/* Intro beside the payout schedule, as on the other pages */}
      <div className="grid items-stretch gap-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.45fr)]">
        <section className="flex min-w-0 flex-col rounded-[24px] bg-cloud p-5 xl:p-6">
          <p className="text-[12.5px] uppercase tracking-[0.075em] text-smoke">
            Position · {quote ? <Link className="hover:text-inkstone" href={`/m/${quote.ticker}`}>{title}</Link> : title}
          </p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.05] tracking-[0.01em] text-inkstone xl:text-[42px]">
            {usd(stake, 0)} on {quote?.title ?? title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`tag ${state === "settled" ? "tag-active" : "!bg-porcelain"}`}>{state[0].toUpperCase() + state.slice(1)}</span>
            <span className="tag tnum !bg-porcelain" title="Updates arrive from the desk as they happen">
              <CircleDot size={14} strokeWidth={2} className={live ? "text-signal-violet" : "text-ash"} /> {live ? "Live" : "Offline"}
            </span>
          </div>

          {justPaid && (
            <div className="mt-4 flex items-start gap-2.5 rounded-[16px] bg-gain/10 px-4 py-3 text-[14px] text-inkstone" role="status">
              <CircleCheck size={18} strokeWidth={2.25} className="mt-px shrink-0 text-gain" aria-hidden="true" />
              <span>
                <b>Payment confirmed.</b> {usd(stake)} test USDC went to Contour on {networkLabel}
                {openedSig ? (
                  <>
                    {" "}
                    in transaction{" "}
                    <a className="link tnum font-bold" href={explorerTx(openedSig)} target="_blank" rel="noreferrer">
                      {short(openedSig, 5)}
                    </a>
                  </>
                ) : null}
                . It&apos;s in your portfolio now.
              </span>
            </div>
          )}

          <ol className="mt-5 flex flex-col gap-2.5 text-[14px]">
            {steps.map((s, i) => {
              const done = isDone(s.key);
              const current = !done && steps.slice(0, i).every((x) => isDone(x.key));
              const sig =
                s.key === "opened" ? openedSig : s.key === "collateral" ? (payTo ? null : view?.position.accepted_sig) : s.key === "settled" ? view?.position.settled_sig : s.key === "closed" ? (view?.position.cancelled_sig ?? view?.position.unwound_sig) : null;
              const detail =
                s.key === "awaiting" && expiryTs && state !== "settled"
                  ? `settles ${untilLabel(new Date(expiryTs * 1000).toISOString(), now)}`
                  : s.key === "hedged" && fills.length
                    ? `${fills.filter((f) => f.status === "filled").length} of ${fills.length} legs · simulated`
                    : null;
              return (
                <li key={s.key} className="flex items-center gap-2.5">
                  <span
                    className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${done ? "bg-inkstone text-white" : current ? "bg-signal-violet text-white" : "bg-mist text-smoke"}`}
                    aria-hidden="true"
                  >
                    {done ? <Check size={13} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className="min-w-0">
                    <b className={done || current ? "text-inkstone" : "text-smoke"}>{s.label}</b>
                    {detail && <span className="text-slate"> · {detail}</span>}
                    {s.key === "collateral" && payTo && (
                      <>
                        <span className="text-slate"> · </span>
                        <a className="link inline-flex items-center gap-0.5" href={explorerAddr(payTo)} target="_blank" rel="noreferrer">
                          {short(payTo, 4)} <ArrowUpRight size={13} />
                        </a>
                      </>
                    )}
                    {sig && (
                      <>
                        <span className="text-slate"> · </span>
                        <a className="link tnum inline-flex items-center gap-0.5" href={explorerTx(sig)} target="_blank" rel="noreferrer">
                          {short(sig, 5)} <ArrowUpRight size={13} />
                        </a>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/me" className="btn btn-primary !gap-1.5 !px-5 !py-2.5">
              View in portfolio <ArrowRight size={16} strokeWidth={2.25} />
            </Link>
            {openedSig && (
              <a href={explorerTx(openedSig)} target="_blank" rel="noreferrer" className="btn btn-quiet !gap-1.5 !px-5 !py-2.5">
                Track on Solana Explorer <ArrowUpRight size={16} strokeWidth={2} />
              </a>
            )}
          </div>
          {view?.position.note && <p className="mt-4 rounded-[16px] bg-porcelain px-4 py-3 text-[13.5px] text-inkstone">{view.position.note}</p>}
          <PositionActions pubkey={pubkey} chain={chain} />

          <div className="mt-auto grid grid-cols-3 gap-2 pt-6">
            <Tile compact label="You paid" value={usd(stake)} sub="test USDC" />
            <Tile compact label="Best case" value={<span className="text-gain">+{usd(Math.max(0, best - stake))}</span>} sub={`${usd(best)} paid out`} />
            <Tile compact label="Settles" value={expiryTs ? untilLabel(new Date(expiryTs * 1000).toISOString(), now) : "—"} sub={expiryTs ? settleLabel(new Date(expiryTs * 1000).toISOString()) : ""} />
          </div>
        </section>

        <LockedSchedule
          payTo={payTo}
          schedule={schedule}
          stake={stake}
          labels={labels}
          ladder={ladderQ.data?.ladder && ladderQ.data.ladder.bucketLabels.length === schedule.length ? ladderQ.data.ladder : null}
          hover={hover}
          onHover={setHover}
          outcome={outcome}
        />
      </div>

      <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.8fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          {quote && (
            <AsQuoted
              quote={quote.quote}
              stake={quote.quote.stakeBase / 1e6}
              kept={Number(quote.keptBaseUnits ?? 0) / 1e6}
              marketProb={quote.marketProb}
              belief={quote.preimage?.belief ?? null}
            />
          )}
          <Panel
            title="Desk hedge"
            hint={payTo ? "The desk buys these legs with its own funds to back your position." : "The desk buys these legs with its own funds. Your payout comes from the escrow, not from these fills."}
          >
            {fills.length === 0 ? (
              <p className="rounded-[16px] bg-porcelain px-4 py-3 text-[14px] text-slate">No fills yet.</p>
            ) : (
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-left text-[12.5px] text-smoke">
                    <th className="pb-1.5 font-medium">Leg</th>
                    <th className="pb-1.5 text-right font-medium">Qty</th>
                    <th className="pb-1.5 text-right font-medium">Fill</th>
                  </tr>
                </thead>
                <tbody className="text-inkstone">
                  {fills.map((f) => (
                    <tr key={f.id} className="border-t border-mist align-top">
                      <td className="py-2 pr-3">
                        <span className="font-bold">{f.side.toUpperCase()}</span> {f.detail?.label ?? f.symbol}
                        <span className="block text-[12.5px] text-smoke">
                          {f.mode === "paper" ? (f.status === "filled" ? "Simulated fill at live quote" : `Not filled (simulated): ${f.detail?.reason ?? ""}`) : f.status}
                        </span>
                      </td>
                      <td className="tnum py-2 text-right">{qty(f.qty)}</td>
                      <td className="tnum py-2 text-right">{f.price !== null ? cents(f.price) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <ScoreCard view={view} chain={chain} outcome={outcome} schedule={schedule} stake={stake} />
          <OnChain view={view} stake={stake} pubkey={pubkey} />
          <ForecastProof view={view} chain={chain} />
        </div>
      </div>
    </div>
  );
}

/** Every page's layout: full width up to 1680px, the same gutters and gaps. */
const WRAP = "mx-auto flex w-full max-w-[1680px] flex-col gap-2 px-4 pb-8 pt-3 md:px-6";

/** The payment on Solana, each piece linked to the explorer so it can be followed there. */
function OnChain({ view, stake, pubkey }: { view: PositionView | null; stake: number; pubkey: string }) {
  const p = view?.position;
  const rows: [string, React.ReactNode][] = [];
  const link = (href: string, text: string) => (
    <a className="link tnum inline-flex items-center gap-0.5 font-mono" href={href} target="_blank" rel="noreferrer">
      {text} <ArrowUpRight size={13} />
    </a>
  );
  if (p?.opened_sig) rows.push([p.pay_to ? "Payment" : "Opened", link(explorerTx(p.opened_sig), short(p.opened_sig, 8))]);
  if (p?.owner) rows.push(["From", link(explorerAddr(p.owner), short(p.owner, 6))]);
  if (p?.pay_to) rows.push(["To", link(explorerAddr(p.pay_to), short(p.pay_to, 6))]);
  else rows.push(["Position", link(explorerAddr(pubkey), short(pubkey, 6))]);
  rows.push(["Amount", <span key="a" className="tnum">{usd(stake)} test USDC</span>]);
  if (p?.settled_sig) rows.push(["Settled", link(explorerTx(p.settled_sig), short(p.settled_sig, 8))]);
  rows.push(["Network", networkLabel]);
  return (
    <Panel title="On Solana" hint="The transaction behind this position. Open it on the Solana Explorer to follow it.">
      <dl className="flex flex-col text-[13.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 border-t border-mist py-2 first:border-t-0 first:pt-0">
            <dt className="text-smoke">{k}</dt>
            <dd className="min-w-0 truncate text-right text-inkstone">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** The on-chain schedule as profit and loss per outcome, with the settled outcome ringed. */
function LockedSchedule({
  payTo,
  schedule,
  stake,
  labels,
  ladder,
  hover,
  onHover,
  outcome,
}: {
  payTo: string | null;
  schedule: number[];
  stake: number;
  labels: string[];
  ladder: Ladder | null;
  hover: number | null;
  onHover: (j: number | null) => void;
  outcome: number | null;
}) {
  const pl = schedule.map((p) => p - stake);
  const wins = schedule.map((p) => isWin(p, stake));
  const settled = outcome !== null && outcome >= 0 && outcome < schedule.length;
  const focus = hover ?? (settled ? outcome : null);
  const signedUsd = (n: number) => `${n > 0.004 ? "+" : n < -0.004 ? "−" : ""}${usd(Math.abs(n))}`;
  return (
    <section aria-label="Locked payout schedule" className={`flex min-w-0 flex-col rounded-[24px] p-4 ${FOCUS_PANEL}`}>
      <header className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[16px] font-bold leading-tight text-inkstone">Locked payout schedule</p>
          <p className="mt-1 text-[13px] text-slate">What you get back in each outcome, {payTo ? "recorded when you paid" : "read from the escrow account"}.</p>
        </div>
      </header>
      <div className="flex flex-1 flex-col rounded-[18px] bg-cloud p-3">
      <div className="mb-3 min-h-[52px]">
        {focus !== null ? (
          <>
            <p className="text-[14px] text-slate">
              {settled && hover === null ? "Settled · " : ""}
              {labels[focus]}
            </p>
            <p className={`tnum text-[28px] font-bold leading-tight ${pl[focus] > 0.004 ? "text-gain" : "text-inkstone"}`}>
              {signedUsd(pl[focus])} <span className="text-[15px] font-medium text-slate">· you get {usd(schedule[focus])} back</span>
            </p>
          </>
        ) : (
          <p className="text-[13.5px] text-slate">Point at a bar to see what you&apos;d get back in that outcome.</p>
        )}
      </div>
      <ProfitChart
        pl={pl}
        wins={wins}
        stake={stake}
        hover={hover}
        onHover={onHover}
        cutLabels={ladder?.cutLabels ?? []}
        bucketLabels={ladder?.bucketLabels ?? labels}
        height={440}
        outcome={settled ? outcome : null}
        outcomeLabel={settled ? `Settled · ${usd(schedule[outcome!])}` : undefined}
      />
      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-slate">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-[3px]" style={{ background: GAIN }} /> You make money
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-[3px] bg-ash" /> You get back less
        </span>
      </div>
      </div>
    </section>
  );
}

/** What the position looked like when it was quoted: the same honest numbers as the forecast screen. */
function AsQuoted({
  quote,
  stake,
  kept,
  marketProb,
  belief,
}: {
  quote: Omit<import("@contour/core").Quote, "raw">;
  /** The whole amount the view was sized for; `kept` of it wasn't needed and wasn't charged (0 on older positions, which escrowed it). */
  stake: number;
  kept: number;
  marketProb: number[];
  belief: number[] | null;
}) {
  const wins = quote.payoutByBucket.map((p) => isWin(p, stake));
  const chance = marketProb.reduce((s, q, j) => s + (wins[j] ? q : 0), 0);
  const chanceYou = belief ? belief.reduce((s, q, j) => s + (wins[j] ? q : 0), 0) : null;
  return (
    <Panel title="What you signed up for" hint="As quoted when you opened.">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <Tile
          label="You paid"
          value={usd(stake - kept)}
          sub={
            quote.feesUsd === undefined
              ? "quoted before Gemini fees were itemized"
              : `${usd(quote.feesUsd)} of it in Gemini fees${notableUnused(kept) ? ` · ${usd(kept)} of your ${usd(stake, 0)} wasn't needed` : ""}`
          }
        />
        <Tile label="Really at risk" value={usd(stake - quote.minPayout)} sub={`at least ${usd(quote.minPayout - kept)} paid back`} />
        <Tile label="Best case" value={<span className="text-gain">+{usd(quote.maxPayout - stake)}</span>} sub={`${usd(quote.maxPayout - kept)} paid out`} />
        <Tile
          label="Chance of profit"
          value={pct(chance)}
          sub={
            <>
              {oneIn(chance)} by the market
              {chanceYou !== null ? (
                <>
                  {" "}
                  · <span className="font-bold text-signal-violet">{pct(chanceYou)}</span> by yours
                </>
              ) : null}
            </>
          }
        />
      </div>
    </Panel>
  );
}

function ScoreCard({ view, chain, outcome, schedule, stake }: { view: PositionView | null; chain: ChainPosition | null; outcome: number | null; schedule: number[]; stake: number }) {
  const pre = view?.quote?.preimage;
  const ticker = view?.quote?.ticker;
  const ladderQ = useQuery({ queryKey: ["ladder", ticker], queryFn: () => desk.ladder(ticker!), enabled: !!ticker && (chain?.state === "active" || chain?.state === "open"), retry: false });
  if (outcome !== null && outcome >= 0 && pre) {
    const score = (chain?.scoreBps ?? view?.position.score_bps ?? 0) / 1e4;
    const payout = schedule[outcome];
    return (
      <Panel title="Settled" hint="What it paid, and how your forecast scored against the market's.">
        <div className="grid grid-cols-2 gap-2">
          <Tile compact label="Paid to you" value={usd(payout)} sub={<span className={payout >= stake ? "text-gain" : ""}>{signed(payout - stake)} vs stake</span>} />
          <Tile compact label="Forecast score" value={<span className={score > 0 ? "text-gain" : ""}>{signed(score, 3)}</span>} sub="vs the market" />
        </div>
        <div>
          <p className="mt-3 text-[13px] leading-snug text-slate">
            You gave the outcome <b className="text-inkstone">{pct(pre.belief[outcome], 1)}</b>; the market gave it <b className="text-inkstone">{pct(pre.marketProb[outcome], 1)}</b>. Score = ln(yours ÷ market&apos;s), {view?.position.pay_to ? "recorded at settlement" : "stored on-chain"}.
          </p>
        </div>
      </Panel>
    );
  }
  const l = ladderQ.data?.ladder;
  const live = l && l.marketProb.length === schedule.length ? l.marketProb : null;
  const curve = live ?? (pre && pre.marketProb.length === schedule.length ? pre.marketProb : null);
  const mark = curve ? curve.reduce((a, q, j) => a + q * schedule[j], 0) : null;
  return (
    <Panel title="Now" hint={live ? "Expected payout under the market's current curve." : "Expected payout under the market's curve when you opened (live quotes unavailable)."}>
      <div className="grid grid-cols-2 gap-2">
        <Tile compact label="Worth today" value={mark !== null ? usd(mark) : "—"} sub={mark !== null ? <span className={mark >= stake ? "text-gain" : ""}>{signed(mark - stake)} vs paid</span> : "no live prices"} />
        <Tile compact label="Best case" value={usd(Math.max(...schedule))} sub="paid out" />
      </div>
      <div className="mt-3 text-[13px] leading-snug text-slate">
        {view?.position.pay_to ? (
          <>Paid {usd(stake)} to Contour&apos;s account {short(view.position.pay_to, 4)}. The best case pays {usd(Math.max(...schedule))}.</>
        ) : (
          <>Your stake and the desk&apos;s collateral sit in escrow: {usd(Math.max(stake, chain?.maxPayout ?? 0))} is already locked for the best case.</>
        )}
      </div>
    </Panel>
  );
}

function ForecastProof({ view, chain }: { view: PositionView | null; chain: ChainPosition | null }) {
  const pre = view?.quote?.preimage;
  const computed = useMemo(() => (pre ? forecastHash(pre) : null), [pre]);
  // Direct-payment positions have no on-chain account: the hash is the one the desk recorded at payment.
  const direct = !!view?.position.pay_to;
  const recorded = chain?.forecastHash ?? (direct ? (view?.position.forecast_hash ?? null) : null);
  const ok = computed && recorded && computed === recorded;
  return (
    <Panel
      title="Forecast hash"
      hint={
        direct
          ? "A hash of your forecast and the market snapshot, recorded when you paid, before the outcome existed."
          : "A hash of your forecast and the market snapshot went on-chain before the outcome existed, so it cannot be backdated."
      }
    >
      <div className="flex flex-col gap-2 text-[13.5px]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-smoke">{direct ? "Recorded hash" : "On-chain hash"}</span>
          <span className="tnum truncate font-mono text-inkstone">{recorded ? short(recorded, 10) : "—"}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-smoke">Recomputed in your browser</span>
          <span className="tnum truncate font-mono text-inkstone">{computed ? short(computed, 10) : "—"}</span>
        </div>
        <div className="mt-2">
          {ok ? (
            <span className="tag tag-active">
              <Check size={14} /> Verified
            </span>
          ) : (
            <span className="tag">{pre ? "Waiting for chain data" : "Preimage not available"}</span>
          )}
        </div>
        {pre && <p className="text-[13px] text-smoke">Follows your view {pct(pre.confidence)} · captured {new Date(pre.capturedAt).toLocaleString("en-US")}</p>}
      </div>
    </Panel>
  );
}

function PositionActions({ pubkey, chain }: { pubkey: string; chain: ChainPosition | null }) {
  const { publicKey } = useWallet();
  const wallet = useAnchorWallet();
  const { connection } = useConnection();
  const program = useProgram();
  const mint = useUsdcMint();
  const cfg = useChainConfig();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!chain || !publicKey || !wallet || !program || !mint) return null;
  const nowS = Date.now() / 1000;
  const canCancel = chain.state === "open" && chain.owner === publicKey.toBase58();
  const canUnwind = chain.state === "active" && cfg.data && nowS > chain.expiryTs + cfg.data.settleGraceSecs;
  if (!canCancel && !canUnwind) return null;
  const run = async (kind: "cancel" | "unwind") => {
    setBusy(true);
    setErr(null);
    try {
      const pos = new PublicKey(pubkey);
      const ix =
        kind === "cancel"
          ? await cancelPositionIx(program, publicKey, pos, mint)
          : await unwindPositionIx(program, publicKey, pos, new PublicKey(chain.owner), new PublicKey(cfg.data!.desk), mint);
      await sendTx(connection, wallet, new Transaction().add(ix));
      await qc.invalidateQueries({ queryKey: ["chain-position", pubkey] });
    } catch (e) {
      setErr((e as Error).message.slice(0, 200));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {canCancel && (
        <button className="btn btn-ghost" disabled={busy} onClick={() => run("cancel")}>
          Cancel and refund my stake
        </button>
      )}
      {canUnwind && (
        <button className="btn btn-ghost" disabled={busy} onClick={() => run("unwind")}>
          Unwind: no outcome posted within the grace period
        </button>
      )}
      {err && <span className="text-[14px] text-inkstone">{err}</span>}
    </div>
  );
}
