"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { Buffer } from "buffer";
import { useState, type ReactNode } from "react";
import { env } from "@/lib/env";

if (typeof window !== "undefined" && !(window as unknown as { Buffer?: unknown }).Buffer) {
  (window as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={qc}>
      <ConnectionProvider endpoint={env.rpcUrl} config={{ commitment: "confirmed" }}>
        {/* Wallet Standard wallets (Phantom, Solflare, Backpack) register themselves; no adapters needed. */}
        {/* A declined signature is the user's choice, shown in plain words where it happened: not a console error. */}
        <WalletProvider wallets={[]} autoConnect onError={(e) => !/reject|declin|denied/i.test(e.message ?? "") && console.error(e)}>
          {children}
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>
  );
}
