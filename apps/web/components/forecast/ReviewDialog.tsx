"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { Dialog } from "radix-ui";
import { Check, X } from "lucide-react";
import { escrowTerms, type Ladder, type Quote } from "@contour/core";
import { desk, type StoredQuote } from "@/lib/desk";
import { openPositionIx, sendTx, useChainConfig, useDeskConfig, useProgram, useSolBalance, useUsdcBalance, useUsdcMint } from "@/lib/chain";
import { notableUnused, pct, settleLabel, short, usd } from "@/lib/format";
import { explorerTx } from "@/lib/env";
import { usePaperAccount } from "@/lib/paper";
import { isWin, runs, whenPhrase } from "@/lib/outcomes";
import { WalletDialog } from "@/components/WalletButton";
import { FOCUS_PANEL } from "@/components/forecast/Panel";
import { Tile } from "@/components/forecast/ProfitCard";
import { s as lp } from "@/components/landing/styles";
import { fontVars } from "@/components/landing/fonts";

const dollars = (n: number) => usd(n, Math.abs(n) >= 100 ? 0 : 2);
const sol = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL`;
/** The quote's stake in devnet SOL (direct-payment mode), or null before the desk quotes it. */
const solOf = (q: StoredQuote | null) => (q?.stakeLamports ? Number(q.stakeLamports) / 1e9 : null);
const SOL_FAUCET = "https://faucet.solana.com";
/** Headroom for the network fee on top of the stake. */
const FEE_SOL = 0.00001;

/**
 * The last screen before signing: the position in plain words, what happens on confirm, and an
 * explicit acknowledgement of the worst case. Owns the wallet / faucet / open-position flow.
 */
export function ReviewDialog({
  open,
  onOpenChange,
  ladder,
  quote,
  stake,
  confidence,
  viewLabel,
  headline,
  protection,
  server,
  quoteErr,
  age,
}: {
  /** Protect-what-I-hold: describe it as insurance (pays out / expires) rather than best/worst case. */
  /** floor is null for a covered call (a cap with no protection below). */
  protection?: { floor: string | null; chancePays: number; cap?: string; capTop?: string; backInMiddle?: number };
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ladder: Ladder;
  quote: Omit<Quote, "raw">;
  stake: number;
  /** null for protection, which carries no view. */
  confidence: number | null;
  viewLabel: string;
  /** Replaces the "you make money if…" sentence (protection describes what it covers instead). */
  headline?: string;
  server: StoredQuote | null;
  quoteErr: string | null;
  age: number | null;
}) {
  const payouts = quote.payoutByBucket;
  const wins = payouts.map((p) => isWin(p, stake));
  const zones = runs(wins, (w) => w);
  const chance = ladder.marketProb.reduce((s, p, j) => s + (wins[j] ? p : 0), 0);
  // Direct-payment mode: the USDC goes straight to this wallet instead of an escrow.
  const payTo = useDeskConfig().data?.payTo ?? null;
  // Only what's at risk is escrowed: the quote's unused part is never charged, and every payout drops
  // by the same amount, so profit and loss are unchanged. The desk's quote is what gets signed.
  const kept = (server ? Number(server.keptBaseUnits ?? 0) : escrowTerms(quote).keptBase) / 1e6;
  const pay = server ? Number(server.stakeBaseUnits) / 1e6 : stake - kept;
  const keeps = notableUnused(kept);
  const solPay = solOf(server);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        {/* In the market page's look (lp-app), since the portal renders outside that page's wrapper. On wide
            screens it's two columns, so the whole review fits on a laptop screen without scrolling. */}
        <Dialog.Content
          className={`${lp.root} ${lp.app} ${fontVars} fade-up fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-24px)] flex-col overflow-hidden rounded-t-[20px] bg-porcelain shadow-[0_24px_64px_-24px_rgba(0,0,0,0.45)] md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[calc(100dvh-48px)] md:w-[min(600px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[20px] lg:w-[min(980px,calc(100vw-64px))]`}
        >
          {/* Header: stays put while the details scroll */}
          <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-6 md:px-7">
            <div className="min-w-0">
              <p className="text-[13.5px] text-smoke">{confidence === null ? "Review your protection" : "Review your hedge"}</p>
              <Dialog.Title className="mt-1 text-[28px] leading-tight text-inkstone">{ladder.title}</Dialog.Title>
              <p className="mt-1 text-[13.5px] text-slate">Settles {settleLabel(ladder.expiry)}</p>
            </div>
            <Dialog.Close className="-mr-2 rounded-full p-2 text-slate hover:bg-cloud" aria-label="Close">
              <X size={20} />
            </Dialog.Close>
          </div>

          {/* Scrolls on small screens without showing a scrollbar; the fade at the bottom says there's more. */}
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pb-5 pt-1.5 [mask-image:linear-gradient(to_bottom,#000_calc(100%-20px),transparent)] [scrollbar-width:none] md:px-7 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6 [&::-webkit-scrollbar]:hidden" data-scroll-body>
            {/* left on wide screens: the outcome in one line and the numbers that matter */}
            <div className="min-w-0">
            <Dialog.Description className={`rounded-[24px] px-5 py-3 text-[17px] font-bold leading-snug text-inkstone ${FOCUS_PANEL}`}>
              {headline ? (
                headline
              ) : zones.length ? (
                <>
                  You make money <span className="text-signal-violet">{whenPhrase(ladder, zones)}</span>.
                </>
              ) : (
                <>At this setting your money barely moves.</>
              )}
            </Dialog.Description>

            {/* The numbers that matter, as tiles */}
            <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-[24px] bg-cloud p-1.5">
              <Tile compact label="You pay" value={usd(pay)} sub={payTo ? (solPay !== null ? `≈ ${sol(solPay)} on devnet` : "in devnet SOL") : keeps ? `of your ${usd(stake)}` : "test USDC"} />
              {protection ? (
                <>
                  <Tile compact label="Pays out" value={protection.floor ? `up to ${usd(quote.maxPayout)}` : usd(protection.backInMiddle ?? quote.maxPayout)} sub={protection.floor ? `if it ends below ${protection.floor}` : `if it stays below ${protection.cap}`} />
                  <Tile compact label="If it expires" value={`−${usd(stake)}`} sub={protection.floor ? `at ${protection.floor} or above` : "the most it costs"} />
                  <Tile compact label="Chance it pays" value={pct(protection.chancePays)} sub="by the market's odds" />
                </>
              ) : (
                <>
                  <Tile compact label="Best case" value={<span className="text-gain">+{dollars(quote.maxPayout - stake)}</span>} sub={`${usd(quote.maxPayout - kept)} paid out`} />
                  <Tile compact label="Worst case" value={`−${dollars(stake - quote.minPayout)}`} sub={`${usd(quote.minPayout - kept)} paid back`} />
                  <Tile compact label="Chance of profit" value={pct(chance)} sub="by the market's odds" />
                </>
              )}
            </div>

            </div>

            {/* right on wide screens: the details behind them, and what happens on confirm */}
            <div className="min-w-0">
            <dl className="mt-2 rounded-[24px] bg-cloud px-4 py-0.5 text-[14px] lg:mt-0">
              <Row
                label={protection ? "Protection" : "Your view"}
                value={viewLabel.split(" · ").map((part, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    {part}
                  </span>
                ))}
              />
              {confidence !== null && <Row label="Follows your view" value={confidence >= 1 ? "100% · full match" : `${pct(confidence)} · safer`} />}
              <Row label="What it buys" value={<>{usd(quote.legs.reduce((a, l) => a + l.usd, 0))} of contracts</>} />
              <Row label="Gemini fees" value={<>{usd(quote.feesUsd)} <span className="text-slate">· included</span></>} />
              {keeps && (
                <Row
                  label="Not needed"
                  value={
                    <>
                      {usd(kept)} <span className="text-slate">· {confidence !== null && confidence < 1 ? "following your view less puts in less" : "the closest match uses less"}</span>
                    </>
                  }
                />
              )}
              {protection?.cap && protection.backInMiddle !== undefined && (
                <>
                  <Row
                    label={protection.floor ? `Ends ${protection.floor}–${protection.cap}` : `Stays below ${protection.cap}`}
                    value={
                      protection.backInMiddle >= stake ? (
                        <>
                          {usd(protection.backInMiddle)} back · <span className="font-bold text-gain">income {usd(protection.backInMiddle - stake)}</span>
                        </>
                      ) : (
                        <>
                          {usd(protection.backInMiddle)} back · <span className="font-bold">net cost {usd(stake - protection.backInMiddle)}</span>
                        </>
                      )
                    }
                  />
                  <Row label={`Gains above ${protection.cap}`} value={<>given up, up to {protection.capTop}</>} />
                </>
              )}
            </dl>

            <div className="mt-4">
              <p className="text-[13.5px] text-smoke">When you confirm</p>
              {payTo ? (
                <ol className="mt-2.5 flex flex-col gap-2.5 text-[14px] text-inkstone">
                  <Step n={1}>
                    Your wallet signs one transaction that sends <b className="tnum">{solPay !== null ? sol(solPay) : "the SOL"}</b> on devnet straight to Contour&apos;s account{" "}
                    <span className="tnum font-bold">{short(payTo, 4)}</span>
                    {server?.solUsd ? (
                      <>
                        {" "}
                        ({usd(pay)} at an estimated {usd(server.solUsd)} per SOL)
                      </>
                    ) : null}
                    .{keeps && <> The other {usd(kept)} isn&apos;t used.</>}
                  </Step>
                  <Step n={2}>The position opens in your wallet right away, valued live, where you can buy more or sell. The payment is linked on it.</Step>
                </ol>
              ) : (
                <ol className="mt-2.5 flex flex-col gap-2.5 text-[14px] text-inkstone">
                  <Step n={1}>
                    Your wallet signs one transaction that locks {usd(pay)} and this exact payout schedule on Solana.
                    {keeps && <> The other {usd(kept)} isn&apos;t used.</>}
                  </Step>
                  <Step n={2}>
                    The desk buys {quote.legs.length} {quote.legs.length === 1 ? "contract" : "contracts"} to back it. If it doesn&apos;t accept within minutes, you can cancel for a
                    full refund.
                  </Step>
                  <Step n={3}>When the market settles, you&apos;re paid by the schedule automatically. Nothing to sell, nothing to watch.</Step>
                </ol>
              )}
            </div>
            </div>
          </div>

          {/* Footer: the risk notice and the button, always in view */}
          <div className="border-t border-mist px-6 pb-5 pt-3 md:px-7 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-6 lg:pt-4">
            <p className="rounded-[18px] bg-cloud px-4 py-2.5 text-[13.5px] leading-snug text-slate">
              Prediction markets are volatile and prices can move fast. Only trade what you can afford to lose. Not investment advice.
            </p>
            <div className="min-w-0">
              <ConfirmBlock ladder={ladder} server={server} stake={pay} payTo={payTo} quoteErr={quoteErr} age={age} />
              <Dialog.Close className="mt-1 w-full rounded-full py-1.5 text-[14px] font-medium text-slate hover:bg-cloud hover:text-inkstone">Back to edit</Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-mist py-2 first:border-t-0">
      <dt className="shrink-0 whitespace-nowrap text-slate">{label}</dt>
      <dd className={`tnum min-w-0 text-right text-inkstone ${strong ? "font-bold" : ""}`}>{value}</dd>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tnum mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-signal-violet text-[12px] font-bold text-white" aria-hidden="true">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** What went wrong with a payment, in words a newcomer can act on (the raw message stays for anything else). */
function paymentError(e: Error): string {
  const m = e.message ?? "";
  if (/reject|declin|denied|cancel/i.test(m)) return "You declined to sign, so nothing was sent and no money moved. Confirm again when you're ready.";
  if (/insufficient (funds|lamports)|no record of a prior credit|debit an account/i.test(m))
    return `Your wallet doesn't have enough devnet SOL. Get some free at ${SOL_FAUCET}, then confirm.`;
  if (/blockhash|expired|timed? ?out/i.test(m)) return "The network took too long to confirm, so the transaction lapsed. Nothing moved; confirm again.";
  if (/user ?limit|daily|cap/i.test(m)) return "That's over your per-position or daily limit. Try a smaller amount.";
  return `The payment didn't go through: ${m.slice(0, 200)}`;
}

function ConfirmBlock({
  ladder,
  server,
  stake,
  payTo,
  quoteErr,
  age,
}: {
  ladder: Ladder;
  server: StoredQuote | null;
  stake: number;
  /** Demo direct-payment mode: send the USDC straight to this wallet instead of opening an escrow. */
  payTo: string | null;
  quoteErr: string | null;
  age: number | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const anchorWallet = useAnchorWallet();
  const program = useProgram();
  const mint = useUsdcMint();
  const cfg = useDeskConfig();
  const chainCfg = useChainConfig();
  const usdcBal = useUsdcBalance(publicKey, payTo ? null : mint);
  const solBal = useSolBalance(publicKey);
  // Direct payment charges devnet SOL; the escrow flow charges USDC.
  const bal = payTo ? solBal : usdcBal;
  const solPay = solOf(server);
  const paperAccount = usePaperAccount();
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Set only if the payment went through but couldn't be saved as a position (shown instead of the button).
  const [paid, setPaid] = useState<{ sig: string; amount: number; to: string; problem: string } | null>(null);

  // Direct payment is a plain SOL transfer; the escrow flow needs the program and the USDC mint.
  const deployed = payTo ? true : !!chainCfg.data && !!mint;
  const lacking = bal.data !== undefined && (payTo ? solPay !== null && bal.data < solPay + FEE_SOL : bal.data < stake);

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

  /** Demo direct payment: one devnet SOL transfer from the buyer straight to `payTo`, at the quote's SOL price. */
  async function payDirect() {
    if (!publicKey || !anchorWallet || !server?.stakeLamports || !payTo) return;
    setErr(null);
    try {
      setBusy("Waiting for your signature…");
      const lamports = BigInt(server.stakeLamports);
      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: publicKey, toPubkey: new PublicKey(payTo), lamports }));
      setBusy(`Sending ${sol(Number(lamports) / 1e9)}…`);
      const sig = await sendTx(connection, anchorWallet, tx);
      await qc.invalidateQueries({ queryKey: ["sol"] });
      // Save it as a position (the desk checks the transfer on-chain), then open its page.
      setBusy("Saving your position…");
      try {
        const r = await desk.recordPayment({ signature: sig, forecastHash: server.forecastHash, owner: publicKey.toBase58(), paperAccount: paperAccount ?? undefined });
        await qc.invalidateQueries({ queryKey: ["paper"] });
        // Open it in the portfolio, where it can be bought into and sold; the payment-only page if that failed.
        router.push(r.paperPosition ? `/portfolio/${r.paperPosition}?opened=1` : `/p/${r.position}`);
      } catch (e) {
        setPaid({ sig, amount: Number(lamports) / 1e9, to: payTo, problem: (e as Error).message });
        setBusy(null);
      }
    } catch (e) {
      setErr(paymentError(e as Error));
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
      setErr(paymentError(e as Error));
      setBusy(null);
    }
  }

  let label = payTo ? `Confirm and pay · ${solPay !== null ? sol(solPay) : usd(stake)}` : `Confirm and sign · ${usd(stake)}`;
  let action: (() => void) | null = payTo ? payDirect : confirm;
  let disabled = false;
  if (!publicKey) {
    label = "Connect wallet to confirm";
    action = () => setDialog(true);
  } else if (!deployed) {
    label = payTo ? "Test USDC not set up yet" : "Escrow not deployed yet";
    disabled = true;
  } else if (!payTo && cfg.data && !cfg.data.desk) {
    label = "Desk is not connected to the chain";
    disabled = true;
  } else if (lacking && payTo) {
    label = "Get devnet SOL";
    action = () => window.open(SOL_FAUCET, "_blank", "noopener,noreferrer");
  } else if (lacking) {
    label = "Get test USDC";
    action = cfg.data?.faucetEnabled ? faucet : null;
    disabled = !cfg.data?.faucetEnabled;
  } else if (!server || (payTo && solPay === null)) {
    label = "Waiting for desk quote…";
    disabled = true;
  }
  if (busy) {
    label = busy;
    disabled = true;
  }

  if (paid)
    return (
      <div className="mt-5 flex flex-col gap-2 rounded-[24px] bg-cloud px-5 py-4 text-[15px] text-inkstone lg:mt-0" role="status">
        <p className="flex items-center gap-2 font-bold">
          <Check size={18} strokeWidth={3} className="text-gain" aria-hidden="true" /> Paid {sol(paid.amount)} to {short(paid.to, 4)}
        </p>
        <p className="text-[14px] text-slate">The transfer is confirmed on Solana, but the desk couldn&apos;t save it as a position: {paid.problem}</p>
        <a className="link text-[14px] font-bold" href={explorerTx(paid.sig)} target="_blank" rel="noreferrer">
          View the transaction · {short(paid.sig, 6)}
        </a>
      </div>
    );

  return (
    <div className="mt-3 flex flex-col gap-2 lg:mt-0">
      <button className="btn btn-primary btn-block" disabled={disabled} onClick={() => action?.()}>
        {label}
      </button>
      <p className="text-center text-[12.5px] text-smoke">
        {quoteErr
          ? `Desk quote failed: ${quoteErr}`
          : server
            ? `Desk quote · ${age}s ago${payTo ? "" : " · prices lock when you sign"}`
            : "Preview computed in your browser; desk quote pending."}
        {publicKey && bal.data !== undefined ? ` · Balance ${payTo ? sol(bal.data) : usd(bal.data)}` : ""}
        {payTo && server?.solUsd ? ` · SOL ≈ ${usd(server.solUsd)} (estimate)` : ""}
        {` · Expires ${settleLabel(ladder.expiry)}`}
      </p>
      {err && <p className="text-[14px] text-inkstone">{err}</p>}
      <WalletDialog open={dialog} onOpenChange={setDialog} />
    </div>
  );
}
