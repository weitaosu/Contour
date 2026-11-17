"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { desk } from "@/lib/desk";
import { Stat } from "@/components/ui/Stat";
import { WalletDialog } from "@/components/WalletButton";
import { short, signed, usd } from "@/lib/format";
import { ReplayChart } from "@/components/charts/ReplayChart";

export default function RecordPage() {
  const { publicKey } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [dialog, setDialog] = useState(false);
  useEffect(() => setMounted(true), []);
  const owner = publicKey?.toBase58();
  const q = useQuery({ queryKey: ["record", owner], queryFn: () => desk.record(owner!), enabled: !!owner, refetchInterval: 20_000 });

  if (!mounted) return null;
  if (!owner)
    return (
      <div className="page py-24 text-center">
        <p className="eyebrow">Forecast record</p>
        <h1 className="title mt-2">Your record lives with your wallet</h1>
        <p className="mx-auto mt-4 max-w-xl text-slate">
          Every settled position stores how your forecast scored against the market&apos;s, on-chain. Connect a wallet to see yours.
        </p>
        <button className="btn btn-primary mt-8" onClick={() => setDialog(true)}>
          Connect wallet
        </button>
        <WalletDialog open={dialog} onOpenChange={setDialog} />
      </div>
    );

  const data = q.data;
  const settled = (data?.positions ?? []).filter((p) => p.state === "Settled" && p.score_bps !== null).reverse();
  const pnl = settled.reduce((a, p) => a + (Number(p.payout_base ?? 0) - Number(p.stake_base ?? 0)) / 1e6, 0);
  return (
    <div className="page pb-8 pt-10 md:pt-14">
      <p className="eyebrow">Forecast record · {short(owner, 6)}</p>
      <h1 className="title mt-2">How your forecasts scored</h1>
      <p className="mt-3 max-w-2xl text-slate">
        Score = ln(the probability you gave the outcome ÷ the market&apos;s). A positive average over many positions means you beat the market on
        calibration, independent of stake size.
      </p>

      <section className="mt-8 grid grid-cols-2 gap-6 rounded-[36px] border border-mist px-6 py-7 md:grid-cols-4 md:px-8">
        <Stat label="Positions" value={data?.summary.count ?? "—"} />
        <Stat label="Settled" value={data?.summary.settled ?? "—"} />
        <Stat
          label="Mean score"
          value={<span className={(data?.summary.meanScore ?? 0) > 0 ? "text-gain" : ""}>{data?.summary.meanScore != null ? signed(data.summary.meanScore, 3) : "—"}</span>}
        />
        <Stat label="Settled P&L" value={<span className={pnl > 0 ? "text-gain" : ""}>{settled.length ? `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}` : "—"}</span>} />
      </section>

      {settled.length > 1 && (
        <section className="card mt-6">
          <h2 className="card-title">Cumulative score</h2>
          <ReplayChart points={settled.map((p) => ({ contour: (p.score_bps ?? 0) / 1e4, single: 0 }))} height={220} />
        </section>
      )}

      <section className="card mt-6">
        <h2 className="card-title">Positions</h2>
        {!data?.positions.length ? (
          <p className="mt-4 text-slate">
            No positions yet. <Link className="link" href="/">Pick a ladder</Link> to make your first forecast.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[15px]">
              <thead>
                <tr className="text-left text-[14px] text-smoke">
                  <th className="pb-3 font-medium">Market</th>
                  <th className="pb-3 font-medium">State</th>
                  <th className="pb-3 text-right font-medium">Stake</th>
                  <th className="pb-3 text-right font-medium">Paid</th>
                  <th className="pb-3 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {data.positions.map((p) => (
                  <tr key={p.pubkey} className="border-t border-mist">
                    <td className="py-3">
                      <Link className="hover:text-signal-violet" href={`/p/${p.pubkey}`}>
                        {p.title ?? p.ticker ?? short(p.pubkey)}
                      </Link>
                      {p.outcome_bucket !== null && p.bucketLabels && <span className="block text-[14px] text-smoke">Outcome: {p.bucketLabels[p.outcome_bucket]}</span>}
                    </td>
                    <td className="py-3">
                      <span className="tag tag-white">{p.state}</span>
                    </td>
                    <td className="tnum py-3 text-right">{p.stake_base ? usd(Number(p.stake_base) / 1e6) : "—"}</td>
                    <td className="tnum py-3 text-right">{p.payout_base ? usd(Number(p.payout_base) / 1e6) : "—"}</td>
                    <td className={`tnum py-3 text-right font-bold ${(p.score_bps ?? 0) > 0 ? "text-gain" : ""}`}>{p.score_bps !== null ? signed(p.score_bps / 1e4, 3) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
