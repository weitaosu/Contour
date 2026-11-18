"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import {
  compile,
  formatValue,
  fromBars,
  isTradable,
  likelyRange,
  paysIn,
  marketMoments,
  normalBelief,
  type Ladder,
  type Quote,
} from "@contour/core";
import { desk, type StoredQuote } from "@/lib/desk";
import { openPositionIx, sendTx, useChainConfig, useDeskConfig, useProgram, useUsdcBalance, useUsdcMint } from "@/lib/chain";
import { pct, settleLabel, untilLabel, usd } from "@/lib/format";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { PayoutChart } from "@/components/charts/PayoutChart";
import { Slider } from "@/components/ui/Slider";
import { Switch } from "@/components/ui/Switch";
import { WalletDialog } from "@/components/WalletButton";
import { FiveNumbers } from "./FiveNumbers";
import { ComparisonCard } from "./ComparisonCard";
import { LegsPanel } from "./LegsPanel";
import { CandidateEditor } from "./CandidateEditor";

type ShownQuote = Omit<Quote, "raw"> & { iterations?: number };

// Confidence is a four-step dial. 0 is left out: with no trust in your own forecast there is nothing to trade.
const CONFIDENCE_LEVELS = [0.25, 0.5, 0.75, 1] as const;
const CONFIDENCE_NAMES = ["mostly the market", "half and half", "mostly my forecast", "only my forecast"] as const;
const DEFAULT_CONFIDENCE = 0.25;
const snapConfidence = (c: number) =>
  CONFIDENCE_LEVELS.reduce((best, l) => (Math.abs(l - c) < Math.abs(best - c) ? l : best), CONFIDENCE_LEVELS[0]);

export interface Preset { c?: number; w?: number; x?: number; s?: number }

export function ForecastScreen({ ticker, preset = {} }: { ticker: string; preset?: Preset }) {
  const ladderQ = useQuery({ queryKey: ["ladder", ticker], queryFn: () => desk.ladder(ticker), refetchInterval: 15_000 });
  if (ladderQ.isError)
    return (
      <div className="page py-24">
        <p className="eyebrow">Market</p>
        <h1 className="title mt-2">This ladder can&apos;t be traded</h1>
        <p className="mt-4 max-w-xl text-slate">{(ladderQ.error as Error).message}</p>
      </div>
    );
  if (!ladderQ.data)
    return (
      <div className="page py-16">
        <div className="h-6 w-80 rounded-full bg-cloud" />
        <div className="mt-4 h-10 w-[520px] max-w-full rounded-full bg-cloud" />
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="card h-[620px]" />
          <div className="card h-[620px]" />
        </div>
      </div>
    );
  return <Screen ladder={ladderQ.data.ladder} preset={preset} />;
}

