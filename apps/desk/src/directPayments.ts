import { createHash } from "node:crypto";
import { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, type ParsedInstruction } from "@solana/web3.js";
import { ata } from "@contour/chain";
import { config } from "./config";
import { loadQuoteByHash, type StoredQuote } from "./markets";
import { addToPosition, addTransfer, openPosition, payerOf, positionDetail, sellPosition, transferRecorded, type SolanaTransfer } from "./paper";
import { solUsd } from "./solPrice";
import { hedgeLegs, setPosition, type HandlerCtx } from "./handler";

/**
 * Demo direct-payment mode: buyers pay devnet SOL (or, for older quotes, test USDC) straight to the
 * desk's one wallet, `config.payTo`, and the desk pays sale proceeds back from it. Every transfer is
 * checked on-chain and recorded on the buyer's portfolio position.
 */

const fail = (msg: string, statusCode = 400) => Object.assign(new Error(msg), { statusCode });

function ready(ctx: HandlerCtx) {
  if (!config.payTo) throw fail("Direct payments are not enabled on this desk.", 404);
  if (!ctx.chain) throw fail("Desk chain access is not configured.", 503);
  return ctx.chain;
}

/** Check a payment on-chain against its quote: exactly the quoted amount, from `owner` to the desk's wallet, within a minute of the quote. Returns when it landed (ms). */
async function confirmPayment(ctx: HandlerCtx, signature: string, owner: string, quote: StoredQuote & { createdAt: number }): Promise<number> {
  const chain = ready(ctx);
  // The transfer must be confirmed: retry briefly while it lands.
  let tx = null;
  for (let i = 0; i < 10 && !tx; i++) {
    tx = await chain.connection.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) await new Promise((r) => setTimeout(r, 800));
  }
  if (!tx) throw fail("The payment transaction wasn't found on-chain.", 404);
  if (tx.meta?.err) throw fail("The payment transaction failed on-chain.");
  const mint = chain.usdcMint.toBase58();
  const dest = ata(chain.usdcMint, new PublicKey(config.payTo)).toBase58();
  const paid = tx.transaction.message.instructions.some((ix) => {
    const p = (ix as ParsedInstruction).parsed as { type?: string; info?: Record<string, unknown> } | undefined;
    const info = p?.info;
    // Quotes priced in SOL are paid with a plain SOL transfer of exactly the quoted lamports.
    if (quote.stakeLamports)
      return (ix as ParsedInstruction).program === "system" && p?.type === "transfer" && info?.source === owner && info?.destination === config.payTo && String(info?.lamports) === quote.stakeLamports;
    const amount = (info?.tokenAmount as { amount?: string } | undefined)?.amount;
    return p?.type === "transferChecked" && info?.mint === mint && info?.destination === dest && info?.authority === owner && amount === quote.stakeBaseUnits;
  });
  if (!paid) throw fail("That transaction isn't a payment of this quote's amount to Contour's account.");
  const at = (tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000;
  if (at - quote.createdAt > config.acceptMaxQuoteAgeMs) throw fail("The quote was more than 60 seconds old when it was paid.");
  return at;
}

const transferFor = (kind: SolanaTransfer["kind"], signature: string, owner: string, quote: StoredQuote, at: number): SolanaTransfer => ({
  kind,
  signature,
  from: owner,
  to: config.payTo,
  lamports: quote.stakeLamports ?? "0",
  solUsd: quote.solUsd ?? null,
  usd: Number(quote.stakeBaseUnits) / 1e6,
  at,
  cluster: "devnet",
});

/**
 * A payment that opens a position: check it, record it as a desk position (hedged like an escrowed
 * one), and open it in the buyer's portfolio (`paperAccount`) with the payment attached, where it can
 * be bought into and sold. Recording the same payment twice is a no-op.
 */
export async function recordDirectPayment(
  ctx: HandlerCtx,
  a: { signature: string; forecastHash: string; owner: string; paperAccount?: string },
): Promise<{ position: string; paperPosition: string | null; paperError?: string }> {
  ready(ctx);
  const quote = loadQuoteByHash(ctx.db, a.forecastHash);
  if (!quote) throw fail("No desk quote matches this payment.", 404);
  const position = new PublicKey(createHash("sha256").update(a.signature).digest()).toBase58();
  // Already recorded: hand back its portfolio position (opening it now if that failed the first time).
  if (ctx.db.prepare("SELECT 1 FROM positions WHERE pubkey = ?").get(position)) return { position, ...(await openPaidPosition(ctx, a, quote, Date.now())) };

  const opened = await confirmPayment(ctx, a.signature, a.owner, quote);
  const schedule = quote.scheduleBaseUnits;
  setPosition(ctx.db, position, {
    owner: a.owner,
    state: "Active",
    ticker: quote.ticker,
    quote_id: quote.quoteId,
    forecast_hash: a.forecastHash,
    stake_base: quote.stakeBaseUnits,
    max_payout_base: String(Math.max(...schedule.map(Number))),
    schedule_json: JSON.stringify(schedule),
    expiry_ts: quote.expiryTs,
    opened_sig: a.signature,
    accepted_sig: a.signature,
    pay_to: config.payTo,
  });
  ctx.hub.publish(position, "opened", { position, signature: a.signature });
  ctx.hub.publish(position, "accepted", { position, signature: a.signature });
  await hedgeLegs(ctx, position, quote, a.signature);
  return { position, ...(await openPaidPosition(ctx, a, quote, opened)) };
}

