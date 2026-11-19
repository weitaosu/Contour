"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildZone, capOptions, formatValue, likelyRange, marketMoments, zoneOptions, type Ladder, type ZoneDirection, type ZoneOption } from "@contour/core";
import { desk } from "@/lib/desk";
import { cents, pct, qty, usd } from "@/lib/format";
import { Panel } from "@/components/forecast/Panel";
import { GAIN, ProfitChart } from "@/components/charts/ProfitChart";
import { AdvancedBuilder } from "./AdvancedBuilder";
import { AmountField, ChoiceCards, PillChoice } from "./controls";
import { Slider } from "@/components/ui/Slider";
import { Crosshair, TrendingDown, TrendingUp } from "lucide-react";

/**
 * Test page for the simple "win zone" flow: pick a price, say higher / lower / around, then slide
 * between a bigger payout and a safer bet. Every stop on the slider is a real set of Gemini strikes.
 */


function zoneText(ladder: Ladder, o: ZoneOption) {
  const f = (v: number) => formatValue(v, ladder.unit);
  if (o.from !== null && o.to !== null) return `between ${f(o.from)} and ${f(o.to)}`;
  if (o.from !== null) return `at ${f(o.from)} or above`;
  if (o.to !== null) return `below ${f(o.to)}`;
  return "anywhere";
}

