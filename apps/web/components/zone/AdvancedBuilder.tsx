"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { assemble, bucketMidpoints, compile, formatValue, fromRatings, groupByMass, likelyRange, paysIn, type Ladder, type OutcomeGroup } from "@contour/core";
import { desk } from "@/lib/desk";
import { cents, pct, qty, usd } from "@/lib/format";
import { Panel } from "@/components/forecast/Panel";
import { GAIN, ProfitChart } from "@/components/charts/ProfitChart";
import { AmountField, PillChoice } from "./controls";

/**
 * Advanced: rate the market's outcomes instead of drawing a curve. Each range starts at "about
 * right"; Contour only bets where you disagree. The result is drawn as a payoff diagram against the
 * single best contract for the same view (and, on price markets, against just holding the coin).
 */

const LEVELS = [
  { v: -2, label: "Much less" },
  { v: -1, label: "Less" },
  { v: 0, label: "About right" },
  { v: 1, label: "More" },
  { v: 2, label: "Much more" },
] as const;

function groupLabel(ladder: Ladder, g: OutcomeGroup) {
  const cuts = ladder.cuts!;
  const f = (v: number) => formatValue(v, ladder.unit);
  if (g.lo === 0) return `Below ${f(cuts[g.hi])}`;
  if (g.hi === ladder.marketProb.length - 1) return `${f(cuts[g.lo - 1])} or above`;
  return `${f(cuts[g.lo - 1])} to ${f(cuts[g.hi])}`;
}

