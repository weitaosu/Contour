"use client";

import { pct } from "@/lib/format";

/**
 * What the screen says before there's a position to show: an invitation before any view is
 * picked, or why a view is too weak to trade (with the confidence that would fix it).
 * Once there is a trade, ProfitCard takes over.
 */
export function OutcomeSummary({ ordered, started, raiseTo, onRaise }: { ordered: boolean; started: boolean; raiseTo: number | null; onRaise: () => void }) {
  if (!started) {
    return (
      <section className="rounded-[28px] border border-dashed border-ash px-6 py-5 text-slate">
        {ordered ? "Pick an outlook" : "Give the outcomes your own odds"} and you&apos;ll see, in plain numbers, when you make money, the most you could win, and the
        least you&apos;d get back.
      </section>
    );
  }
  return (
    <section className="fade-up rounded-[28px] border border-mist bg-porcelain px-6 py-5" aria-live="polite">
      <p className="text-[20px] font-bold leading-snug text-inkstone">Your view is too close to the market&apos;s to be worth trading.</p>
      {raiseTo !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-slate">It becomes a trade if you trust your view {pct(raiseTo)}.</p>
          <button type="button" className="btn btn-ghost !px-5 !py-2 text-[15px]" onClick={onRaise}>
            Use {pct(raiseTo)} confidence
          </button>
        </div>
      ) : (
        <p className="mt-1 text-slate">{ordered ? "Try a stronger outlook, or a different one." : "Move your odds further from the market's."}</p>
      )}
    </section>
  );
}
