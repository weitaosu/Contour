"use client";

import { memo } from "react";
import type { Quote } from "@contour/core";
import { cents, notableUnused, qty, usd } from "@/lib/format";

/** The contracts behind a position (and the part of the amount it doesn't need), with where the prices come from. */
export const LegsTable = memo(function LegsTable({ quote, paper, crossed, compact = false }: { quote: Omit<Quote, "raw">; paper: boolean; crossed: string[]; compact?: boolean }) {
  if (compact) {
    const total = quote.legs.reduce((a, l) => a + l.usd, 0) + quote.feesUsd;
    return (
      <div>
        <table className="w-full text-[13px] leading-[19px]" title={crossed.length ? `Crossed quotes skipped: ${crossed.join(", ")}` : undefined}>
          <thead>
            <tr className="text-left text-[12.5px] text-smoke">
              <th className="pb-1 font-medium">Contract</th>
              <th className="pb-1 text-right font-medium">Qty × price</th>
              <th className="pb-1 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="text-inkstone">
            {quote.legs.map((l) => (
              <tr key={`${l.symbol}-${l.side}`} className="border-t border-mist">
                <td className="py-[2px]">
                  <span className="mr-1.5 rounded-full bg-mist px-1.5 py-px text-[11px] font-bold">{l.side.toUpperCase()}</span>
                  {l.label}
                </td>
                <td className="tnum py-[2px] text-right text-slate">
                  {qty(l.qty)} × {cents(l.price)}
                </td>
                <td className="tnum py-[2px] text-right">{usd(l.usd)}</td>
              </tr>
            ))}
            <tr className="border-t border-mist">
              <td className="py-[2px]" colSpan={2}>
                <b>You pay</b>{" "}
                <span className="text-slate">
                  incl. {usd(quote.feesUsd)} fees{notableUnused(quote.cashUsd) ? <> · {usd(quote.cashUsd)} not needed</> : null}
                </span>
              </td>
              <td className="tnum py-[2px] text-right font-bold">{usd(total)}</td>
            </tr>
          </tbody>
        </table>

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