export function AdvancedBuilder({ ladder }: { ladder: Ladder }) {
  const groups = useMemo(() => groupByMass(ladder, 5), [ladder]);
  const [ratings, setRatings] = useState<number[]>(() => groups.map(() => 0));
  const [risk, setRisk] = useState(50);
  const deferred = useDeferredValue(ratings);
  const agrees = deferred.every((r) => r === 0);
  const belief = useMemo(() => fromRatings(ladder, groups, deferred), [ladder, groups, deferred]);
  // The solver picks the shape (which contracts, in what proportion) from your ratings; you pick the
  // size. Its own Kelly sizing bets very little on a modest edge, so the contracts it chooses are
  // scaled until the most you can lose equals the amount you set. Cash only shifts every outcome
  // equally, so it is dropped: what you put in is what the contracts cost.
  const shape = useMemo(() => (agrees ? null : compile({ ladder, belief, confidence: 1, stakeUsd: 1000 })), [ladder, belief, agrees]);
  const quote = useMemo(() => {
    if (!shape || !shape.legs.length) return null;
    const specs = shape.legs.map((l) => ({ i: l.instrumentIndex, side: l.side, qty: l.qty }));
    const unit = assemble(ladder, specs, null, shape.feeRate);
    const unitRisk = unit.stakeBase / 1e6 - unit.minPayout;
    if (!(unitRisk > 0)) return null;
    const k = risk / unitRisk;
    return assemble(ladder, specs.map((x) => ({ ...x, qty: Math.floor(x.qty * k * 100) / 100 })), null, shape.feeRate);
  }, [shape, ladder, risk]);
  const deposit = quote ? quote.stakeBase / 1e6 : 0;

  // "Just hold the coin" line, on price ladders where the desk knows the spot price.
  const liveQ = useQuery({ queryKey: ["live", ladder.eventTicker], queryFn: () => desk.live(ladder.eventTicker), enabled: ladder.kind === "threshold", staleTime: 30_000 });
  const spot = liveQ.data?.spot?.price ?? null;
  const coin = /^(.+?)\s+price\b/i.exec(ladder.title)?.[1] ?? null;

  const n = ladder.marketProb.length;
  const contour = quote ? quote.payoutByBucket.map((p) => p - deposit) : null;
  const atRisk = contour ? -Math.min(...contour) : 0;
  const cmp = shape?.comparison ?? null;
  const cmpIndex = cmp ? ladder.instruments.findIndex((i) => i.symbol === cmp.symbol) : -1;
  // The alternatives are scaled to the same most-you-can-lose, so all three risk the same money.
  const cmpCost = cmp ? cmp.qty * cmp.price + cmp.fee : 0;
  const single =
    cmp && cmpIndex >= 0 && cmpCost > 0 && contour
      ? Array.from({ length: n }, (_, j) => ((paysIn(ladder, cmpIndex, cmp.side, j) ? cmp.qty : 0) - cmpCost) * (atRisk / cmpCost))
      : null;
  const mids = ladder.cuts ? bucketMidpoints(ladder) : null;
  const rawHold = spot && mids && ladder.kind === "threshold" ? mids.map((m) => m / spot - 1) : null;
  const holdWorst = rawHold ? -Math.min(...rawHold) : 0;
  const hold = rawHold && holdWorst > 0 && contour ? rawHold.map((r) => r * (atRisk / holdWorst)) : null;
  const holdUsd = holdWorst > 0 ? atRisk / holdWorst : 0;

  const odds = (profit: number[] | null, probs: readonly number[]) => (profit ? profit.reduce((a, v, j) => a + (v > 0.005 ? probs[j] : 0), 0) : 0);
  const ev = (profit: number[] | null, probs: readonly number[]) => (profit ? profit.reduce((a, v, j) => a + v * probs[j], 0) : 0);
  const best = contour ? contour.indexOf(Math.max(...contour)) : -1;
  const worst = contour ? contour.indexOf(Math.min(...contour)) : -1;

  const [hover, setHover] = useState<number | null>(null);
  const likely = useMemo(() => {
    const [from, to] = likelyRange(ladder.marketProb, 0.8);
    return { from, to };
  }, [ladder]);

  const setRating = (k: number, v: number) => setRatings((r) => r.map((x, i) => (i === k ? v : x)));

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel step={1} title="Where does the market get it wrong?" hint="Each range starts at the market's chance. Only change the ones you disagree with.">
          <div className="flex flex-col gap-3">
            {groups.map((g, k) => (
              <div key={g.lo} className="flex flex-col gap-1.5 rounded-[14px] bg-porcelain p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[14px] font-bold text-inkstone">{groupLabel(ladder, g)}</span>
                  <span className="tnum text-[13px] text-slate">
                    market {pct(g.marketProb)}
                    {ratings[k] !== 0 && (
                      <>
                        {" "}→ you <b className={ratings[k] > 0 ? "text-gain" : "text-inkstone"}>{pct(belief.slice(g.lo, g.hi + 1).reduce((a, b) => a + b, 0))}</b>
                      </>
                    )}
                  </span>
                </div>
                <PillChoice
                  small
                  label={`How likely is ${groupLabel(ladder, g)}?`}
                  options={LEVELS.map((l) => ({ value: l.v, label: l.label }))}
                  value={ratings[k]}
                  onChange={(v) => setRating(k, v)}
                />
              </div>
            ))}
            {!agrees && (
              <button type="button" className="btn-quiet btn self-start !py-1.5 text-[13px]" onClick={() => setRatings(groups.map(() => 0))}>
                Reset to the market
              </button>
            )}
          </div>
        </Panel>

        <Panel step={2} title="How much can you lose?" hint="Contour picks which contracts to buy from your ratings. You pick the size: the most you can lose, in the worst outcome.">
          <AmountField label="Most you can lose" value={risk} onChange={setRisk} note="Every line on the chart is sized to lose at most this." />
        </Panel>
      </div>

      <Panel tone="focus" title="What you make, vs the alternatives">
        {agrees || !quote || !contour ? (
          <p className="text-[16px] text-slate">You agree with the market everywhere, so there's nothing to bet on. Mark a range as more or less likely than the market thinks.</p>
        ) : quote.legs.length === 0 ? (
          <p className="text-[16px] text-slate">Your view is too close to the market's to beat the spreads and fees. Try a stronger rating.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-[14px] text-slate">
              You put in <b className="text-inkstone">{usd(deposit)}</b>{quote.minPayout > 0.005 && <> ({usd(quote.minPayout)} always comes back)</>} · most you can lose <b className="text-inkstone">{usd(atRisk)}</b> · fees {usd(quote.feesUsd)}
            </p>
            <p className="text-[19px] leading-snug text-inkstone">
              You make the most, <b className="text-gain">{usd(contour[best])}</b>, if it ends <b>{ladder.bucketLabels[best].toLowerCase()}</b>. You lose the most,{" "}
              <b>{usd(-contour[worst])}</b>, if it ends <b>{ladder.bucketLabels[worst].toLowerCase()}</b>.
            </p>
            <ProfitChart
              pl={contour}
              wins={contour.map((v) => v > 0.005)}
              stake={deposit}
              hover={hover}
              onHover={setHover}
              cutLabels={ladder.cutLabels}
              bucketLabels={ladder.bucketLabels}
              likely={likely}
              likelyBracket={false}
              cuts={ladder.cuts}
              now={spot ? { value: spot, label: formatValue(spot, ladder.unit) } : null}
              compare={[
                ...(single ? [{ pl: single, label: "Single best contract" }] : []),
                ...(hold ? [{ pl: hold, label: `Holding ${coin ?? "it"}`, dashed: true }] : []),
              ]}
              height={300}
            />
            {hover !== null && (
              <p className="tnum text-[13.5px] text-graphite">
                If it ends {ladder.bucketLabels[hover].toLowerCase()}: Contour <b>{usd(contour[hover])}</b>
                {single && <> · single contract <b>{usd(single[hover])}</b></>}
                {hold && <> · holding <b>{usd(hold[hover])}</b></>} · market {pct(ladder.marketProb[hover])}, you {pct(belief[hover])}
              </p>
            )}
            <div className="flex flex-wrap gap-4 text-[12.5px] text-slate">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: GAIN }} />Contour makes money</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-ash" />Contour loses</span>
              {single && cmp && (
                <span>
                  <span className="mr-1 inline-block h-0 w-4 border-t-2 border-inkstone align-middle" />
                  Single best contract: {cmp.side.toUpperCase()} {cmp.label} at {cents(cmp.price)}
                </span>
              )}
              {hold && <span><span className="mr-1 inline-block h-0 w-4 border-t-2 border-dashed border-ash align-middle" />Holding {usd(holdUsd, 0)} of {coin ?? "it"}</span>}
              <span>All three lose at most {usd(atRisk)}</span>
            </div>

            <table className="tnum w-full text-[14px]">
              <thead>
                <tr className="text-left text-smoke">
                  <th className="py-1 font-normal" />
                  <th className="py-1 font-bold text-signal-violet">Contour</th>
                  {single && <th className="py-1 font-normal">Single contract</th>}
                  {hold && <th className="py-1 font-normal">Holding {coin}</th>}
                </tr>
              </thead>
              <tbody className="text-graphite">
                {[
                  ["Chance of profit, your view", (x: number[]) => pct(odds(x, belief))],
                  ["Chance of profit, market's view", (x: number[]) => pct(odds(x, ladder.marketProb))],
                  ["Best case", (x: number[]) => usd(Math.max(...x))],
                  ["Worst case", (x: number[]) => usd(Math.min(...x))],
                  ["Expected, your view", (x: number[]) => usd(ev(x, belief))],
                ].map(([label, fn]) => (
                  <tr key={label as string} className="border-t border-mist">
                    <td className="py-1.5 text-slate">{label as string}</td>
                    <td className="py-1.5 font-bold text-inkstone">{(fn as (x: number[]) => string)(contour)}</td>
                    {single && <td className="py-1.5">{(fn as (x: number[]) => string)(single)}</td>}
                    {hold && <td className="py-1.5">{(fn as (x: number[]) => string)(hold)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>

            <div>
              <p className="stat-label mb-1">Contracts Contour buys</p>
              <ul className="flex flex-col gap-1 text-[14px] text-graphite">
                {quote.legs.map((l) => (
                  <li key={l.symbol + l.side} className="tnum">
                    <b>{l.side.toUpperCase()}</b> {l.label} · {qty(l.qty)} × {cents(l.price)} = {usd(l.usd)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