function Screen({ ladder, preset }: { ladder: Ladder; preset: Preset }) {
  const ordered = ladder.cuts !== null;
  const mkt = useMemo(() => (ordered ? marketMoments(ladder) : { mean: 0, sd: 1 }), [ladder, ordered]);
  const [center, setCenter] = useState<number>(() => mkt.mean + (preset.x ?? 0) * mkt.sd);
  const [range] = useState(() => ({ lo: mkt.mean - 2.5 * mkt.sd, hi: mkt.mean + 2.5 * mkt.sd, sd: mkt.sd }));
  const [scale, setScale] = useState(() => Math.min(1.6, Math.max(0.4, preset.w ?? 1)));
  const [edit, setEdit] = useState(!ordered);
  const [bars, setBars] = useState<number[] | null>(ordered ? null : ladder.marketProb);
  const [draft, setDraft] = useState<number[] | null>(null);
  const [confidence, setConfidence] = useState<number>(() => snapConfidence(preset.c ?? DEFAULT_CONFIDENCE));
  const [stake, setStake] = useState(() => (preset.s && preset.s > 0 ? preset.s : 100));
  const [hover, setHover] = useState<number | null>(null);

  const chainCfg = useChainConfig();
  const maxStake = chainCfg.data?.maxStake ?? 500;
  const dragStart = useRef<{ center: number; scale: number } | null>(null);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  // The user's (unblended) belief.
  const belief = useMemo(() => {
    if (edit && (draft || bars)) return fromBars(draft ?? bars!);
    if (!ordered) return ladder.marketProb;
    return normalBelief(ladder, center, range.sd * scale);
  }, [edit, draft, bars, ordered, ladder, center, range.sd, scale]);

  // Instant in-browser preview (warm-started solver).
  const warm = useRef<number[] | undefined>(undefined);
  const preview = useMemo(() => {
    const q = compile({ ladder, belief, confidence, stakeUsd: Math.max(1, stake), warmStart: warm.current, maxIter: 20_000 });
    warm.current = q.raw.weights;
    return q;
  }, [ladder, belief, confidence, stake]);

  // Server quote: debounced 150 ms, refreshed every 15 s while idle.
  const key = useMemo(() => JSON.stringify([ladder.eventTicker, belief, confidence, stake]), [ladder.eventTicker, belief, confidence, stake]);
  const [server, setServer] = useState<{ key: string; data: StoredQuote; at: number } | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (draft || !(stake > 0)) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      desk
        .quote({ ticker: ladder.eventTicker, belief, confidence, stakeUsd: stake }, ac.signal)
        .then((data) => {
          setServer({ key, data, at: Date.now() });
          setQuoteErr(null);
        })
        .catch((e: Error) => e.name !== "AbortError" && setQuoteErr(e.message));
    }, 150);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [key, draft, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const i = setInterval(() => setTick((x) => x + 1), 15_000);
    return () => clearInterval(i);
  }, []);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const serverFresh = server && server.key === key && now - server.at < 20_000 ? server : null;
  const shown: ShownQuote = serverFresh ? serverFresh.data.quote : preview;
  const noEdge = shown.advice === "no_edge";

  // What the single best contract for the same view would pay in each outcome, for the overlay.
  const compare = useMemo(() => {
    const c = shown.comparison;
    if (!c) return null;
    const i = ladder.instruments.findIndex((x) => x.symbol === c.symbol);
    if (i < 0) return null;
    return ladder.marketProb.map((_, j) => (paysIn(ladder, i, c.side, j) ? c.payoutIfWin : 0));
  }, [shown.comparison, ladder]);
  const coveredContour = shown.payoutByBucket.filter((p) => p > 0.005).length;
  const profitContour = shown.payoutByBucket.filter((p) => p > stake + 1e-9).length;
  const coveredSingle = compare ? compare.filter((p) => p > 0).length : 0;

  // Chart decorations.
  const untraded = ladder.kind === "threshold" ? ladder.instruments.map((_, i) => i).filter((i) => !isTradable(ladder, i)).map((i) => ({ cut: i, reason: ladder.crossed[i] ? "quotes crossed" : "no two-sided quote" })) : [];
  const likely = useMemo(() => {
    if (!ordered || !ladder.cuts) return null;
    const [a, b] = likelyRange(ladder.marketProb, 0.5);
    const lo = a === 0 ? null : formatValue(ladder.cuts[a - 1], ladder.unit);
    const hi = b === ladder.cuts.length ? null : formatValue(ladder.cuts[b], ladder.unit);
    const range = lo && hi ? `${lo} – ${hi}` : lo ? `${lo} or above` : hi ? `below ${hi}` : "anywhere";
    return { from: a, to: b, label: `Market's likely range: ${range}` };
  }, [ladder, ordered]);

  const round = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v) : Math.round(v * 100) / 100);
  const fmtCenter = formatValue(round(center), ladder.unit);
  const widthLabel = formatValue(round(range.sd * scale), ladder.unit);

  return (
    <div className="page pb-24 pt-10 md:pt-14 lg:pb-8">
      <a href="#controls" className="fixed inset-x-4 bottom-4 z-20 flex items-center justify-between rounded-full bg-inkstone px-6 py-3 text-porcelain lg:hidden">
        <span className="tnum text-[14px]">
          {usd(shown.minPayout, 0)} – {usd(shown.maxPayout, 0)} · {pct(shown.probProfitBelief)} if right
        </span>
        <span className="font-bold">Set forecast ↓</span>
      </a>
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">
            {ladder.category} · Settles {settleLabel(ladder.expiry)} · {untilLabel(ladder.expiry, now)}
          </p>
          <h1 className="title mt-2">{ladder.title}</h1>
          {!ordered && (
            <p className="mt-3 max-w-2xl text-slate">
              One candidate wins. Contour buys more of the candidates you rate above the market and less of the rest, so you get paid in proportion to how right
              you were instead of betting everything on one name.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="tag tnum">{ladder.kind === "threshold" ? `${ladder.strikes.length} strikes` : `${ladder.marketProb.length} outcomes`}</span>
          <span className="tag tnum">{ladder.quoted.filter(Boolean).length} quoted</span>
          {ladder.crossed.some(Boolean) && <span className="tag">Crossed quotes not traded</span>}
        </div>
      </header>

      <div className="mt-8 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="card-title">{ordered ? "Probability by outcome" : "Chance of winning, by candidate"}</h2>
              <div className="flex items-center gap-5 text-[14px] text-slate">
                <span className="inline-flex items-center gap-2">
                  <span className="h-3 w-3 rounded-[3px] bg-mist ring-1 ring-smoke" /> Market
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-[3px] w-4 rounded-full bg-signal-violet" /> You
                </span>
              </div>
            </div>
            <div className="mt-4">
              <ProbabilityChart
                bucketLabels={ladder.bucketLabels}
                cutLabels={ladder.cutLabels}
                cuts={ladder.cuts}
                market={ladder.marketProb}
                you={belief}
                drag={
                  ordered && !edit
                    ? {
                        center,
                        onStart: () => (dragStart.current = { center, scale }),
                        onMove: (dv, dy) => {
                          const st = dragStart.current;
                          if (!st) return;
                          setCenter(clamp(st.center + dv, range.lo, range.hi));
                          setScale(Math.round(clamp(st.scale * Math.exp(dy / 160), 0.4, 1.6) * 100) / 100);
                        },
                        onEnd: () => (dragStart.current = null),
                      }
                    : null
                }
                untraded={untraded}
                likely={likely}
                hover={hover}
                onHover={setHover}
                editable={edit}
                onDraft={setDraft}
                onCommit={(v) => {
                  setBars(fromBars(v));
                  setDraft(null);
                }}
                tooltip={(j) => (
                  <div className="flex flex-col gap-1">
                    <span className="font-bold text-inkstone">{ladder.bucketLabels[j]}</span>
                    <span className="flex justify-between text-slate">
                      Market <span className="tnum text-inkstone">{pct(ladder.marketProb[j], 1)}</span>
                    </span>
                    <span className="flex justify-between text-slate">
                      You <span className="tnum text-signal-violet">{pct(belief[j], 1)}</span>
                    </span>
                    <span className="flex justify-between text-slate">
                      Pays <span className="tnum text-inkstone">{usd(shown.payoutByBucket[j])}</span>
                    </span>
                  </div>
                )}
              />
            </div>
            <div className="mt-6 border-t border-mist pt-6">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
                <h2 className="card-title">Payout per outcome</h2>
                <div className="flex items-center gap-4 text-[14px] text-slate">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded-[3px] bg-signal-violet" /> Contour position
                  </span>
                  {compare && (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3 w-1.5 rounded-[2px] bg-smoke" /> One contract, same ${stake.toLocaleString("en-US")}
                    </span>
                  )}
                  <span className="text-smoke">· {serverFresh ? "desk quote" : "preview"}</span>
                </div>
              </div>
              {compare && !noEdge && (
                <p className="mb-2 text-[14px] text-slate">
                  Contour pays back something in <b className="tnum text-signal-violet">{coveredContour} of {ladder.marketProb.length}</b> outcomes and
                  profits in <b className="tnum text-signal-violet">{profitContour}</b>. The single best contract pays in{" "}
                  <b className="tnum text-inkstone">{coveredSingle}</b> and loses everything in the other {ladder.marketProb.length - coveredSingle}.
                </p>
              )}
              <PayoutChart payouts={shown.payoutByBucket} stake={stake} hover={hover} onHover={setHover} bucketLabels={ladder.bucketLabels} compare={noEdge ? null : compare} />
            </div>
          </section>

          {!ordered && (
            <CandidateEditor
              labels={ladder.bucketLabels}
              market={ladder.marketProb}
              belief={belief}
              payouts={shown.payoutByBucket}
              stake={stake}
              onChange={(b) => setBars(b)}
            />
          )}

          <FiveNumbers quote={shown} stake={stake} />

          <div className="flex flex-col gap-6">
            <ComparisonCard quote={shown} stake={stake} />
            <LegsPanel quote={shown} paper={true} crossed={serverFresh?.data.crossedStrikes ?? ladder.instruments.filter((_, i) => ladder.crossed[i]).map((i) => i.label)} />
          </div>
        </div>

        <aside id="controls" className="card flex min-w-0 flex-col gap-7 lg:sticky lg:top-[96px]">
          <div>
            <p className="eyebrow">Your forecast</p>
            <p className="mt-1 text-slate">
              {ordered ? "Where do you think it lands, and how sure are you? Drag the curve or use the sliders." : "Set your odds in the candidate list, or drag the violet bars on the chart."}
            </p>
          </div>
          {ordered && (
            <>
              <Slider
                label="Where"
                value={center}
                min={range.lo}
                max={range.hi}
                step={range.sd / 100}
                onChange={(v) => {
                  setCenter(v);
                  setEdit(false);
                }}
                display={fmtCenter}
                valueText={`Center ${fmtCenter}`}
                ends={[formatValue(Math.round(range.lo), ladder.unit), formatValue(Math.round(range.hi), ladder.unit)]}
              />
              <Slider
                label="How sure"
                value={2 - scale}
                min={0.4}
                max={1.6}
                step={0.01}
                onChange={(v) => {
                  setScale(Math.round((2 - v) * 100) / 100);
                  setEdit(false);
                }}
                display={`±${widthLabel}`}
                valueText={`Spread ${widthLabel}, ${scale.toFixed(2)} times the market's`}
                ends={["Wider than market", "Narrower"]}
              />
              <Switch
                label="Edit by hand"
                checked={edit}
                onChange={(on) => {
                  setEdit(on);
                  if (on) setBars(belief);
                }}
              />
            </>
          )}
          <div className="border-t border-mist pt-6">
            <Slider
              label="Confidence"
              value={confidence}
              min={CONFIDENCE_LEVELS[0]}
              max={CONFIDENCE_LEVELS[CONFIDENCE_LEVELS.length - 1]}
              step={0.25}
              onChange={(v) => setConfidence(snapConfidence(v))}
              display={pct(confidence)}
              valueText={`${Math.round(confidence * 100)} percent trust in my forecast, ${CONFIDENCE_NAMES[CONFIDENCE_LEVELS.indexOf(confidence as (typeof CONFIDENCE_LEVELS)[number])]}`}
              ends={["Trust the market", "Trust my forecast"]}
            />
          </div>
          <StakeInput stake={stake} setStake={setStake} maxStake={maxStake} absorb={shown.maxAbsorbableStakeUsd} />
          <ConfirmBlock ladder={ladder} server={serverFresh?.data ?? null} noEdge={noEdge} stake={stake} quoteErr={quoteErr} age={serverFresh ? Math.round((now - serverFresh.at) / 1000) : null} />
        </aside>
      </div>
    </div>
  );
}

function StakeInput({ stake, setStake, maxStake, absorb }: { stake: number; setStake: (n: number) => void; maxStake: number; absorb: number | null }) {
  const [text, setText] = useState(String(stake));
  return (
    <div className="flex flex-col gap-2">
      <label className="stat-label" htmlFor="stake">
        Stake
      </label>
      <div className="relative">
        <input
          id="stake"
          className="input tnum !pr-16 text-[20px] font-bold"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const t = e.target.value.replace(/[^0-9.]/g, "");
            setText(t);
            const n = Number(t);
            if (n > 0) setStake(Math.min(maxStake, Math.round(n * 100) / 100));
          }}
          onBlur={() => setText(String(stake))}
        />
        <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate">USDC</span>
      </div>
      <p className="text-[14px] text-smoke">
        Up to {usd(maxStake, 0)} per position on devnet.
        {absorb !== null && absorb < maxStake ? ` Quoted depth absorbs about ${usd(absorb, 0)} at these prices.` : ""}
      </p>
    </div>
  );
}