export function ZoneScreen({ initialTicker }: { initialTicker?: string }) {
  const marketsQ = useQuery({ queryKey: ["markets"], queryFn: () => desk.markets() });
  const choices = useMemo(
    () => (marketsQ.data?.markets ?? []).filter((m) => m.kind !== "categorical" && m.quotedCount > 1 && !m.sample),
    [marketsQ.data],
  );
  const [ticker, setTicker] = useState<string | undefined>(initialTicker);
  useEffect(() => {
    if (!ticker && choices.length) setTicker((choices.find((m) => m.category === "Crypto") ?? choices[0]).ticker);
  }, [ticker, choices]);

  const ladderQ = useQuery({ queryKey: ["ladder", ticker], queryFn: () => desk.ladder(ticker!), enabled: !!ticker, refetchInterval: 30_000 });
  const ladder = ladderQ.data?.ladder;
  const [mode, setMode] = useState<"simple" | "advanced">("simple");

  return (
    <main className="page flex flex-col gap-4 pb-16 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="stat-label">Test page · {mode === "simple" ? "win zones" : "rate the outcomes"}</p>
          <h1 className="title">{ladder?.title ?? "Pick a market"}</h1>
        </div>
        <label className="flex flex-col gap-1 text-[13px] text-slate">
          Market
          <select
            className="input min-w-[280px]"
            value={ticker ?? ""}
            onChange={(e) => setTicker(e.target.value)}
          >
            {choices.map((m) => (
              <option key={m.ticker} value={m.ticker}>
                {m.category} · {m.title}
              </option>
            ))}
            {ticker && !choices.some((m) => m.ticker === ticker) && <option value={ticker}>{ticker}</option>}
          </select>
        </label>
      </div>
      <div className="max-w-[460px]">
        <PillChoice
          label="Mode"
          options={[
            { value: "simple", label: "Simple: one win zone" },
            { value: "advanced", label: "Advanced: rate outcomes" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      {ladderQ.isError && <p className="text-slate">Couldn't load this market. Pick another one.</p>}
      {ladder && ladder.kind === "categorical" && <p className="text-slate">This market has named outcomes, not a number line. Pick a price or range market.</p>}
      {ladder && ladder.cuts && ladder.kind !== "categorical" && (mode === "simple" ? <ZoneBuilder key={ladder.eventTicker} ladder={ladder} /> : <AdvancedBuilder key={ladder.eventTicker} ladder={ladder} />)}
    </main>
  );
}

function ZoneBuilder({ ladder }: { ladder: Ladder }) {
  const cuts = ladder.cuts!;
  const lo = cuts[0];
  const hi = cuts[cuts.length - 1];
  const priceStep = Math.max(0.01, Number(((hi - lo) / 200).toPrecision(1)));
  const [price, setPrice] = useState(() => Math.round(marketMoments(ladder).mean / priceStep) * priceStep);
  const [direction, setDirection] = useState<ZoneDirection>("higher");
  const [risk, setRisk] = useState(50);
  const [yourChance, setYourChance] = useState<string>("");

  const { options, start } = useMemo(() => zoneOptions(ladder, price, direction), [ladder, price, direction]);
  const [pick, setPick] = useState(start);
  // A new price or direction starts the slider back on the zone that matches it.
  useEffect(() => setPick(start), [start, direction, price]);
  const base = options[Math.min(pick, options.length - 1)];
  // Optional cap at the other end: also buy the opposite contract there (higher/lower only).
  const caps = useMemo(
    () => (base && direction !== "around" ? capOptions(ladder, base, price, direction) : []),
    [ladder, base, price, direction],
  );
  const [capOn, setCapOn] = useState(false);
  const [capPick, setCapPick] = useState(0);
  useEffect(() => setCapPick(0), [base, direction]);
  const capped = capOn && caps.length ? caps[Math.min(capPick, caps.length - 1)] : null;
  const option = capped ?? base;
  const quote = useMemo(() => (option ? buildZone({ ladder, option, riskUsd: risk }) : null), [ladder, option, risk]);
  // The original: the plain Gemini contract right at your price ("that or higher" for around), risking the same.
  const original = useMemo(() => {
    const o = zoneOptions(ladder, price, direction === "lower" ? "lower" : "higher").options[0];
    if (!o || (option && o.lo === option.lo && o.hi === option.hi)) return null;
    const q = buildZone({ ladder, option: o, riskUsd: risk });
    return { option: o, pl: q.payoutByBucket.map((x) => x - q.zone.depositUsd) };
  }, [ladder, price, direction, option, risk]);
  const [hover, setHover] = useState<number | null>(null);
  const likely = useMemo(() => {
    const [from, to] = likelyRange(ladder.marketProb, 0.8);
    return { from, to };
  }, [ladder]);

  const f = (v: number) => formatValue(v, ladder.unit);
  const p = yourChance.trim() === "" ? null : Math.min(100, Math.max(0, Number(yourChance))) / 100;
  const z = quote?.zone;
  const ev = p !== null && z ? p * z.winUsd - (1 - p) * z.riskUsd : null;
  // How far past your price the zone still wins (higher: room below it; lower: room above it).
  const room =
    option && direction === "higher" && option.from !== null
      ? option.from < price
        ? `That's your price, ${f(price)}, plus ${f(price - option.from)} of room below it.`
        : `That's your price, ${f(price)}, and above.`
      : option && direction === "lower" && option.to !== null
        ? option.to > price
          ? `That's under your price, ${f(price)}, plus ${f(option.to - price)} of room above it.`
          : null
        : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <Panel step={1} title="Pick a price">
          <Slider
            label="Your price"
            value={price}
            min={lo}
            max={hi}
            step={priceStep}
            onChange={(v) => setPrice(Math.round(v / priceStep) * priceStep)}
            display={f(price)}
            valueText={`Your price ${f(price)}`}
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
          title="Safer or bigger payout?"
          hint={
            direction === "around"
              ? "Each stop is a real set of Gemini strikes. Wider wins more often and pays less."
              : `You always win if it ends ${direction === "higher" ? "at your price or above" : "below your price"}. Slide to also win if it falls a little ${direction === "higher" ? "short" : "over"}: wins more often, pays less.`
          }
        >
          {options.length && base ? (
            <div className="flex flex-col gap-1">
              <Slider
                key={`zone-${direction}-${options.length}`}
                label="Zone"
                value={Math.min(pick, options.length - 1)}
                min={0}
                max={Math.max(1, options.length - 1)}
                step={1}
                onChange={setPick}
                display={`${pct(base.winRate)} win · ${base.rewardToRisk.toFixed(2)} : 1`}
                valueText={`${pct(base.winRate)} chance to win, ${base.rewardToRisk.toFixed(2)} to 1`}
                ends={direction === "around" ? ["Bigger payout", "Safer"] : ["Right at your price", `More room ${direction === "higher" ? "below" : "above"}`]}
              />
              <p className="text-[12.5px] text-slate">{options.length} stops on this ladder</p>
            </div>
          ) : (
            <p className="text-[14px] text-slate">No zone here pays more than it costs at today's prices.</p>
          )}
        </Panel>

        {direction !== "around" && ladder.kind === "threshold" && (
          <Panel
            title="Cap the other end (optional)"
            hint={`Also buy the opposite contract ${direction === "higher" ? "above" : "below"} your zone. You lose if it goes too far ${direction === "higher" ? "up" : "down"}, but that contract pays back in every other outcome, so you win more when you're right.`}
          >
            <div className="flex flex-col gap-3">
              <PillChoice
                label="Cap the other end"
                options={[
                  { value: "off", label: "No cap" },
                  { value: "on", label: "Cap it", disabled: !caps.length },
                ]}
                value={capOn && caps.length ? "on" : "off"}
                onChange={(v) => setCapOn(v === "on")}
              />
              {!caps.length && <p className="text-[12.5px] text-slate">No cap on this ladder pays more than the uncapped bet after spreads and fees.</p>}
              {capOn && capped && (
                <>
                  <Slider
                    key={`cap-${caps.length}`}
                    label="Cap"
                    value={Math.min(capPick, caps.length - 1)}
                    min={0}
                    max={Math.max(1, caps.length - 1)}
                    step={1}
                    onChange={setCapPick}
                    display={`${pct(capped.winRate)} win · ${capped.rewardToRisk.toFixed(2)} : 1`}
                    valueText={`${pct(capped.winRate)} chance to win, ${capped.rewardToRisk.toFixed(2)} to 1`}
                    ends={["Far: wins more often", "Close: pays more"]}
                  />
                  <p className="text-[13px] text-slate">
                    {direction === "higher" ? `You lose if it ends at ${f(capped.to!)} or above.` : `You lose if it ends below ${f(capped.from!)}.`} Uncapped: {pct(base.winRate)} win ·{" "}
                    {base.rewardToRisk.toFixed(2)} : 1.
                  </p>
                </>
              )}
            </div>
          </Panel>
        )}

        <Panel step={4} title="How much can you lose?">
          <AmountField label="Most you can lose" value={risk} onChange={setRisk} note="If you're wrong, this is all you lose. Up to $500 per position on devnet." />
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel tone="focus" title="Your bet">
          {quote && z && option ? (
            <div className="flex flex-col gap-4">
              <p className="text-[20px] leading-snug text-inkstone">
                Win <b className="text-gain">{usd(z.winUsd)}</b> if it ends <b>{zoneText(ladder, option)}</b>. Lose <b>{usd(z.riskUsd)}</b> otherwise.
                {room && <span className="block text-[15px] text-slate">{room}</span>}
              </p>
              <div>
                {(() => {
                  const pl = quote.payoutByBucket.map((x) => x - z.depositUsd);
                  return (
                    <ProfitChart
                      pl={pl}
                      wins={pl.map((v) => v > 0.005)}
                      stake={z.depositUsd}
                      hover={hover}
                      onHover={setHover}
                      cutLabels={ladder.cutLabels}
                      bucketLabels={ladder.bucketLabels}
                      likely={likely}
                      likelyBracket={false}
                      cuts={ladder.cuts}
                      now={{ value: price, label: f(price) }}
                      nowPrefix="Your price"
                      compare={original ? [{ pl: original.pl, label: "Plain Gemini contract" }] : []}
                      height={280}
                    />
                  );
                })()}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[12.5px] text-slate">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: GAIN }} /> You make money
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-[3px] bg-ash" /> You lose
                  </span>
                  {original ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-0 w-4 border-t-2 border-inkstone" /> Plain Gemini contract at your price ({zoneText(ladder, original.option)}), same risk
                    </span>
                  ) : (
                    <span>This is the plain Gemini contract at your price.</span>
                  )}
                </div>
                {hover !== null && (
                  <p className="tnum pt-1 text-[13.5px] text-graphite">
                    If it ends {ladder.bucketLabels[hover].toLowerCase()}: this bet{" "}
                    <b>{usd(quote.payoutByBucket[hover] - z.depositUsd)}</b>
                    {original && (
                      <>
                        {" "}· plain contract <b>{usd(original.pl[hover])}</b>
                      </>
                    )}{" "}
                    · market's chance {pct(ladder.marketProb[hover])}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Win rate (market)" value={pct(option.winRate)} />
                <Stat label="Reward : risk" value={`${(z.winUsd / Math.max(0.01, z.riskUsd)).toFixed(2)} : 1`} />
                <Stat label="You put in" value={usd(z.depositUsd)} note={option.backOutside > 0 ? `${usd(quote.minPayout)} always comes back` : undefined} />
                <Stat label="Fees" value={usd(quote.feesUsd)} />
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded-[18px] bg-cloud p-3 text-[15px]">
                <span>The market says you win <b>{pct(option.winRate)}</b>. You say</span>
                <input
                  type="number"
                  className="input w-20 tnum"
                  placeholder={String(Math.round(option.winRate * 100))}
                  min={0}
                  max={100}
                  value={yourChance}
                  onChange={(e) => setYourChance(e.target.value)}
                />
                <span>%</span>
                <span className="text-slate">
                  · you need more than <b className="text-inkstone">{pct(z.riskUsd / Math.max(0.01, z.riskUsd + z.winUsd))}</b> to come out ahead
                </span>
                {ev !== null && (
                  <span className={ev > 0 ? "font-bold text-gain" : "font-bold text-slate"}>
                    → expected {ev >= 0 ? "+" : ""}{usd(ev)} {ev > 0 ? "if you're right" : "· no edge at that chance"}
                  </span>
                )}
              </div>
              <div>
                <p className="stat-label mb-1">Contracts</p>
                <ul className="flex flex-col gap-1 text-[14px] text-graphite">
                  {quote.legs.map((l) => (
                    <li key={l.symbol + l.side} className="tnum">
                      <b>{l.side.toUpperCase()}</b> {l.label} · {qty(l.qty)} × {cents(l.price)} = {usd(l.usd)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-slate">Pick a price and a direction.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-[18px] bg-cloud p-3">
      <p className="text-[12.5px] text-smoke">{label}</p>
      <p className="tnum text-[22px] font-bold text-inkstone">{value}</p>
      {note && <p className="text-[12px] text-slate">{note}</p>}
    </div>
  );
}
