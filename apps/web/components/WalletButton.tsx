"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { short } from "@/lib/format";
import { env, network, networkLabel } from "@/lib/env";

export function useConnectDialog() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

export function WalletDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { wallets, select, connect, wallet, connecting } = useWallet();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detected = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);

  useEffect(() => {
    if (pending && wallet?.adapter.name === pending && !connecting) {
      connect()
        .then(() => onOpenChange(false))
        .catch((e: Error) => setError(e.message))
        .finally(() => setPending(null));
    }
  }, [pending, wallet, connect, connecting, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-inkstone/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[36px] border border-mist bg-porcelain p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">{networkLabel}</p>
              <Dialog.Title className="mt-1 text-[26px] font-bold leading-tight">Connect a wallet</Dialog.Title>
            </div>
            <Dialog.Close className="rounded-full p-2 text-slate hover:bg-cloud" aria-label="Close">
              <X size={20} strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-3 text-slate">
            {network === "localnet" ? (
              <>
                Contour is running on a local Solana validator with test USDC. Point your wallet at <span className="tnum font-bold text-inkstone">{env.rpcUrl}</span>{" "}
                (Phantom: Settings → Developer settings) before signing.
              </>
            ) : network === "mainnet" ? (
              "Contour is running on Solana mainnet. Check every amount before you sign."
            ) : (
              "Contour runs on devnet with test USDC. Switch your wallet to devnet before signing."
            )}
          </Dialog.Description>
          <div className="mt-6 flex flex-col gap-3">
            {detected.length === 0 && (
              <p className="rounded-2xl bg-cloud p-5 text-slate">
                No Solana wallet found. Install{" "}
                <a className="link" href="https://phantom.com" target="_blank" rel="noreferrer">
                  Phantom
                </a>{" "}
                or Solflare, then reload.
              </p>
            )}
            {detected.map((w) => (
              <button
                key={w.adapter.name}
                className="flex items-center gap-4 rounded-2xl bg-cloud px-5 py-4 text-left hover:bg-mist"
                onClick={() => {
                  setError(null);
                  select(w.adapter.name);
                  setPending(w.adapter.name);
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" width={28} height={28} className="rounded-lg" />
                <span className="flex-1 font-medium">{w.adapter.name}</span>
                <span className="text-[14px] text-smoke">{pending === w.adapter.name ? "Connecting…" : "Detected"}</span>
              </button>
            ))}
          </div>
          {error && <p className="mt-4 text-[14px] text-inkstone">Could not connect: {error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function WalletButton() {
  const { publicKey, disconnect } = useWallet();
  const { open, setOpen } = useConnectDialog();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="btn btn-primary opacity-0">Connect wallet</span>;
  if (publicKey) {
    return (
      <button className="btn btn-ghost tnum" onClick={() => disconnect()} title="Disconnect">
        {short(publicKey.toBase58())}
      </button>
    );
  }
  return (
    <>
      <button className="btn btn-primary !px-5 sm:!px-7" onClick={() => setOpen(true)}>
        <span>
          Connect<span className="hidden sm:inline"> wallet</span>
        </span>
      </button>
      <WalletDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
