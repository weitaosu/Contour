"use client";

import { memo, useState } from "react";
import type { Quote } from "@contour/core";
import { cents, notableUnused, qty, usd } from "@/lib/format";

/** The contracts behind a position (and the part of the amount it doesn't need), with where the prices come from. */
export const LegsTable = memo(function LegsTable({
  quote,
  paper,
  crossed,
  compact = false,
  limit,
}: {
  quote: Omit<Quote, "raw">;
  paper: boolean;
  crossed: string[];
  compact?: boolean;
  /** Compact only: show this many contracts and a toggle for the rest, so a long list stays short. */
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  if (compact) {
    const total = quote.legs.reduce((a, l) => a + l.usd, 0) + quote.feesUsd;
    // One hidden row isn't worth a toggle: only collapse when it hides two or more (or all of them, at 0).
    const collapsible = limit !== undefined && (limit === 0 ? quote.legs.length > 0 : quote.legs.length > limit + 1);
    const legs = collapsible && !all ? quote.legs.slice(0, limit) : quote.legs;
    // A narrow list, not a table: each contract's cost on its own line with the name, the size and
    // price quietly underneath, so nothing has to share a column in a slim panel.
    return (
      <div title={crossed.length ? `Crossed quotes skipped: ${crossed.join(", ")}` : undefined}>
        {legs.length > 0 && (
        <ul className="divide-y divide-mist border-y border-mist">
          {legs.map((l) => (
            <li key={`${l.symbol}-${l.side}`} className="flex items-start justify-between gap-3 py-1.5">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[13.5px] leading-snug text-inkstone">
                  <span className="shrink-0 rounded-full bg-mist px-1.5 py-px text-[10.5px] font-bold">{l.side.toUpperCase()}</span>
                  <span className="truncate">{l.label}</span>
                </span>
                <span className="tnum block text-[12px] text-smoke">
                  {qty(l.qty)} contracts at {cents(l.price)}
                </span>
              </span>
              <span className="tnum shrink-0 text-[13.5px] font-bold leading-snug text-inkstone">{usd(l.usd)}</span>
            </li>
          ))}
        </ul>
        )}
        {collapsible && (
          <button type="button" aria-expanded={all} onClick={() => setAll((a) => !a)} className="mt-1.5 text-[12.5px] font-bold text-signal-violet hover:underline">
            {all ? "Show fewer" : `Show all ${quote.legs.length} contracts`}
          </button>
        )}
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <b className="text-[14px] text-inkstone">You pay</b>
          <b className="tnum text-[15px] text-inkstone">{usd(total)}</b>
        </div>
        <p className="text-[12px] text-smoke">
          Includes {usd(quote.feesUsd)} in fees{notableUnused(quote.cashUsd) ? <> · {usd(quote.cashUsd)} of your budget isn&apos;t needed</> : null}
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] sm:text-[14px]">
          <thead>
            <tr className="text-left text-smoke">
              <th className="pb-2 font-medium">Side</th>
              <th className="pb-2 font-medium">Contract</th>
              <th className="pb-2 text-right font-medium">Price</th>
              <th className="pb-2 text-right font-medium">Qty</th>
              <th className="pb-2 text-right font-medium">Cost</th>
              <th className="pb-2 text-right font-medium">Fee</th>
            </tr>
          </thead>
          <tbody className="text-inkstone">
            {quote.legs.map((l) => (
              <tr key={`${l.symbol}-${l.side}`} className="border-t border-mist">
                <td className="py-2 font-bold">{l.side.toUpperCase()}</td>
                <td className="py-2">
                  {l.label}
                  {l.capped && <span className="ml-2 text-smoke">capped at quoted size</span>}
                </td>
                <td className="tnum py-2 text-right">{cents(l.price)}</td>
                <td className="tnum py-2 text-right">{qty(l.qty)}</td>
                <td className="tnum py-2 text-right">{usd(l.usd)}</td>
                <td className="tnum py-2 text-right">{usd(l.fee)}</td>
              </tr>
            ))}
            <tr className="border-t border-mist">
              <td className="py-2 font-bold">Unused</td>
              <td className="py-2 text-slate">not needed for this view, not charged</td>
              <td />
              <td />
              <td className="tnum py-2 text-right">{usd(quote.cashUsd)}</td>
              <td />
            </tr>
            <tr className="border-t border-mist font-bold">
              <td className="py-2" colSpan={4}>
                Total
              </td>
              <td className="tnum py-2 text-right">{usd(quote.legs.reduce((a, l) => a + l.usd, 0) + quote.cashUsd)}</td>
              <td className="tnum py-2 text-right">{usd(quote.feesUsd)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-[14px] text-smoke">
        Prices are Gemini asks. Each order pays Gemini&apos;s taker fee, {Math.round((quote.feeRate ?? 0.07) * 100)}% × contracts × price × (1 − price), rounded up to
        the cent; it&apos;s already taken out of your payouts.{paper ? " The desk's fills are simulated at live quotes in paper mode." : ""}
        {crossed.length ? ` Not traded because quotes are crossed: ${crossed.join(", ")}.` : ""}
      </p>
      <p className="mt-2 text-[14px] text-smoke">
        For the curious: the solver picks these to maximize expected log growth under your blended forecast (
        <span className="tnum text-slate">{quote.expectedLogGrowth.toFixed(4)}</span>), which is why no outcome ever pays zero.
      </p>
    </div>
  );
});
