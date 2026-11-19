"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Crosshair, TrendingDown, TrendingUp } from "lucide-react";
import { bucketOf, buildRamp, formatValue, marketMoments, maxRampSteps, type Ladder, type RampDirection } from "@contour/core";
import { desk } from "@/lib/desk";
import { cents, pct, qty, usd } from "@/lib/format";
import { Panel } from "@/components/forecast/Panel";
import { Slider } from "@/components/ui/Slider";
import { BackChart } from "@/components/charts/BackChart";
import { GAIN } from "@/components/charts/ProfitChart";
import { AmountField, ChoiceCards } from "./controls";

/**
 * Test page for ramp bets: a single contract at your estimate is a cliff (full payout, then $0 one
 * strike away). Contour spreads the same stake over a few neighbouring strikes, so the payout slopes
 * down to $0 instead: a lower best case, and part of the stake back on near misses. One control sets
 * how steep the slope is.
 */
export function RampScreen({ initialTicker }: { initialTicker?: string }) {
  const marketsQ = useQuery({ queryKey: ["markets"], queryFn: () => desk.markets() });
  const choices = useMemo(() => (marketsQ.data?.markets ?? []).filter((m) => m.kind === "threshold" && m.quotedCount > 2 && !m.sample), [marketsQ.data]);
  const [ticker, setTicker] = useState<string | undefined>(initialTicker);
  useEffect(() => {
    if (!ticker && choices.length) setTicker((choices.find((m) => m.category === "Crypto") ?? choices[0]).ticker);
  }, [ticker, choices]);
  const ladderQ = useQuery({ queryKey: ["ladder", ticker], queryFn: () => desk.ladder(ticker!), enabled: !!ticker, refetchInterval: 30_000 });
  const ladder = ladderQ.data?.ladder;

  return (
    <main className="page flex flex-col gap-4 pb-16 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="stat-label">Test page · smoother payouts</p>
          <h1 className="title">{ladder?.title ?? "Pick a market"}</h1>
        </div>
        <label className="flex flex-col gap-1 text-[13px] text-slate">
          Market
          <select className="input min-w-[280px]" value={ticker ?? ""} onChange={(e) => setTicker(e.target.value)}>
            {choices.map((m) => (
              <option key={m.ticker} value={m.ticker}>
                {m.category} · {m.title}
              </option>
            ))}
            {ticker && !choices.some((m) => m.ticker === ticker) && <option value={ticker}>{ticker}</option>}
          </select>
        </label>
      </div>
      {ladderQ.isError && <p className="text-slate">Couldn&apos;t load this market. Pick another one.</p>}
      {ladder && ladder.kind !== "threshold" && <p className="text-slate">Ramps need a price-style ladder (strikes on a number line). Pick a price or total market.</p>}
      {ladder && ladder.kind === "threshold" && <RampBuilder key={ladder.eventTicker} ladder={ladder} />}
    </main>
  );
}

