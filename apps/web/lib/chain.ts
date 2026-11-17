"use client";

import { AnchorProvider } from "@anchor-lang/core";
import { configPda, openPositionIx, programFor, readonlyProgram, ata } from "@contour/chain";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { useQuery } from "@tanstack/react-query";
import { desk } from "./desk";
import { env } from "./env";

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
        const b = await connection.getTokenAccountBalance(ata(mint!, owner!));
        return Number(b.value.uiAmount ?? 0);
      } catch {
        return 0;
      }
    },
    refetchInterval: 20_000,
  });
}

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  if (!wallet) return null;
  return programFor(new AnchorProvider(connection, wallet, { commitment: "confirmed" }));
}

export async function sendTx(connection: Connection, wallet: NonNullable<ReturnType<typeof useAnchorWallet>>, tx: Transaction) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}

export { openPositionIx };
