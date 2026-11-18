import { memo } from "react";
import type { Quote } from "@contour/core";
import { cents, pct, usd } from "@/lib/format";

export function ComparisonCard({ quote, stake, bare }: { quote: Omit<Quote, "raw">; stake: number; bare?: boolean }) {
  const c = quote.comparison;
  return (
    <section className={bare ? "grid gap-5" : "card grid gap-6 md:grid-cols-[1fr_1.1fr] md:items-start"}>
      <div>
        <p className="eyebrow">Instead, one contract</p>
        <h3 className="card-title mt-1">
          {c ? (
            <>
              {c.side.toUpperCase()} &ldquo;{c.label}&rdquo; at {cents(c.price)}
            </>
          ) : (
            "No single contract is quoted"
          )}
        </h3>
        <p className="mt-1 text-[14px] text-slate">The best single bet for the same forecast, with the same {usd(stake, 0)}.</p>
      </div>
      {c && (
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-3 text-[15px]">
          <span />
          <span className="stat-label text-right">One contract</span>
          <span className="stat-label text-right !text-signal-violet">Contour</span>
          <span className="text-slate">Pays if right</span>
          <span className="tnum text-right font-bold">{usd(c.payoutIfWin)}</span>
          <span className="tnum text-right font-bold">{usd(quote.maxPayout)}</span>
          <span className="text-slate">Worst case</span>
          <span className="tnum text-right font-bold">$0.00</span>
          <span className="tnum text-right font-bold">{usd(quote.minPayout)}</span>
          <span className="text-slate">Profit, your forecast</span>
          <span className="tnum text-right font-bold">{pct(c.probWinBelief)}</span>
          <span className="tnum text-right font-bold">{pct(quote.probProfitBelief)}</span>
          <span className="text-slate">Profit, market&apos;s</span>
          <span className="tnum text-right font-bold">{pct(c.probWinMarket)}</span>
          <span className="tnum text-right font-bold">{pct(quote.probProfitMarket)}</span>
        </div>
      )}
    </section>
  );
}

/** The single-contract alternative in three lines: what it is, then it vs yours on the numbers that matter. */
export const CompareMini = memo(function CompareMini({ quote, stake }: { quote: Omit<Quote, "raw">; stake: number }) {
  const c = quote.comparison;
  if (!c) return null;
  const rows: [string, string, string][] = [
    ["Best case", usd(c.payoutIfWin), usd(quote.maxPayout)],
    ["Worst case", "$0.00", usd(quote.minPayout)],
    ["Profit chance", pct(c.probWinMarket), pct(quote.probProfitMarket)],
  ];
  return (
    <div>
      <p className="text-[13.5px] text-inkstone">
        All {usd(stake, 0)} on{" "}
        <b>
          {c.side.toUpperCase()} &ldquo;{c.label}&rdquo;
        </b>{" "}
        at {cents(c.price)}:
      </p>
      <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-[13.5px]">
        <span />
        <span className="text-right text-[12px] uppercase tracking-[0.075em] text-smoke">One</span>
        <span className="text-right text-[12px] uppercase tracking-[0.075em] text-signal-violet">Yours</span>
        {rows.map(([label, one, yours]) => (
          <span key={label} className="contents">
            <span className="whitespace-nowrap text-slate">{label}</span>
            <span className="tnum text-right font-bold text-inkstone">{one}</span>
            <span className="tnum text-right font-bold text-inkstone">{yours}</span>
          </span>
        ))}
      </div>
    </div>
  );
});