function RampBuilder({ ladder }: { ladder: Ladder }) {
  const cuts = ladder.cuts!;
  const lo = cuts[0];
  const hi = cuts[cuts.length - 1];
  const priceStep = Math.max(0.01, Number(((hi - lo) / 200).toPrecision(1)));
  const f = (v: number) => formatValue(v, ladder.unit);
  const [price, setPrice] = useState(() => Math.round(marketMoments(ladder).mean / priceStep) * priceStep);
  const [direction, setDirection] = useState<RampDirection>("higher");
  const [stake, setStake] = useState(100);
  const maxSteps = maxRampSteps(ladder, price, direction);
  const [steps, setSteps] = useState(4);
  const s = Math.max(1, Math.min(steps, maxSteps));
  const [hover, setHover] = useState<number | null>(null);

  const ramp = useMemo(() => (maxSteps ? buildRamp({ ladder, price, direction, steps: s, stakeUsd: stake }) : null), [ladder, price, direction, s, stake, maxSteps]);
  // The single contract at your estimate: the same bet with one step (the cliff).
  const cliff = useMemo(() => (maxSteps ? buildRamp({ ladder, price, direction, steps: 1, stakeUsd: stake }) : null), [ladder, price, direction, stake, maxSteps]);

  const q = ladder.marketProb;
  const stats = (back: number[]) => ({
    best: Math.max(...back),
    profit: back.reduce((a, v, j) => a + (v > stake + 0.005 ? q[j] : 0), 0),
    some: back.reduce((a, v, j) => a + (v > stake * 0.01 ? q[j] : 0), 0),
    avg: back.reduce((a, v, j) => a + v * q[j], 0),
  });
  const R = ramp ? stats(ramp.payoutByBucket) : null;
  const C = cliff ? stats(cliff.payoutByBucket) : null;

  // The price marker, in outcome units.
  const b = bucketOf(ladder, price);
  const left = b === 0 ? cuts[0] - (cuts[1] - cuts[0]) : cuts[b - 1];
  const right = b === cuts.length ? cuts[b - 1] + (cuts[b - 1] - cuts[b - 2]) : cuts[b];
  const at = b + Math.min(0.98, Math.max(0.02, (price - left) / (right - left || 1)));

  const steepWord = s === 1 ? "a cliff: the single contract" : s <= 2 ? "steep" : s <= 4 ? "medium" : "gentle";

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel step={1} title="Your estimate">
          <Slider
            label="Price"
            value={price}
            min={lo}
            max={hi}
            step={priceStep}
            onChange={(v) => setPrice(Math.round(v / priceStep) * priceStep)}
            display={f(price)}
            valueText={`Your estimate ${f(price)}`}
            caption={`Market expects about ${f(marketMoments(ladder).mean)}`}
          />
        </Panel>

        <Panel step={2} title="What will happen?">
          <ChoiceCards
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "higher", title: "Higher", sub: `${f(price)} or above`, icon: TrendingUp },
              { value: "lower", title: "Lower", sub: `below ${f(price)}`, icon: TrendingDown },
              { value: "around", title: "Stays near", sub: `around ${f(price)}`, icon: Crosshair },
            ]}
          />
        </Panel>

        <Panel
          step={3}
          title="How steep?"
          hint="Steep wins the most if you're right and nothing if you're a little off. Gentler wins less at best, then a little less for each strike you miss by, down to $0."
        >
          {maxSteps > 0 ? (
            <Slider
              key={`steps-${maxSteps}`}
              label="Slope"
              value={s}
              min={1}
              max={Math.max(2, maxSteps)}
              step={1}
              onChange={setSteps}
              display={`${s} ${s === 1 ? "strike" : "strikes"} · ${steepWord}`}
              valueText={`${s} strikes, ${steepWord}`}
              ends={["Cliff", "Gentle"]}
            />
          ) : (
            <p className="text-[14px] text-slate">No tradable strikes on that side of your price.</p>
          )}
        </Panel>

        <Panel step={4} title="How much?">
          <AmountField label="Put in" value={stake} onChange={setStake} note="Both bets lose all of it if it ends far from your estimate." />
        </Panel>
      </div>

      <Panel tone="focus" title="What you get back">
        {ramp && cliff && R && C ? (
          <div className="flex flex-col gap-4">
            <p className="text-[19px] leading-snug text-inkstone">
              Up to <b className="text-gain">{usd(R.best)}</b> back, sloping down to $0 over {s} {s === 1 ? "strike" : "strikes"}. The single contract pays{" "}
              <b>{usd(C.best)}</b> or nothing.
            </p>
            {ramp.ramp.guaranteedUsd > 0 && (
              <p className="-mt-2 text-[13.5px] text-slate">
                Stays near uses contracts on both sides of your price, and one side always pays: {usd(ramp.ramp.guaranteedUsd)} of the {usd(stake)} comes back in every outcome.
              </p>
            )}
            <div className="rounded-[18px] bg-cloud px-3 pb-2 pt-2.5">
              <p className="tnum min-h-[20px] text-[13.5px] text-slate">
                {hover !== null ? (
                  <>
                    If it ends <b className="text-inkstone">{ladder.bucketLabels[hover].toLowerCase()}</b>: Contour <b className="text-inkstone">{usd(ramp.payoutByBucket[hover])}</b> back · single
                    contract <b className="text-inkstone">{usd(cliff.payoutByBucket[hover])}</b> · market&apos;s chance {pct(q[hover])}
                  </>
                ) : (
                  "Point at a bar to read it."
                )}
              </p>
              <BackChart
                back={ramp.payoutByBucket}
                stake={stake}
                compare={s > 1 ? cliff.payoutByBucket : null}
                compareLabel="Single contract"
                cutLabels={ladder.cutLabels}
                hover={hover}
                onHover={setHover}
                marker={{ at, label: `Estimate ${f(price)}` }}
                height={300}
              />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[12.5px] text-slate">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: GAIN }} /> Back more than you put in
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-[3px] bg-ash" /> Back less
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-0 w-4 border-t-2 border-dashed border-signal-violet" /> Break-even
                </span>
                {s > 1 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-0 w-4 border-t-2 border-inkstone" /> Single contract ({cliff.legs[0]?.side.toUpperCase()} {cliff.legs[0]?.label}), same {usd(stake, 0)}
                  </span>
                )}
              </div>
            </div>

            <table className="tnum w-full text-[14px]">
              <thead>
                <tr className="text-left text-smoke">
                  <th className="py-1 font-normal" />
                  <th className="py-1 font-bold text-signal-violet">Contour ({s} {s === 1 ? "strike" : "strikes"})</th>
                  <th className="py-1 font-normal">Single contract</th>
                </tr>
              </thead>
              <tbody className="text-graphite">
                {(
                  [
                    ["Best case back", (x: typeof R) => usd(x.best)],
                    ["Chance you profit (market)", (x: typeof R) => pct(x.profit)],
                    ["Chance you get anything back (market)", (x: typeof R) => pct(x.some)],
                    ["Average back if the market's right", (x: typeof R) => usd(x.avg)],
                  ] as const
                ).map(([label, fn]) => (
                  <tr key={label} className="border-t border-mist">
                    <td className="py-1.5 text-slate">{label}</td>
                    <td className="py-1.5 font-bold text-inkstone">{fn(R)}</td>
                    <td className="py-1.5">{fn(C)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div>
              <p className="stat-label mb-1">Contracts Contour buys</p>
              <ul className="flex flex-col gap-1 text-[14px] text-graphite">
                {ramp.legs.map((l) => (
                  <li key={l.symbol + l.side} className="tnum">
                    <b>{l.side.toUpperCase()}</b> {l.label} · {qty(l.qty)} × {cents(l.price)} = {usd(l.usd)}
                  </li>
                ))}
                <li className="text-slate">Fees {usd(ramp.feesUsd)}{ramp.cashUsd > 0.005 ? ` · ${usd(ramp.cashUsd)} left over as cash` : ""}</li>
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-slate">Pick an estimate and a direction.</p>
        )}
      </Panel>
    </div>
  );
}
