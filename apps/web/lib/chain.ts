"use client";

import { AnchorProvider } from "@anchor-lang/core";
import { configPda, openPositionIx, programFor, readonlyProgram, ata } from "@contour/chain";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { desk } from "./desk";
import { env } from "./env";

/**
 * The public devnet node (api.devnet.solana.com) rate-limits hard: a handful of quick requests from one
 * machine and it answers HTTP 429 for several seconds. Every read and send below treats that as "busy,
 * try again", never as an answer, so a throttled balance read can't pass for an empty wallet.
 */
export const isRateLimited = (e: unknown) => /429|rate limit|too many requests/i.test(String((e as Error)?.message ?? e));
const isNetworkError = (e: unknown) => /failed to fetch|network ?error|fetch failed|load failed|econnreset|timed? ?out|503|502|504/i.test(String((e as Error)?.message ?? e));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs an RPC call again, with backoff, while the node is rate-limiting or the network drops; anything else throws at once. */
export async function withRpcRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let delay = 700;
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries - 1 || !(isRateLimited(e) || isNetworkError(e))) throw e;
      await pause(delay + Math.random() * 400);
      delay = Math.min(delay * 2, 6_000);
    }
  }
}

export function useDeskConfig() {
  return useQuery({ queryKey: ["config"], queryFn: desk.config, staleTime: 60_000 });
}

export function useUsdcMint(): PublicKey | null {
  const cfg = useDeskConfig();
  const m = cfg.data?.usdcMint ?? env.usdcMint;
  try {
    return m ? new PublicKey(m) : null;
  } catch {
    return null;
  }
}

/** On-chain Config (max stake etc.). Null when the program is not initialized yet. */
export function useChainConfig() {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["chain-config"],
    queryFn: async () => {
      try {
        const c = await readonlyProgram(connection).account.config.fetch(configPda());
        return {
          maxStake: Number(c.maxStake.toString()) / 1e6,
          maxDailyStake: Number(c.maxDailyStake.toString()) / 1e6,
          acceptTimeoutSecs: Number(c.acceptTimeoutSecs.toString()),
          settleGraceSecs: Number(c.settleGraceSecs.toString()),
          desk: c.desk.toBase58(),
          oracle: c.oracle.toBase58(),
          usdcMint: c.usdcMint.toBase58(),
        };
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useUsdcBalance(owner: PublicKey | null | undefined, mint: PublicKey | null) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["usdc", owner?.toBase58(), mint?.toBase58()],
    enabled: !!owner && !!mint,
    queryFn: async () => {
      try {
        // "confirmed", so a payment or faucet claim shows up right away rather than after finalization.
        const b = await connection.getTokenAccountBalance(ata(mint!, owner!), "confirmed");
        return Number(b.value.uiAmount ?? 0);
      } catch (e) {
        // A rate-limited or failed read throws, so react-query keeps the last known balance and retries;
        // only a wallet with no token account yet really holds 0.
        if (isRateLimited(e) || isNetworkError(e)) throw e;
        return 0;
      }
    },
    refetchInterval: 20_000,
    retry: 4,
    retryDelay: (n) => Math.min(1_500 * 2 ** n, 10_000),
  });
}

/** SOL in dollars (Gemini's SOL/USD, via the desk), refreshed every 30 s: what devnet SOL balances are valued at. */
export function useSolPrice() {
  return useQuery({
    queryKey: ["sol-price"],
    queryFn: () => fetch(`${env.deskUrl}/prices/sol`).then((r) => (r.ok ? (r.json() as Promise<{ usd: number; at: number }>) : Promise.reject(new Error(`${r.status}`)))),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/** The wallet's SOL balance, in SOL. */
export function useSolBalance(owner: PublicKey | null | undefined) {
  const { connection } = useConnection();
  return useQuery({
    queryKey: ["sol", owner?.toBase58()],
    enabled: !!owner,
    // No catch: a rate-limited or failed read keeps the last known balance (and retries) instead of reading as 0,
    // which used to send wallets full of devnet SOL to the faucet.
    queryFn: async () => (await connection.getBalance(owner!, "confirmed")) / 1e9,
    refetchInterval: 20_000,
    retry: 4,
    retryDelay: (n) => Math.min(1_500 * 2 ** n, 10_000),
  });
}

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  if (!wallet) return null;
  return programFor(new AnchorProvider(connection, wallet, { commitment: "confirmed" }));
}

/** The wallet signed too late for its quote: the transaction was never sent, so nothing moved. */
export class QuoteExpiredError extends Error {
  constructor() {
    super("The quote expired while the wallet was open, so nothing was sent. Confirm again at the new price.");
    this.name = "QuoteExpiredError";
  }
}

/** Sent, but not confirmed in time. It may still land, so `signature` lets the caller check (the desk verifies on-chain). */
export class TxUnconfirmedError extends Error {
  constructor(readonly signature: string) {
    super(`Sent, but Solana devnet hasn't confirmed it yet (${signature.slice(0, 8)}…). Check your wallet's activity before trying again.`);
    this.name = "TxUnconfirmedError";
  }
}

/**
 * Sign once, send, and wait for "confirmed", riding out the public node's rate limits:
 * - every RPC call retries on 429s and dropped connections;
 * - confirmation polls the signature (no websocket) and re-broadcasts the same signed bytes every few
 *   seconds, which is safe (same signature, it can land only once) and gets past dropped sends;
 * - `notAfter` (ms): if the wallet comes back after it, the signed transaction is thrown away unsent,
 *   so a payment the desk would refuse for a stale quote never leaves the wallet.
 */
export async function sendTx(connection: Connection, wallet: NonNullable<ReturnType<typeof useAnchorWallet>>, tx: Transaction, opts: { notAfter?: number } = {}) {
  const { blockhash, lastValidBlockHeight } = await withRpcRetry(() => connection.getLatestBlockhash("confirmed"));
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  const signed = await wallet.signTransaction(tx);
  if (opts.notAfter && Date.now() > opts.notAfter) throw new QuoteExpiredError();
  const raw = signed.serialize();
  // Preflight stays on for the first send, so a real problem (not enough SOL, a program error) shows up now.
  const sig = await withRpcRetry(() => connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 2 }));

  const started = Date.now();
  let lastSend = started;
  let lastHeightCheck = started;
  for (;;) {
    await pause(1_200);
    try {
      const status = (await connection.getSignatureStatuses([sig])).value[0];
      if (status?.err) throw new Error(`The transaction failed on-chain: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return sig;
    } catch (e) {
      if (!(isRateLimited(e) || isNetworkError(e))) throw e;
    }
    const now = Date.now();
    if (now - lastSend > 4_000) {
      lastSend = now;
      connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }
    // Past its blockhash it can never land: say so rather than wait forever.
    if (now - lastHeightCheck > 8_000) {
      lastHeightCheck = now;
      const height = await connection.getBlockHeight("confirmed").catch(() => null);
      if (height !== null && height > lastValidBlockHeight) {
        const last = await connection.getSignatureStatuses([sig], { searchTransactionHistory: true }).catch(() => null);
        const st = last?.value[0];
        if (st && !st.err && st.confirmationStatus) return sig;
        if (last) throw new Error("Solana devnet didn't include the transaction before it expired, so nothing moved. Confirm again.");
      }
    }
    if (now - started > 90_000) throw new TxUnconfirmedError(sig);
  }
}

export { openPositionIx };
