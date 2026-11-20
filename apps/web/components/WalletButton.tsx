"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { Dialog, Popover } from "radix-ui";
import { ArrowUpRight, Check, ChevronRight, Copy, LogOut, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { short, usd } from "@/lib/format";
import { env, explorerAccountNetwork, explorerAddr, network, networkLabel } from "@/lib/env";
import { useDeskConfig, useSolBalance, useSolPrice, useUsdcBalance, useUsdcMint } from "@/lib/chain";

export function useConnectDialog() {
  const [open, setOpen] = useState(false);
  return { open, setOpen };
}

export function WalletDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { wallets, select, connect, wallet, connecting } = useWallet();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detected = wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable);
  const paysInSol = !!useDeskConfig().data?.payTo;

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
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
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
              paysInSol
                ? "Contour runs on Solana devnet: trades are paid in devnet SOL (free from faucet.solana.com). Switch your wallet to devnet before signing."
                : "Contour runs on devnet with test USDC. Switch your wallet to devnet before signing."
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
  const { publicKey } = useWallet();
  const { open, setOpen } = useConnectDialog();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="btn btn-primary opacity-0">Connect wallet</span>;
  if (publicKey) return <WalletMenu address={publicKey.toBase58()} />;
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

/**
 * The connected wallet: the full address (copyable), its balance, the portfolio, and log out. In
 * direct-payment mode trades are paid in devnet SOL, so the balance is the wallet's SOL valued at
 * SOL's live price; otherwise it's the wallet's test USDC.
 */
function WalletMenu({ address }: { address: string }) {
  const { wallet, publicKey, disconnect } = useWallet();
  const paysInSol = !!useDeskConfig().data?.payTo;
  const mint = useUsdcMint();
  const usdcBal = useUsdcBalance(paysInSol ? null : publicKey, mint);
  const solBal = useSolBalance(paysInSol ? publicKey : null);
  const price = useSolPrice();
  const solUsd = paysInSol && solBal.data !== undefined && price.data ? solBal.data * price.data.usd : null;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the address is selectable text */
    }
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="btn btn-ghost tnum" aria-label={`Wallet ${address}. Open wallet menu`}>
        {short(address)}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className="fade-up z-50 w-[min(360px,calc(100vw-32px))] rounded-[24px] border border-mist bg-porcelain p-5 shadow-xl"
        >
          <div className="flex items-center gap-3">
            {wallet?.adapter.icon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={wallet.adapter.icon} alt="" width={28} height={28} className="rounded-lg" />
            )}
            <div className="min-w-0">
              <p className="font-bold leading-tight text-inkstone">{wallet?.adapter.name ?? "Wallet"}</p>
              <p className="text-[13px] text-smoke">Connected · {networkLabel}</p>
            </div>
          </div>

          <p className="stat-label mt-4">Address</p>
          <div className="mt-1.5 flex items-start gap-2 rounded-[16px] bg-cloud px-3.5 py-3">
            <span className="tnum min-w-0 flex-1 select-all break-all font-mono text-[13.5px] leading-snug text-inkstone">{address}</span>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-full p-1.5 text-slate hover:bg-mist hover:text-inkstone"
              aria-label={copied ? "Address copied" : "Copy address"}
              title={copied ? "Copied" : "Copy address"}
            >
              {copied ? <Check size={16} strokeWidth={2.5} className="text-gain" /> : <Copy size={16} strokeWidth={2} />}
            </button>
          </div>

          {paysInSol ? (
            <div className="mt-3 flex items-start justify-between gap-3 text-[14px]">
              <span className="text-slate">Balance</span>
              <span className="text-right">
                <span className="tnum block font-bold text-inkstone">{solUsd !== null ? usd(solUsd) : "…"}</span>
                <span className="tnum block text-[12.5px] text-smoke">
                  {solBal.data !== undefined ? `${solBal.data.toLocaleString("en-US", { maximumFractionDigits: 4 })} SOL` : "…"}
                  {price.data ? ` · ${usd(price.data.usd)}/SOL` : ""}
                </span>
              </span>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between text-[14px]">
              <span className="text-slate">Test USDC</span>
              <span className="tnum font-bold text-inkstone">{usdcBal.data !== undefined ? usd(usdcBal.data) : "…"}</span>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-1 border-t border-mist pt-3 text-[14px]">
            <Link href="/me" onClick={() => setOpen(false)} className="flex items-center justify-between rounded-[12px] px-2 py-2 font-medium text-inkstone hover:bg-cloud">
              My portfolio <ChevronRight size={16} className="text-smoke" />
            </Link>
            <a
              href={explorerAddr(address)}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-[12px] px-2 py-2 font-medium text-inkstone hover:bg-cloud"
            >
              View on Solana Explorer · {explorerAccountNetwork} <ArrowUpRight size={15} className="text-smoke" />
            </a>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                disconnect();
              }}
              className="flex items-center gap-2 rounded-[12px] px-2 py-2 text-left font-bold text-inkstone hover:bg-cloud"
            >
              <LogOut size={16} strokeWidth={2} /> Log out
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
