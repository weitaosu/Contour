"use client";

import type { Quote } from "@contour/core";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { cents, qty, usd } from "@/lib/format";

export function LegsPanel({ quote, paper, crossed }: { quote: Omit<Quote, "raw">; paper: boolean; crossed: string[] }) {
  return (
    <section className="flex flex-col gap-3">
      <Accordion type="single" collapsible>
        <AccordionItem
          value="legs"
          title={`What gets bought: ${quote.legs.length} ${quote.legs.length === 1 ? "leg" : "legs"} + cash`}
          right={<span className="tnum text-slate">{usd(quote.cashUsd)} cash</span>}
        >
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left text-smoke">
                <th className="pb-2 font-medium">Side</th>
                <th className="pb-2 font-medium">Contract</th>
                <th className="pb-2 text-right font-medium">Price</th>
                <th className="pb-2 text-right font-medium">Qty</th>
                <th className="pb-2 text-right font-medium">Cost</th>
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
                </tr>
              ))}
              <tr className="border-t border-mist">
                <td className="py-2 font-bold">Cash</td>
                <td className="py-2 text-slate">held in escrow</td>
                <td />
                <td />
                <td className="tnum py-2 text-right">{usd(quote.cashUsd)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4 text-[14px] text-smoke">
            Prices are Gemini asks.{paper ? " The desk's fills are simulated at live quotes in paper mode." : ""}
            {crossed.length ? ` Not traded because quotes are crossed: ${crossed.join(", ")}.` : ""}
          </p>
        </AccordionItem>
      </Accordion>
      <div className="rounded-[16px] border border-mist px-6 py-5 text-[14px] text-slate">
        Expected log growth under your blended forecast:{" "}
        <span className="tnum font-bold text-inkstone">{quote.expectedLogGrowth.toFixed(4)}</span>. The solver maximizes this, which keeps every payout above zero.
      </div>
    </section>
  );
}
