"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { forecastHash } from "@contour/core";
import { bytesToHex, cancelPositionIx, readonlyProgram, stateName, unwindPositionIx } from "@contour/chain";
import { Check, CircleDot, Clock, Coins, Lock, ShieldCheck, ArrowUpRight } from "lucide-react";
import { desk, type PositionView } from "@/lib/desk";
import { explorerTx } from "@/lib/env";
import { sendTx, useChainConfig, useProgram, useUsdcMint } from "@/lib/chain";
import { cents, pct, qty, settleLabel, short, signed, untilLabel, usd } from "@/lib/format";
import { PayoutChart } from "@/components/charts/PayoutChart";
import { FiveNumbers } from "@/components/forecast/FiveNumbers";


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

  if (chainQ.isLoading || deskQ.isLoading)
    return (
      <div className="page py-16">
        <div className="card h-[520px]" />
      </div>
    );
  if (!chain && !view)
    return (
      <div className="page py-24">
        <p className="eyebrow">Position</p>
        <h1 className="title mt-2">Not found yet</h1>
        <p className="mt-4 text-slate">If you just confirmed, the transaction may still be landing. This page refreshes on its own.</p>
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

  const reached = {
    opened: true,
    collateral: state === "active" || state === "settled" || (state === "unwound" && !!view?.position.accepted_sig),
    hedged: fills.length > 0,
    awaiting: state === "settled",
    settled: state === "settled",
  };

  return (
    <div className="page pb-8 pt-10 md:pt-14">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">
            Position · {quote ? <Link className="hover:text-inkstone" href={`/m/${quote.ticker}`}>{title}</Link> : title} · Settles {expiryTs ? settleLabel(new Date(expiryTs * 1000).toISOString()) : "—"}
          </p>
          <h1 className="title mt-2">
            {usd(stake, 0)} on {quote?.title ?? title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`tag ${state === "settled" ? "tag-active" : ""}`}>{state[0].toUpperCase() + state.slice(1)}</span>
          <span className="tag tnum" title="Updates arrive from the QuickNode Stream through the desk">
            <CircleDot size={14} strokeWidth={2} className={live ? "text-signal-violet" : "text-ash"} /> {live ? "Live" : "Offline"}
          </span>
          <span className="tag tnum">{short(pubkey, 6)}</span>
        </div>
      </header>

      <section className="card mt-8">
        <ol className="grid gap-6 md:grid-cols-5">
          {(state === "cancelled" || state === "unwound"
            ? [STEPS[0], { key: "closed", label: state === "cancelled" ? "Cancelled, stake refunded" : "Unwound, funds returned", icon: Check }]
            : STEPS
          ).map((s, i, arr) => {
            const isDone = (k: string) => k === "closed" || reached[k as keyof typeof reached];
            const done = isDone(s.key);
            const current = !done && arr.slice(0, i).every((x) => isDone(x.key));
            const Icon = s.icon;
            const sig =
              s.key === "opened" ? view?.position.opened_sig : s.key === "collateral" ? view?.position.accepted_sig : s.key === "settled" ? view?.position.settled_sig : s.key === "closed" ? view?.position.cancelled_sig ?? view?.position.unwound_sig : null;
            return (
              <li key={s.key} className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${done ? "bg-inkstone text-porcelain" : current ? "bg-signal-violet text-porcelain" : "bg-porcelain text-ash"}`}>
                  <Icon size={18} strokeWidth={1.75} />
                </span>
                <span className="flex flex-col">
                  <span className={`font-bold ${done || current ? "text-inkstone" : "text-smoke"}`}>{s.label}</span>
                  <span className="text-[14px] text-smoke">
                    {s.key === "awaiting" && expiryTs ? untilLabel(new Date(expiryTs * 1000).toISOString(), now) : null}
                    {s.key === "hedged" && fills.length ? `${fills.filter((f) => f.status === "filled").length} of ${fills.length} legs · simulated` : null}
                    {sig ? (
                      <a className="link inline-flex items-center gap-1" href={explorerTx(sig)} target="_blank" rel="noreferrer">
                        {short(sig, 5)} <ArrowUpRight size={14} />
                      </a>
                    ) : null}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {view?.position.note && <p className="mt-6 rounded-2xl bg-porcelain px-5 py-4 text-[14px] text-inkstone">{view.position.note}</p>}
        <PositionActions pubkey={pubkey} chain={chain} />
      </section>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="card-title">Locked payout schedule</h2>
            <span className="text-[14px] text-slate">read from the escrow account</span>
          </div>
          <PayoutChart
            payouts={schedule}
            stake={stake}
            hover={hover}
            onHover={setHover}
            outcome={outcome}
            outcomeLabel={outcome !== null && outcome >= 0 ? `Settled · ${usd(schedule[outcome])}` : undefined}
            bucketLabels={labels}
            height={260}
          />
          <p className="mt-3 h-6 text-[14px] text-slate">{hover !== null ? `${labels[hover]} pays ${usd(schedule[hover])}` : "Hover a bar to see its outcome."}</p>
        </section>
        <ScoreCard view={view} chain={chain} outcome={outcome} schedule={schedule} stake={stake} />
      </div>

      {quote && (
        <div className="mt-6">
          <FiveNumbers quote={quote.quote} stake={stake} title="The five numbers, as quoted when you opened" />
        </div>
      )}

      <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="card-title">Desk hedge</h2>
          <p className="mt-1 text-[14px] text-slate">The desk buys these legs with its own funds. Your payout comes from the escrow, not from these fills.</p>
          {fills.length === 0 ? (
            <p className="mt-6 text-slate">No fills yet.</p>
          ) : (
            <table className="mt-5 w-full text-[14px]">
              <thead>
                <tr className="text-left text-smoke">
                  <th className="pb-2 font-medium">Leg</th>
                  <th className="pb-2 text-right font-medium">Qty</th>
                  <th className="pb-2 text-right font-medium">Fill</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((f) => (
                  <tr key={f.id} className="border-t border-mist align-top">
                    <td className="py-3">
                      <span className="font-bold">{f.side.toUpperCase()}</span> {f.detail?.label ?? f.symbol}
                      <span className="block text-smoke">
                        {f.mode === "paper" ? (f.status === "filled" ? "Simulated fill at live quote" : `Not filled (simulated): ${f.detail?.reason ?? ""}`) : f.status}
                      </span>
                    </td>
                    <td className="tnum py-3 text-right">{qty(f.qty)}</td>
                    <td className="tnum py-3 text-right">{f.price !== null ? cents(f.price) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <ForecastProof view={view} chain={chain} />
      </section>
    </div>
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
      <section className="card flex flex-col gap-5">
        <p className="eyebrow">Settled</p>
        <div>
          <p className="stat-label">Paid to you</p>
          <p className="stat-value stat-value-lg">{usd(payout)}</p>
          <p className={`mt-1 text-[14px] tnum ${payout >= stake ? "text-gain" : "text-inkstone"}`}>{signed(payout - stake)} vs stake</p>
        </div>
        <div className="border-t border-mist pt-5">
          <p className="stat-label">Forecast score</p>
          <p className={`stat-value ${score > 0 ? "text-gain" : ""}`}>{signed(score, 3)}</p>
          <p className="mt-2 text-[14px] text-slate">
            You gave the outcome <b className="text-inkstone">{pct(pre.belief[outcome], 1)}</b>; the market gave it <b className="text-inkstone">{pct(pre.marketProb[outcome], 1)}</b>. Score = ln(yours ÷ market&apos;s), stored on-chain.
          </p>
        </div>
      </section>
    );
  }
  const l = ladderQ.data?.ladder;
  const live = l && l.marketProb.length === schedule.length ? l.marketProb : null;
  const curve = live ?? (pre && pre.marketProb.length === schedule.length ? pre.marketProb : null);
  const mark = curve ? curve.reduce((a, q, j) => a + q * schedule[j], 0) : null;
  return (
    <section className="card flex flex-col gap-5">
      <p className="eyebrow">Now</p>
      <div>
        <p className="stat-label">Worth at today&apos;s prices</p>
        <p className="stat-value stat-value-lg">{mark !== null ? usd(mark) : "—"}</p>
        <p className="mt-1 text-[14px] text-slate">
          {live ? "Expected payout under the market's current curve." : "Expected payout under the market's curve when you opened (live quotes unavailable)."}
        </p>
      </div>
      <div className="border-t border-mist pt-5 text-[14px] text-slate">
        Your stake and the desk&apos;s collateral sit in escrow: {usd(Math.max(stake, chain?.maxPayout ?? 0))} is already locked for the best case.
      </div>
    </section>
  );
}

function ForecastProof({ view, chain }: { view: PositionView | null; chain: ChainPosition | null }) {
  const pre = view?.quote?.preimage;
  const computed = useMemo(() => (pre ? forecastHash(pre) : null), [pre]);
  const ok = computed && chain && computed === chain.forecastHash;
  return (
    <div className="card">
      <h2 className="card-title">Forecast record</h2>
      <p className="mt-1 text-[14px] text-slate">
        A hash of your forecast and the market snapshot went on-chain before the outcome existed, so this record cannot be backdated.
      </p>
      <div className="mt-5 flex flex-col gap-3 text-[14px]">
        <div className="flex items-center justify-between gap-4">
          <span className="text-smoke">On-chain hash</span>
          <span className="tnum truncate font-mono text-inkstone">{chain ? short(chain.forecastHash, 10) : "—"}</span>
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
        {pre && <p className="text-smoke">Confidence {pct(pre.confidence)} · captured {new Date(pre.capturedAt).toLocaleString("en-US")}</p>}
      </div>
    </div>
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
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-mist pt-6">
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
