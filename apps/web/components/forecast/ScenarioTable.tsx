import { memo } from "react";
import type { Ladder, Quote } from "@contour/core";
import { cents, usd } from "@/lib/format";
import { protectionTable, scenarioTable, type ScenarioRow } from "@/lib/scenarios";

type Q = Omit<Quote, "raw">;

const signedUsd = (x: number) => `${x > 0.004 ? "+" : x < -0.004 ? "−" : ""}${usd(Math.abs(x))}`;
const chance = (p: number) => (p <= 0 ? "0%" : p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

type Side = "up" | "down" | null;
const sideOf = (r: ScenarioRow): Side => (r.diff > 0.004 ? "up" : r.diff < -0.004 ? "down" : null);

/** Consecutive rows where the difference has the same sign: each gets one bar beside the chances. */
function groups(rows: ScenarioRow[]) {
  const out: { side: "up" | "down"; first: number; last: number }[] = [];
  rows.forEach((r, i) => {
    const side = sideOf(r);
    if (!side) return;
    const g = out[out.length - 1];
    if (g && g.side === side && g.last === i - 1) g.last = i;
    else out.push({ side, first: i, last: i });
  });
  return out;
}

const HEAD = "text-[11.5px] uppercase leading-tight tracking-[0.075em]";

/**
 * The rows, as one grid: scenario, then (when odds are given) a bar enveloping each run of rows where
 * Contour does better or worse, labelled with that run's total chance, and each row's own chance;
 * then the two positions and the difference. A merged row's chance is the sum of the outcomes it covers.
 */
function Rows({ rows, heads, probs }: { rows: ScenarioRow[]; heads: [string, string, string]; probs?: number[] }) {
  const chanceOf = (r: ScenarioRow) => (probs ? probs.slice(r.from, r.to + 1).reduce((a, b) => a + b, 0) : 0);
  const runs = probs ? groups(rows) : [];
  const total = (side: Side) => rows.reduce((a, r) => a + (sideOf(r) === side ? chanceOf(r) : 0), 0);
  // Column numbers: the bar and chance columns exist only with odds.
  const c = probs ? { bar: 2, chance: 3, a: 4, b: 5, d: 6 } : { bar: 0, chance: 0, a: 2, b: 3, d: 4 };
  const template = probs ? "minmax(0,1.15fr) 4.5rem minmax(0,0.5fr) repeat(3,minmax(0,1fr))" : "minmax(0,1.2fr) repeat(3,minmax(0,1fr))";
  const line = (i: number) => (i < rows.length - 1 ? "border-b border-mist" : "");
  const at = (row: number, col: number) => ({ gridRow: row, gridColumn: col });
  return (
    <div>
      {/* With odds it's six columns: on a phone the table scrolls sideways in its own box, not the page. */}
      <div className={probs ? "-mx-1 overflow-x-auto px-1" : ""}>
      <div role="table" aria-label="Profit or loss by final outcome" className={`grid items-center gap-x-3 text-[13.5px] ${probs ? "min-w-[32rem]" : ""}`} style={{ gridTemplateColumns: template }}>
        <div role="row" className="contents">
          <span role="columnheader" className={`${HEAD} border-b border-mist pb-1.5 text-smoke`} style={at(1, 1)}>
            Scenario
          </span>
          {probs && (
            <>
              <span role="columnheader" className={`${HEAD} border-b border-mist pb-1.5 text-center text-smoke`} style={at(1, c.bar)}>
                Combined
              </span>
              <span role="columnheader" className={`${HEAD} border-b border-mist pb-1.5 text-right text-smoke`} style={at(1, c.chance)}>
                Chance
              </span>
            </>
          )}
          {heads.map((h, i) => (
            <span key={h} role="columnheader" className={`${HEAD} self-end border-b border-mist pb-1.5 text-right ${i === 1 ? "text-signal-violet" : "text-smoke"}`} style={at(1, [c.a, c.b, c.d][i])}>
              {h}
            </span>
          ))}
        </div>
        {rows.map((r, i) => (
          <div key={r.from} role="row" className="contents">
            <span role="cell" className={`min-w-0 py-1.5 text-inkstone ${line(i)}`} style={at(i + 2, 1)}>
              {r.label}
            </span>
            {/* rows outside any run keep the line going under the bar column */}
            {probs && !sideOf(r) && <span aria-hidden="true" className={`self-stretch ${line(i)}`} style={at(i + 2, c.bar)} />}
            {probs && (
              <span role="cell" className={`tnum py-1.5 text-right text-slate ${line(i)}`} style={at(i + 2, c.chance)}>
                {chance(chanceOf(r))}
              </span>
            )}
            <span role="cell" className={`tnum py-1.5 text-right text-slate ${line(i)}`} style={at(i + 2, c.a)}>
              {signedUsd(r.a)}
            </span>
            <span role="cell" className={`tnum py-1.5 text-right font-bold text-inkstone ${line(i)}`} style={at(i + 2, c.b)}>
              {signedUsd(r.b)}
            </span>
            <span role="cell" className={`tnum py-1.5 text-right font-bold ${r.diff > 0.004 ? "text-gain" : "text-inkstone"} ${line(i)}`} style={at(i + 2, c.d)}>
              {signedUsd(r.diff)}
            </span>
          </div>
        ))}
        {/* One bar per run of same-sign rows, spanning them, with the run's total chance. */}
        {runs.map((g) => {
          const p = rows.slice(g.first, g.last + 1).reduce((a, r) => a + chanceOf(r), 0);
          const up = g.side === "up";
          return (
            <span
              key={`${g.side}-${g.first}`}
              aria-hidden="true"
              title={`${up ? "Contour does better" : "One contract does better"} in these outcomes: ${chance(p)} chance together`}
              className={`tnum my-[3px] flex items-center justify-center self-stretch rounded-[10px] text-[13px] font-bold ${
                up ? "bg-gain/15 text-gain ring-1 ring-gain/30" : "bg-mist text-slate ring-1 ring-ash/40"
              }`}
              style={{ gridRow: `${g.first + 2} / ${g.last + 3}`, gridColumn: c.bar }}
            >
              {chance(p)}
            </span>
          );
        })}
      </div>
      </div>
      {probs && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-slate">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-gain/40 ring-1 ring-gain/50" aria-hidden="true" />
            Contour does better: <b className="tnum text-inkstone">{chance(total("up"))}</b>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-mist ring-1 ring-ash/60" aria-hidden="true" />
            One contract does better: <b className="tnum text-inkstone">{chance(total("down"))}</b>
          </span>
          {total(null) > 0.0005 && (
            <span>
              Same: <b className="tnum text-inkstone">{chance(total(null))}</b>
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * What each position would make or lose at settlement, for every final outcome: one contract vs
 * Contour (see lib/scenarios). Conditional dollar results, not how likely each one is.
 */
export const ScenarioTable = memo(function ScenarioTable({
  ladder,
  quote,
  stake,
  probs,
  oddsBasis,
}: {
  ladder: Ladder;
  quote: Q;
  stake: number;
  /** Chance of each outcome, for the Chance column (omitted: no column). */
  probs?: number[];
  /** Whose odds those are, for the footnote: "your forecast" or "the market's prices". */
  oddsBasis?: string;
}) {
  const t = scenarioTable(ladder, quote, stake);
  if (!t) return <p className="text-[13.5px] text-slate">Once you have a trade, this shows what it and the single best contract would make or lose in every outcome.</p>;
  const b = t.benchmark;
  return (
    <div>
      <p className="text-[13.5px] leading-snug text-inkstone">
        One contract:{" "}
        <b>
          {b.side.toUpperCase()} &ldquo;{b.label}&rdquo;
        </b>{" "}
        at {cents(b.price)}, {b.qty.toLocaleString("en-US", { maximumFractionDigits: 2 })} contracts for <b className="tnum">{usd(b.cost)}</b> with fees, about the{" "}
        {usd(t.spend)} Contour spends.
      </p>
      <div className="mt-2">
        <Rows rows={t.rows} heads={["One contract", "Contour", "Difference"]} probs={probs} />
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-smoke">
        {probs
          ? `Dollar results if it settles there. Chance is by ${oddsBasis ?? "the market's prices"}. `
          : "Dollar results if it settles there, not how likely each one is. "}
        Difference is Contour minus one contract: positive means Contour does better.
      </p>
    </div>
  );
});

/** Protection mode: the holding alone vs the holding plus the strategy, at each range's midpoint. */
export const ProtectionScenarioTable = memo(function ProtectionScenarioTable({
  ladder,
  quote,
  cost,
  holdingChange,
  units,
  name,
  strategyName,
}: {
  ladder: Ladder;
  quote: Q;
  cost: number;
  holdingChange: number[];
  units: number;
  name: string;
  strategyName: string;
}) {
  const rows = protectionTable(ladder, quote, cost, holdingChange);
  return (
    <div>
      <p className="text-[13.5px] leading-snug text-inkstone">
        Your {units.toLocaleString("en-US", { maximumFractionDigits: 4 })} {name} valued at each range&apos;s midpoint against today&apos;s expected price, alone and with the{" "}
        {strategyName.toLowerCase()} (its payout less its <b className="tnum">{usd(cost)}</b> cost).
      </p>
      <div className="mt-2">
        <Rows rows={rows} heads={["Holding alone", `With ${strategyName.toLowerCase()}`, "Difference"]} />
      </div>
      <p className="mt-2 text-[12.5px] leading-snug text-smoke">Dollar results if it settles there, not how likely each one is. Difference is what the {strategyName.toLowerCase()} adds.</p>
    </div>
  );
});
