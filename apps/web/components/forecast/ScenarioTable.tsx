import { memo } from "react";
import type { Ladder, Quote } from "@contour/core";
import { usd } from "@/lib/format";
import { protectionTable, scenarioTable, type ScenarioRow } from "@/lib/scenarios";

type Q = Omit<Quote, "raw">;

const signedUsd = (x: number) => `${x > 0.004 ? "+" : x < -0.004 ? "−" : ""}${usd(Math.abs(x))}`;
const chance = (p: number) => (p <= 0 ? "0%" : p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

type Side = "up" | "down" | null;
const sideOf = (r: ScenarioRow): Side => (r.diff > 0.004 ? "up" : r.diff < -0.004 ? "down" : null);

const HEAD = "text-[11.5px] uppercase leading-tight tracking-[0.075em]";

/**
 * The rows, as one grid: scenario, one contract, Contour, then (when odds are given) each row's chance
 * just before the difference it weighs. Rows where Contour does better are tinted, so the summary
 * under the table reads straight off them. A merged row's chance is the sum of the outcomes it covers.
 */
function Rows({ rows, heads, probs }: { rows: ScenarioRow[]; heads: [string, string, string]; probs?: number[] }) {
  const chanceOf = (r: ScenarioRow) => (probs ? probs.slice(r.from, r.to + 1).reduce((a, b) => a + b, 0) : 0);
  const total = (side: Side) => rows.reduce((a, r) => a + (sideOf(r) === side ? chanceOf(r) : 0), 0);
  // Column numbers: the chance column exists only with odds, between Contour and the difference.
  const c = probs ? { a: 2, b: 3, chance: 4, d: 5 } : { a: 2, b: 3, chance: 0, d: 4 };
  const template = probs ? "minmax(0,1.2fr) repeat(2,minmax(0,1fr)) minmax(0,0.6fr) minmax(0,1fr)" : "minmax(0,1.2fr) repeat(3,minmax(0,1fr))";
  const line = (i: number) => (i < rows.length - 1 ? "border-b border-mist" : "");
  const at = (row: number, col: number) => ({ gridRow: row, gridColumn: col });
  const headCell = (label: string, col: number, tone = "text-smoke") => (
    <span key={label} role="columnheader" className={`${HEAD} self-end border-b border-mist pb-1.5 text-right ${tone}`} style={at(1, col)}>
      {label}
    </span>
  );
  return (
    <div>
      {/* On a phone the table scrolls sideways in its own box, not the page. */}
      <div className={probs ? "-mx-2 overflow-x-auto px-2" : ""}>
        <div role="table" aria-label="Profit or loss by final outcome" className={`grid items-center gap-x-3 text-[14px] ${probs ? "min-w-[26rem]" : ""}`} style={{ gridTemplateColumns: template }}>
          <div role="row" className="contents">
            <span role="columnheader" className={`${HEAD} border-b border-mist pb-1.5 text-smoke`} style={at(1, 1)}>
              Scenario
            </span>
            {headCell(heads[0], c.a)}
            {headCell(heads[1], c.b, "text-signal-violet")}
            {probs && headCell("Chance", c.chance)}
            {headCell(heads[2], c.d)}
          </div>
          {rows.map((r, i) => {
            const better = sideOf(r) === "up";
            return (
              <div key={r.from} role="row" className="contents">
                {/* a soft band behind the whole row where Contour comes out ahead */}
                {better && <span aria-hidden="true" className="-mx-2 self-stretch rounded-[8px] bg-gain/[0.09]" style={{ gridRow: i + 2, gridColumn: "1 / -1" }} />}
                <span role="cell" className={`min-w-0 py-2 text-inkstone ${line(i)}`} style={at(i + 2, 1)}>
                  {r.label}
                </span>
                <span role="cell" className={`tnum py-2 text-right text-slate ${line(i)}`} style={at(i + 2, c.a)}>
                  {signedUsd(r.a)}
                </span>
                <span role="cell" className={`tnum py-2 text-right font-bold text-inkstone ${line(i)}`} style={at(i + 2, c.b)}>
                  {signedUsd(r.b)}
                </span>
                {probs && (
                  <span role="cell" className={`tnum py-2 text-right text-slate ${line(i)}`} style={at(i + 2, c.chance)}>
                    {chance(chanceOf(r))}
                  </span>
                )}
                <span role="cell" className={`tnum py-2 text-right font-bold ${better ? "text-gain" : "text-inkstone"} ${line(i)}`} style={at(i + 2, c.d)}>
                  {signedUsd(r.diff)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {probs && (
        <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-slate">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px] bg-gain/25" aria-hidden="true" />
            Contour does better: <b className="tnum text-inkstone">{chance(total("up"))}</b>
          </span>
          <span>
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
}: {
  ladder: Ladder;
  quote: Q;
  stake: number;
  /** Chance of each outcome, for the Chance column (omitted: no column). */
  probs?: number[];
}) {
  const t = scenarioTable(ladder, quote, stake);
  if (!t) return <p className="text-[13.5px] text-slate">Once you have a trade, this shows what it and the single best contract would make or lose in every outcome.</p>;
  return <Rows rows={t.rows} heads={["One contract", "Contour", "Difference"]} probs={probs} />;
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
