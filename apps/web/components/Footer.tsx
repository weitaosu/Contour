"use client";

import { useQuery } from "@tanstack/react-query";
import { LogoMark } from "./Logo";
import { desk } from "@/lib/desk";
import { env, explorerAddr } from "@/lib/env";
import { short } from "@/lib/format";

export function Footer() {
  const cfg = useQuery({ queryKey: ["config"], queryFn: desk.config, staleTime: 60_000 });
  const programId = cfg.data?.programId ?? env.programId;
  return (
    <footer className="mt-24 bg-inkstone text-porcelain">
      <div className="page grid gap-10 py-16 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <LogoMark />
            <span className="text-[20px] font-bold tracking-[0.04em]">Contour</span>
          </div>
          <p className="mt-5 max-w-md text-ash">
            What is simulated: the escrow, deposits, collateral and payouts are real Solana devnet transactions with test USDC.
            Hedge fills are simulated at live Gemini quotes (paper mode) and no order reaches Gemini.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="eyebrow !text-smoke">On-chain</p>
          {programId ? (
            <a className="text-porcelain hover:underline tnum" href={explorerAddr(programId)} target="_blank" rel="noreferrer">
              Program {short(programId, 6)}
            </a>
          ) : (
            <span className="text-ash">Program not deployed yet</span>
          )}
          <span className="text-ash">Solana devnet · QuickNode Stream</span>
        </div>
        <div className="flex flex-col gap-2">
          <p className="eyebrow !text-smoke">Data</p>
          <span className="text-ash">Gemini Prediction Markets API</span>
          <a className="text-porcelain hover:underline" href={env.githubUrl} target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
      </div>
      <div className="page border-t border-graphite py-6 text-[14px] text-smoke">
        Built for UBC 2026. Not investment advice; not insurance. Devnet only.
      </div>
    </footer>
  );
}