function ConfirmBlock({ ladder, server, noEdge, stake, quoteErr, age }: { ladder: Ladder; server: StoredQuote | null; noEdge: boolean; stake: number; quoteErr: string | null; age: number | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const program = useProgram();
  const mint = useUsdcMint();
  const cfg = useDeskConfig();
  const chainCfg = useChainConfig();
  const bal = useUsdcBalance(publicKey, mint);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const deployed = !!chainCfg.data && !!mint;
  const short = bal.data !== undefined && bal.data < stake;

  async function faucet() {
    if (!publicKey) return;
    setBusy("Sending test USDC…");
    setErr(null);
    try {
      await desk.faucet(publicKey.toBase58());
      await qc.invalidateQueries({ queryKey: ["usdc"] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!publicKey || !anchorWallet || !program || !mint || !server) return;
    setErr(null);
    try {
      setBusy("Waiting for your signature…");
      const nonce = BigInt(Date.now()) * BigInt(1000) + BigInt(Math.floor(Math.random() * 1000));
      const { ix, position } = await openPositionIx(program, {
        owner: publicKey,
        usdcMint: mint,
        nonce,
        marketIdHex: server.marketIdHex,
        forecastHashHex: server.forecastHash,
        stakeBase: server.stakeBaseUnits,
        scheduleBase: server.scheduleBaseUnits,
        expiryTs: server.expiryTs,
      });
      setBusy("Locking your payout schedule on Solana…");
      await sendTx(connection, anchorWallet, new Transaction().add(ix));
      router.push(`/p/${position.toBase58()}`);
    } catch (e) {
      setErr((e as Error).message.slice(0, 220));
      setBusy(null);
    }
  }

  let label = "Confirm position";
  let action: (() => void) | null = confirm;
  let disabled = false;
  if (noEdge) {
    disabled = true;
  } else if (!publicKey) {
    label = "Connect wallet to confirm";
    action = () => setDialog(true);
  } else if (!deployed) {
    label = "Escrow not deployed yet";
    disabled = true;
  } else if (cfg.data && !cfg.data.desk) {
    label = "Desk is not connected to the chain";
    disabled = true;
  } else if (short) {
    label = `Get test USDC`;
    action = cfg.data?.faucetEnabled ? faucet : null;
    disabled = !cfg.data?.faucetEnabled;
  } else if (!server) {
    label = "Waiting for desk quote…";
    disabled = true;
  }
  if (busy) {
    label = busy;
    disabled = true;
  }

  return (
    <div className="flex flex-col gap-3 border-t border-mist pt-6">
      {noEdge && (
        <p className="rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-inkstone">
          Your forecast is too close to the market&apos;s to cover trading costs.
        </p>
      )}
      <button className="btn btn-primary btn-block" disabled={disabled} onClick={() => action?.()}>
        {label}
      </button>
      <p className="text-[14px] text-smoke">
        {quoteErr
          ? `Desk quote failed: ${quoteErr}`
          : server
            ? `Desk quote · ${age}s ago · schedule locked on confirm`
            : "Preview computed in your browser; desk quote pending."}
        {publicKey && bal.data !== undefined ? ` · Balance ${usd(bal.data)}` : ""}
      </p>
      {err && <p className="text-[14px] text-inkstone">{err}</p>}
      {!noEdge && <p className="text-[14px] text-smoke">Expires {settleLabel(ladder.expiry)}. If the desk does not accept within minutes, cancel for a full refund.</p>}
      <WalletDialog open={dialog} onOpenChange={setDialog} />
    </div>
  );
}
