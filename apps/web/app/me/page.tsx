"use client";

import { PageTransition } from "@/components/PageTransition";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowRight, Wallet } from "lucide-react";
import { desk } from "@/lib/desk";
import { WalletDialog } from "@/components/WalletButton";
import { short, signed, usd } from "@/lib/format";
import { ReplayChart } from "@/components/charts/ReplayChart";
import { FOCUS_PANEL, Panel, StepBadge } from "@/components/forecast/Panel";
import { Tile } from "@/components/forecast/ProfitCard";

/** Worked examples of the score, so the number on this page means something before you have one. */
const EXAMPLES = [
  { you: 0.4, market: 0.2, note: "You gave the outcome that happened twice the market's chance" },
  { you: 0.2, market: 0.2, note: "You agreed with the market" },
  { you: 0.1, market: 0.2, note: "You gave it half the market's chance" },
];

/** How the score works, in the same panel style as everywhere else: shown with or without a wallet. */
function HowScored() {
  return (
    <Panel title="How a forecast is scored" hint="Score = ln(your chance for what happened ÷ the market's). Stake size doesn't enter it.">
      <ul className="flex flex-col gap-2">
        {EXAMPLES.map((e) => {
          const s = Math.log(e.you / e.market);
          return (
            <li key={e.note} className="flex items-center justify-between gap-3 rounded-[16px] bg-porcelain px-3 py-2 text-[13.5px]">
              <span className="min-w-0 text-slate">
                {e.note}: <span className="tnum text-inkstone">{Math.round(e.you * 100)}%</span> vs <span className="tnum">{Math.round(e.market * 100)}%</span>
              </span>
              <b className={`tnum shrink-0 text-[15px] ${s > 0.0001 ? "text-gain" : "text-inkstone"}`}>{signed(s, 2)}</b>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[13px] leading-snug text-slate">
        A positive average over many settled positions means your forecasts were better calibrated than the market&apos;s. Each score is written on-chain when the
        position settles, so the record can&apos;t be edited or backdated.
      </p>
    </Panel>
  );
}

function RecordPageContent() {
  const { publicKey } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [dialog, setDialog] = useState(false);
  useEffect(() => setMounted(true), []);
  const owner = publicKey?.toBase58();
  const q = useQuery({ queryKey: ["record", owner], queryFn: () => desk.record(owner!), enabled: !!owner, refetchInterval: 20_000 });

  if (!mounted) return null;
  const data = q.data;
  const settled = (data?.positions ?? []).filter((p) => p.state === "Settled" && p.score_bps !== null).reverse();
  const pnl = settled.reduce((a, p) => a + (Number(p.payout_base ?? 0) - Number(p.stake_base ?? 0)) / 1e6, 0);
  const mean = data?.summary.meanScore ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-2 px-4 pb-8 pt-3 md:px-6">
      {/* Intro beside the record itself (or, without a wallet, what it will show) */}
      <div className="grid items-stretch gap-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.45fr)]">
        <section className="flex min-w-0 flex-col rounded-[24px] bg-cloud p-5 xl:p-6">
          <p className="text-[12.5px] uppercase tracking-[0.075em] text-smoke">Forecast record{owner ? ` · ${short(owner, 6)}` : ""}</p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.05] tracking-[0.01em] text-inkstone xl:text-[42px]">
            {owner ? "How your forecasts scored" : "Your record lives with your wallet"}
          </h1>
          <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-slate">
            Every settled position stores how your forecast scored against the market&apos;s, on-chain. Over many positions, it shows whether your views were sharper
            than the market&apos;s, independent of how much you put in.
          </p>
          <ol className="mt-5 flex flex-col gap-2.5 text-[14px]">
            {[
              ["Trade a view", "on any market"],
              ["It settles", "Gemini posts the outcome"],
              ["It's scored", "your chance vs the market's, written on-chain"],
            ].map(([t, d], i) => (
              <li key={t} className="flex items-center gap-2.5">
                <StepBadge n={i + 1} />
                <span>
                  <b className="text-inkstone">{t}</b> <span className="text-slate">· {d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-2">
            {owner ? (
              <Link href="/" className="btn btn-primary !gap-1.5 !px-5 !py-2.5">
                Make a forecast <ArrowRight size={16} strokeWidth={2.25} />
              </Link>
            ) : (
              <>
                <button className="btn btn-primary !gap-1.5 !px-5 !py-2.5" onClick={() => setDialog(true)}>
                  <Wallet size={16} strokeWidth={2.25} /> Connect wallet
                </button>
                <Link href="/" className="btn btn-quiet !gap-1.5 !px-5 !py-2.5">
                  Browse markets <ArrowRight size={16} strokeWidth={2} />
                </Link>
              </>
            )}
          </div>
          <WalletDialog open={dialog} onOpenChange={setDialog} />
          <div className="mt-auto grid grid-cols-2 gap-2 pt-6">
            <Tile compact label="Positions" value={owner ? (data?.summary.count ?? "…") : "—"} sub="opened" />
            <Tile compact label="Settled" value={owner ? (data?.summary.settled ?? "…") : "—"} sub="and scored" />
            <Tile compact label="Mean score" value={<span className={mean !== null && mean > 0 ? "text-gain" : ""}>{mean !== null ? signed(mean, 3) : "—"}</span>} sub="vs the market" />
            <Tile
              compact
              label="Settled P&L"
              value={<span className={pnl > 0 ? "text-gain" : ""}>{settled.length ? `${pnl >= 0 ? "+" : "−"}${usd(Math.abs(pnl))}` : "—"}</span>}
              sub="after payouts"
            />
          </div>
        </section>

        <section aria-label="Cumulative score" className={`flex min-w-0 flex-col rounded-[24px] p-4 ${FOCUS_PANEL}`}>
          <header className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[16px] font-bold leading-tight text-inkstone">Cumulative score</p>
              <p className="mt-1 text-[13px] text-slate">Each settled position adds its score; above zero means you&apos;ve beaten the market so far.</p>
            </div>
            {settled.length > 0 && <span className="tnum rounded-full bg-signal-violet/10 px-3 py-1 text-[13px] font-bold text-signal-violet">{settled.length} settled</span>}
          </header>
          <div className="mt-3 flex min-h-[260px] flex-1 flex-col justify-center rounded-[18px] bg-cloud p-3">
            {settled.length > 1 ? (
              <ReplayChart points={settled.map((p) => ({ contour: (p.score_bps ?? 0) / 1e4, single: 0 }))} height={260} />
            ) : (
              <p className="mx-auto max-w-[420px] text-center text-[14px] text-slate">
                {!owner
                  ? "Connect a wallet and your score builds here, one settled position at a time."
                  : q.isLoading
                    ? "Reading your positions…"
                    : settled.length === 1
                      ? "One position has settled. The line starts with the second."
                      : "Nothing has settled yet. Your line starts here once two positions settle."}
              </p>
            )}
          </div>
        </section>
      </div>

      <div className="grid items-start gap-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,0.8fr)]">
        <Panel title="Positions" hint={owner ? "Everything you've opened, newest last. Open one for its payouts and on-chain history." : "Your positions will be listed here."}>
          {!owner ? (
            <p className="rounded-[16px] bg-porcelain px-4 py-3 text-[14px] text-slate">Connect a wallet to see your positions.</p>
          ) : !data?.positions.length ? (
            <p className="rounded-[16px] bg-porcelain px-4 py-3 text-[14px] text-slate">
              {q.isLoading ? (
                "Reading your positions…"
              ) : (
                <>
                  No positions yet.{" "}
                  <Link className="link font-bold" href="/">
                    Pick a market
                  </Link>{" "}
                  to make your first forecast.
                </>
              )}
            </p>
          ) : (
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left text-[12.5px] text-smoke">
                  <th className="pb-1.5 font-medium">Market</th>
                  <th className="pb-1.5 font-medium">State</th>
                  <th className="pb-1.5 text-right font-medium">Stake</th>
                  <th className="pb-1.5 text-right font-medium">Paid</th>
                  <th className="pb-1.5 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="text-inkstone">
                {data.positions.map((p) => (
                  <tr key={p.pubkey} className="border-t border-mist">
                    <td className="py-2 pr-3">
                      <Link className="font-bold hover:text-signal-violet" href={`/p/${p.pubkey}`}>
                        {p.title ?? p.ticker ?? short(p.pubkey)}
                      </Link>
                      {p.outcome_bucket !== null && p.bucketLabels && <span className="block text-[12.5px] text-smoke">Outcome: {p.bucketLabels[p.outcome_bucket]}</span>}
                    </td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${p.state === "Settled" ? "bg-gain/10 text-gain" : "bg-porcelain text-slate"}`}>{p.state}</span>
                    </td>
                    <td className="tnum py-2 text-right">{p.stake_base ? usd(Number(p.stake_base) / 1e6) : "—"}</td>
                    <td className="tnum py-2 text-right">{p.payout_base ? usd(Number(p.payout_base) / 1e6) : "—"}</td>
                    <td className={`tnum py-2 text-right font-bold ${(p.score_bps ?? 0) > 0 ? "text-gain" : ""}`}>{p.score_bps !== null ? signed(p.score_bps / 1e4, 3) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <HowScored />
      </div>
    </div>
  );
}

/** The page, animated in and out on navigation. */
export default function RecordPage() {
  return (
    <PageTransition>
      <RecordPageContent />
    </PageTransition>
  );
}
