"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { Dialog } from "radix-ui";
import { Check, X } from "lucide-react";
import { escrowTerms, type Ladder, type Quote } from "@contour/core";
import { desk, type StoredQuote } from "@/lib/desk";
import { openPositionIx, sendTx, useChainConfig, useDeskConfig, useProgram, useUsdcBalance, useUsdcMint } from "@/lib/chain";
import { notableUnused, pct, settleLabel, usd } from "@/lib/format";
import { isWin, runs, whenPhrase } from "@/lib/outcomes";
import { WalletDialog } from "@/components/WalletButton";

const dollars = (n: number) => usd(n, Math.abs(n) >= 100 ? 0 : 2);

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
  const [ack, setAck] = useState(false);
  // Only what's at risk is escrowed: the quote's unused part is never charged, and every payout drops
  // by the same amount, so profit and loss are unchanged. The desk's quote is what gets signed.
  const kept = (server ? Number(server.keptBaseUnits ?? 0) : escrowTerms(quote).keptBase) / 1e6;
  const pay = server ? Number(server.stakeBaseUnits) / 1e6 : stake - kept;
  const keeps = notableUnused(kept);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) setAck(false);
        onOpenChange(o);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-40 bg-inkstone/40" />
        <Dialog.Content className="fade-up fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-[32px] bg-porcelain px-6 pb-8 pt-6 md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[min(560px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[36px] md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow">{confidence === null ? "Review your protection" : "Review your hedge"}</p>
              <Dialog.Title className="mt-1 text-[24px] font-bold leading-tight text-inkstone">{ladder.title}</Dialog.Title>
              <p className="mt-1 text-[14px] text-slate">Settles {settleLabel(ladder.expiry)}</p>
            </div>
            <Dialog.Close className="rounded-full p-2 text-slate hover:bg-cloud" aria-label="Close">
              <X size={20} />
            </Dialog.Close>
          </div>

          <Dialog.Description className="mt-5 rounded-[20px] bg-cloud px-5 py-4 text-[18px] font-bold leading-snug text-inkstone">
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

          <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-[15px]">
            <Row
              label={protection ? "Protection" : "Your view"}
              value={viewLabel.split(" · ").map((part, i) => (
                <span key={i} className="whitespace-nowrap">
                  {i > 0 && " · "}
                  {part}
                </span>
              ))}
            />
            {confidence !== null && <Row label="Follows your view" value={confidence >= 1 ? "100% · full match" : `${pct(confidence)} · safer`} />}
            <Row
              label="You pay"
              value={
                <>
                  {usd(pay)}
                  {keeps && <span className="font-normal text-slate"> · of your {usd(stake)}</span>}
                </>
              }
              strong
            />
            <Row label="What it buys" value={<>{usd(quote.legs.reduce((a, l) => a + l.usd, 0))} of contracts</>} />
            <Row label="Gemini fees" value={<>{usd(quote.feesUsd)} <span className="text-slate">· included above</span></>} />
            {keeps && (
              <Row
                label="Not needed"
                value={
                  <>
                    {usd(kept)}{" "}
                    <span className="text-slate">
                      · {confidence !== null && confidence < 1 ? `following your view at ${pct(confidence)} puts in less` : "the closest match to your view uses less"}
                    </span>
                  </>
                }
              />
            )}
            {protection ? (
              <>
                {protection.floor && (
                  <Row
                    label="Pays out"
                    value={
                      <>
                        up to <span className="font-bold">{usd(quote.maxPayout)}</span> <span className="text-slate">· if it ends below {protection.floor}</span>
                      </>
                    }
                  />
                )}
                {protection.cap && protection.backInMiddle !== undefined ? (
                  <>
                    <Row
                      label={protection.floor ? `If it ends ${protection.floor}–${protection.cap}` : `If it stays below ${protection.cap}`}
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
                ) : (
                  <>
                    <Row label={`If it stays above ${protection.floor}`} value={<>expires · <span className="font-bold">−{usd(stake)}</span></>} />
                    <Row label="Chance it pays out" value={`${pct(protection.chancePays)} by the market's odds`} />
                  </>
                )}
              </>
            ) : (
              <>
                <Row
                  label="Best case"
                  value={
                    <>
                      <span className="font-bold text-gain">+{dollars(quote.maxPayout - stake)}</span>{" "}
                      <span className="text-slate">· {usd(quote.maxPayout - kept)} paid out</span>
                    </>
                  }
                />
                <Row
                  label="Worst case"
                  value={
                    <>
                      <span className="font-bold">−{dollars(stake - quote.minPayout)}</span> <span className="text-slate">· {usd(quote.minPayout - kept)} paid back</span>
                    </>
                  }
                />
                <Row label="Chance of profit" value={`${pct(chance)} by the market's odds`} />
              </>
            )}
          </dl>

          <div className="mt-6 border-t border-mist pt-5">
            <p className="stat-label">When you confirm</p>
            <ol className="mt-3 flex flex-col gap-3 text-[15px] text-inkstone">
              <Step n={1}>
                Your wallet signs one transaction that locks {usd(pay)} and this exact payout schedule on Solana.
                {keeps && <> The other {usd(kept)} isn&apos;t used.</>}
              </Step>
              <Step n={2}>
                The desk buys {quote.legs.length} {quote.legs.length === 1 ? "contract" : "contracts"} to back it. If it doesn&apos;t accept within minutes, you can cancel for a full
                refund.
              </Step>
              <Step n={3}>When the market settles, you&apos;re paid by the schedule automatically. Nothing to sell, nothing to watch.</Step>
            </ol>
          </div>

          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-[16px] border border-mist px-4 py-3 text-[15px] text-inkstone hover:border-ash">
            <span className="relative mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center">
              <input type="checkbox" className="peer absolute inset-0 cursor-pointer opacity-0" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span className="h-5 w-5 rounded-[6px] border-2 border-ash bg-porcelain peer-checked:border-signal-violet peer-checked:bg-signal-violet peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal-violet" />
              <Check size={14} strokeWidth={3} className="pointer-events-none absolute text-white opacity-0 peer-checked:opacity-100" aria-hidden="true" />
            </span>
            <span>
              {protection?.cap && protection.backInMiddle !== undefined ? (
                <>
                  I understand I give up gains above {protection.cap} (up to {protection.capTop}): the higher it ends past {protection.cap}, the less this position
                  pays back, as little as <b className="tnum">{usd(quote.minPayout)}</b> of my {usd(stake)}, while what I hold is worth more.
                </>
              ) : protection ? (
                <>
                  I understand this protection expires worthless if it ends at {protection.floor} or above, and I lose the <b className="tnum">{usd(stake)}</b> it costs.
                </>
              ) : (
                <>
                  I understand I could lose up to <b className="tnum">{usd(stake - quote.minPayout)}</b>
                  {stake - quote.minPayout < pay - 0.005 ? <>, getting back as little as {usd(quote.minPayout - kept)} of the {usd(pay)} I pay</> : <>, everything I pay</>}.
                </>
              )}
            </span>
          </label>

          <ConfirmBlock ladder={ladder} server={server} stake={pay} quoteErr={quoteErr} age={age} ack={ack} />
          <Dialog.Close className="btn btn-quiet btn-block mt-3">Back to edit</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <>
      <dt className="text-slate">{label}</dt>
      <dd className={`tnum text-right text-inkstone ${strong ? "font-bold" : ""}`}>{value}</dd>
    </>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cloud text-[13px] font-bold text-signal-violet">{n}</span>
      <span>{children}</span>
    </li>
  );
}