async function openPaidPosition(
  ctx: HandlerCtx,
  a: { signature: string; owner: string; paperAccount?: string },
  quote: StoredQuote,
  at: number,
): Promise<{ paperPosition: string | null; paperError?: string }> {
  if (!a.paperAccount) return { paperPosition: null };
  const existing = transferRecorded(ctx.db, a.signature);
  if (existing) return { paperPosition: existing };
  try {
    const id = await openPosition(ctx.db, ctx.markets, a.paperAccount, quote.quoteId, undefined, { paid: true });
    addTransfer(ctx.db, id, transferFor("open", a.signature, a.owner, quote, at));
    return { paperPosition: id };
  } catch (err) {
    ctx.log.warn(`[payments] ${a.signature}: couldn't open the portfolio position: ${(err as Error).message}`);
    return { paperPosition: null, paperError: (err as Error).message };
  }
}

/** Buy more of a position paid for on Solana: check the new payment, then add the quote to the position. */
export async function recordAddPayment(ctx: HandlerCtx, a: { signature: string; forecastHash: string; owner: string; paperAccount: string; positionId: string }) {
  ready(ctx);
  const quote = loadQuoteByHash(ctx.db, a.forecastHash);
  if (!quote) throw fail("No desk quote matches this payment.", 404);
  if (!transferRecorded(ctx.db, a.signature)) {
    const at = await confirmPayment(ctx, a.signature, a.owner, quote);
    await addToPosition(ctx.db, ctx.markets, a.paperAccount, a.positionId, quote.quoteId, { paid: true });
    addTransfer(ctx.db, a.positionId, transferFor("add", a.signature, a.owner, quote, at));
  }
  return positionDetail(ctx.db, ctx.markets, a.paperAccount, a.positionId);
}

/**
 * Sell part of a position. One paid for on Solana is paid out in devnet SOL, at today's SOL price, from
 * the desk's wallet to the wallet that paid for it; one opened with practice cash sells to that cash.
 * The desk checks it can cover the payout before selling.
 */
export async function sellForSol(ctx: HandlerCtx, account: string, positionId: string, fraction: number, minProceedsUsd?: number) {
  const payer = config.payTo && ctx.chain ? payerOf(ctx.db, account, positionId) : null;
  let price: number | null = null;
  if (payer && ctx.chain) {
    price = await solUsd();
    // Enough SOL for this share at the mark, plus the fee: checked before anything is sold.
    const before = await positionDetail(ctx.db, ctx.markets, account, positionId);
    const need = Math.ceil(((before.valueUsd * fraction) / price) * 1e9) + 10_000;
    const have = await ctx.chain.connection.getBalance(ctx.chain.desk.publicKey, "confirmed");
    if (have < need)
      throw fail(`The desk's wallet has ${(have / 1e9).toFixed(4)} SOL, not enough to pay this sale (about ${(need / 1e9).toFixed(4)} SOL). Try a smaller share.`, 409);
  }
  const sale = await sellPosition(ctx.db, ctx.markets, account, positionId, fraction, minProceedsUsd);
  let payout: SolanaTransfer | null = null;
  let payoutError: string | undefined;
  if (payer && ctx.chain && price) {
    const lamports = Math.floor((sale.proceedsUsd / price) * 1e9);
    if (lamports > 0) {
      try {
        const desk = ctx.chain.desk;
        const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: desk.publicKey, toPubkey: new PublicKey(payer), lamports }));
        const signature = await sendAndConfirmTransaction(ctx.chain.connection, tx, [desk], { commitment: "confirmed" });
        payout = { kind: "sell", signature, from: desk.publicKey.toBase58(), to: payer, lamports: String(lamports), solUsd: price, usd: sale.proceedsUsd, at: Date.now(), cluster: "devnet" };
        addTransfer(ctx.db, positionId, payout);
      } catch (err) {
        payoutError = (err as Error).message.slice(0, 200);
        ctx.log.warn(`[payments] sale payout for ${positionId} failed: ${payoutError}`);
      }
    }
  }
  return { sale, payout, payoutError, position: await positionDetail(ctx.db, ctx.markets, account, positionId) };
}
