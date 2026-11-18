"use client";

import type { Quote } from "@contour/core";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { usd } from "@/lib/format";
import { isWin } from "@/lib/outcomes";
import { ComparisonCard } from "./ComparisonCard";
import { LegsTable } from "./LegsPanel";

/** Everything a curious user might want, folded away: the single-contract alternative and the actual contracts. */
export function DetailsSection({ quote, stake, compare, crossed }: { quote: Omit<Quote, "raw">; stake: number; compare: number[] | null; crossed: string[] }) {
  const n = quote.payoutByBucket.length;
  const paysSomething = quote.payoutByBucket.filter((p) => p > 0.005).length;
  const profits = quote.payoutByBucket.filter((p) => isWin(p, stake)).length;
  const singlePays = compare ? compare.filter((p) => p > 0).length : 0;

  return (
    <section className="flex flex-col gap-3">
      <p className="eyebrow px-1">Details</p>
      <Accordion type="multiple">
        <div className="flex flex-col gap-3">
          {quote.comparison && (
            <AccordionItem
              value="compare"
              title="Why not just buy one contract?"
              right={
                compare ? (
                  <span className="tnum hidden text-[14px] text-slate sm:inline">
                    pays in {singlePays} of {n} outcomes
                  </span>
                ) : undefined
              }
            >
              {compare && (
                <p className="mb-5 text-inkstone">
                  The best single contract for your view pays in <b className="tnum">{singlePays}</b> of {n} outcomes and loses all {usd(stake, 0)} in the other{" "}
                  {n - singlePays}. Your hedge pays something back in <b className="tnum text-signal-violet">{paysSomething}</b> and makes money in{" "}
                  <b className="tnum text-signal-violet">{profits}</b>.
                </p>
              )}
              <ComparisonCard quote={quote} stake={stake} bare />
            </AccordionItem>
          )}
          <AccordionItem
            value="legs"
            title={`The ${quote.legs.length} ${quote.legs.length === 1 ? "contract" : "contracts"} you'd buy`}
            right={<span className="tnum hidden text-[14px] text-slate sm:inline">+ {usd(quote.cashUsd)} cash</span>}
          >
            <LegsTable quote={quote} paper={true} crossed={crossed} />
          </AccordionItem>
        </div>
      </Accordion>
    </section>
  );
}
