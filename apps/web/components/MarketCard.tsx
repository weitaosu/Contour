import Link from "next/link";
import type { MarketSummary } from "@/lib/desk";
import { settleLabel, untilLabel } from "@/lib/format";
import { Sparkline } from "./charts/Sparkline";

export function MarketCard({ m }: { m: MarketSummary }) {
  const kind = m.kind === "threshold" ? `${m.strikeCount} strikes` : `${m.bucketCount} outcomes`;
  return (
    <Link href={`/m/${m.ticker}`} className="card group ease flex flex-col gap-4 !p-6 hover:-translate-y-1 hover:bg-[#f1f0fe]">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow truncate">{m.category}</span>
        <span className="text-[14px] text-smoke tnum">{untilLabel(m.expiry)}</span>
      </div>
      <h3 className="card-title ease text-inkstone group-hover:text-signal-violet">{m.title}</h3>
      <Sparkline values={m.marketProb} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="tag tag-white">{kind}</span>
        <span className="tag tag-white tnum">{m.quotedCount} quoted</span>
        <span className="ml-auto text-[14px] text-smoke">{settleLabel(m.expiry)}</span>
      </div>
    </Link>
  );
}
