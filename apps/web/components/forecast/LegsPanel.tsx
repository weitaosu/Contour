"use client";

import type { Quote } from "@contour/core";
import { cents, qty, usd } from "@/lib/format";

/** The contracts (and escrowed cash) behind a position, with where the prices come from. */
export function LegsTable({ quote, paper, crossed }: { quote: Omit<Quote, "raw">; paper: boolean; crossed: string[] }) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[14px]">
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
              <td className="py-2 font-bold">Cash</td>
              <td className="py-2 text-slate">held in escrow</td>
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
}