/** What went wrong with a payment, in words a newcomer can act on (the raw message stays for anything else). */
function paymentError(e: Error): string {
  const m = e.message ?? "";
  if (/reject|declin|denied|cancel/i.test(m)) return "You declined to sign, so nothing was sent and no money moved. Confirm again when you're ready.";
  if (/insufficient (funds|lamports)|no record of a prior credit|debit an account/i.test(m))
    return "Your wallet needs a little SOL for the network fee. Get test USDC again (it includes some SOL), then confirm.";
  if (/blockhash|expired|timed? ?out/i.test(m)) return "The network took too long to confirm, so the transaction lapsed. Nothing moved; confirm again.";
  if (/user ?limit|daily|cap/i.test(m)) return "That's over your per-position or daily limit. Try a smaller amount.";
  return `The payment didn't go through: ${m.slice(0, 200)}`;
}

function ConfirmBlock({ ladder, server, stake, quoteErr, age, ack }: { ladder: Ladder; server: StoredQuote | null; stake: number; quoteErr: string | null; age: number | null; ack: boolean }) {
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
      setErr(paymentError(e as Error));
      setBusy(null);
    }
  }

  let label = `Confirm and sign · ${usd(stake)}`;
  let action: (() => void) | null = confirm;
  let disabled = false;
  if (!publicKey) {
    label = "Connect wallet to confirm";
    action = () => setDialog(true);
  } else if (!deployed) {
    label = "Escrow not deployed yet";
    disabled = true;
  } else if (cfg.data && !cfg.data.desk) {
    label = "Desk is not connected to the chain";
    disabled = true;
  } else if (short) {
    label = "Get test USDC";
    action = cfg.data?.faucetEnabled ? faucet : null;
    disabled = !cfg.data?.faucetEnabled;
  } else if (!server) {
    label = "Waiting for desk quote…";
    disabled = true;
  } else if (!ack) {
    disabled = true;
  }
  if (busy) {
    label = busy;
    disabled = true;
  }

  return (
    <div className="mt-5 flex flex-col gap-3">
      <button className="btn btn-primary btn-block" disabled={disabled} onClick={() => action?.()}>
        {label}
      </button>
      <p className="text-[14px] text-smoke">
        {quoteErr
          ? `Desk quote failed: ${quoteErr}`
          : server
            ? `Desk quote · ${age}s ago · prices lock when you sign`
            : "Preview computed in your browser; desk quote pending."}
        {publicKey && bal.data !== undefined ? ` · Balance ${usd(bal.data)}` : ""}
        {` · Expires ${settleLabel(ladder.expiry)}`}
      </p>
      {err && <p className="text-[14px] text-inkstone">{err}</p>}
      <WalletDialog open={dialog} onOpenChange={setDialog} />
    </div>
  );
}
