"use client";

import { useEffect, useRef, useState } from "react";
import { formatValue, type Ladder, type ProtectionInfo, type Quote } from "@contour/core";
import { COLORS, tickStride } from "@/components/charts/common";
import { useSize } from "@/components/charts/useSize";
import { pct, usd } from "@/lib/format";
import { oneIn, Tile } from "./ProfitCard";

const signedUsd = (n: number) => `${n > 0.004 ? "+" : n < -0.004 ? "−" : ""}${usd(Math.abs(n))}`;

/**
 * The "holding" strategies, for someone who already owns the asset: a protective floor, a collar
 * (floor + cap) and a covered call (cap only). The comparison that matters is their holding alone vs
 * holding + this position, outcome by outcome.
 */
export function ProtectCard({
  ladder,
  quote,
  protection,
  name,
  source,
  floorAloneCost = null,
}: {
  ladder: Ladder;
  quote: Omit<Quote, "raw">;
  protection: ProtectionInfo;
  name: string;
  source: "desk quote" | "preview";
  /** Collar only: what the floor would cost without the cap, for comparison. */
  floorAloneCost?: number | null;
}) {
  const kind: "floor" | "collar" | "covered" = protection.floor === null ? "covered" : protection.cap !== null && protection.backInMiddle !== null ? "collar" : "floor";
  const fmt = (v: number) => formatValue(Math.round(v * 100) / 100, ladder.unit);
  const cost = quote.stakeBase / 1e6;
  const alone = protection.holdingChange;
  const withPos = alone.map((h, j) => h + quote.payoutByBucket[j] - cost);
  const pays = quote.payoutByBucket.map((p) => p > 0.005 + quote.cashUsd);
  const chance = ladder.marketProb.reduce((s, q, j) => s + (pays[j] ? q : 0), 0);
  const worstAlone = Math.min(...alone);
  const worstWith = Math.min(...withPos);
  const ev = quote.evUnderMarket;
  // What comes back below the cap, read from this quote's own payouts (not the preview's), so the card
  // always agrees with the order panel and review.
  const back = (() => {
    if (protection.cap === null) return protection.backInMiddle ?? 0;
    const j = protection.holdingChange.findIndex((h) => {
      const m = h / protection.units + protection.reference;
      return m > (protection.floor ?? -Infinity) && m < protection.cap!;
    });
    return j >= 0 ? quote.payoutByBucket[j] : (protection.backInMiddle ?? 0);
  })();
  const income = back - cost;
  const cap = protection.cap;
  const capTop = protection.capTop ?? cap;
  const floor = protection.floor;
  const downTo = protection.coveredDownTo;
  const [hover, setHover] = useState<number | null>(null);
  // Covered calls are about the upside given up, so start the readout at the best case alone.
  const focus = hover ?? (kind === "covered" ? alone.indexOf(Math.max(...alone)) : alone.indexOf(worstAlone));
  const withLabel = kind === "covered" ? "With covered call" : kind === "collar" ? "With collar" : "With protection";
  // Chance it stays below the cap, by the market's odds (covered call: when you keep the income).
  const mids = protection.holdingChange.map((h) => h / protection.units + protection.reference);
  const belowCap = cap === null ? 0 : ladder.marketProb.reduce((s, q, j) => s + (mids[j] < cap ? q : 0), 0);

  return (
    <section className="card fade-up flex flex-col gap-6" aria-labelledby="protect-headline">
      <div>
        <p className="eyebrow">{kind === "covered" ? "Covered call" : kind === "collar" ? "Collar" : "Protect what you hold"} · in plain words</p>
        <p id="protect-headline" className="mt-2 text-[22px] font-bold leading-snug text-inkstone md:text-[26px]" aria-live="polite">
          {kind === "covered" ? (
            <>
              If {name} stays below <span className="text-signal-violet">{fmt(cap!)}</span>, you earn <span className="text-gain">{usd(income)}</span>. In return you
              give up gains above it.
            </>
          ) : (
            <>
              If {name} ends below <span className="text-signal-violet">{fmt(floor!)}</span>, you&apos;re paid back the drop below it, down to {fmt(downTo ?? floor!)}
              {kind === "collar" ? (
                <>
                  . In return you give up gains above <span className="text-signal-violet">{fmt(cap!)}</span>.
                </>
              ) : (
                "."
              )}
            </>
          )}
        </p>
        <p className="mt-1 text-slate">
          {kind === "covered"
            ? `You put in ${usd(cost)}; ${usd(back)} comes back unless ${name} rises past ${fmt(cap!)}.`
            : kind === "collar"
              ? `If it ends between ${fmt(floor!)} and ${fmt(cap!)}, the collar costs you ${usd(cost - back)}${
                  floorAloneCost !== null ? `, instead of ${usd(floorAloneCost)} for the floor alone` : ""
                }.`
              : `If it stays above ${fmt(floor!)}, the protection expires and costs you ${usd(cost)}.`}
        </p>
      </div>

      <div className="-mx-2 rounded-[24px] bg-porcelain px-4 pb-3 pt-5 sm:mx-0 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className="text-[14px] text-slate">
              {hover === null ? <span className="text-smoke">{kind === "covered" ? "Best case alone · " : "Worst case · "}</span> : null}If it lands{" "}
              {ladder.bucketLabels[focus].replace(/^Below/, "below")}
            </p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <p className="tnum text-[15px] text-slate">
                Your {name} alone <b className="text-[22px] text-inkstone">{signedUsd(alone[focus])}</b>
              </p>
              <p className="tnum text-[15px] text-slate">
                {withLabel} <b className={`text-[22px] ${withPos[focus] > 0.004 ? "text-gain" : "text-signal-violet"}`}>{signedUsd(withPos[focus])}</b>
              </p>
            </div>
          </div>
          <p className="text-[13px] text-smoke">
            <span className="sm:hidden">Tap or slide across the chart</span>
            <span className="hidden sm:inline">Point at the chart, or use ← → keys</span>
          </p>
        </div>
        <ProtectChart ladder={ladder} alone={alone} withPos={withPos} floor={floor} cap={cap} hover={hover} onHover={setHover} />
        <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 pb-1 text-[13px] text-slate">
          <span className="inline-flex items-center gap-2">
            <span className="h-0 w-4 border-t-[1.5px] border-dashed border-smoke" /> Your {name} alone
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-[3px] w-4 rounded-full bg-signal-violet" /> {withLabel}
          </span>
          <span className="text-smoke">· gains and losses vs {fmt(protection.reference)} · {source}</span>
        </div>
      </div>

      {kind === "covered" ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Tile label="You put in" value={usd(cost)} sub={`includes ${usd(quote.feesUsd ?? 0)} in Gemini fees`} />
          <Tile label="Income" value={<span className="text-gain">+{usd(income)}</span>} sub={`if it stays below ${fmt(cap!)}`} />
          <Tile label="Chance you keep it" value={pct(belowCap)} sub={`${oneIn(belowCap)} by the market`} />
          <Tile label="Gains stop at" value={fmt(cap!)} sub={`given up up to ${fmt(capTop!)}`} />
        </div>
      ) : kind === "collar" ? (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Tile label="You put in" value={usd(cost)} sub={`${usd(back)} comes back unless it passes ${fmt(cap!)}`} />
          <Tile
            label="Net cost"
            value={<span className="text-signal-violet">{usd(cost - back)}</span>}
            sub={floorAloneCost !== null ? `vs ${usd(floorAloneCost)} for the floor alone` : `if it ends ${fmt(floor!)}–${fmt(cap!)}`}
          />
          <Tile label="Worst case protected" value={<span className="text-signal-violet">{signedUsd(worstWith)}</span>} sub={`vs ${signedUsd(worstAlone)} alone`} />
          <Tile label="Gains stop at" value={fmt(cap!)} sub={`given up up to ${fmt(capTop!)}`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Tile label="Costs" value={usd(cost)} sub={`includes ${usd(quote.feesUsd ?? 0)} in Gemini fees`} />
          <Tile label="Worst case alone" value={signedUsd(worstAlone)} sub={`if it lands ${ladder.bucketLabels[alone.indexOf(worstAlone)].replace(/^Below/, "below")}`} />
          <Tile label="Worst case protected" value={<span className="text-signal-violet">{signedUsd(worstWith)}</span>} sub={`down to ${fmt(downTo ?? floor!)}, cost included`} />
          <Tile label="Pays out" value={`below ${fmt(floor!)}`} sub={`${pct(chance)} · ${oneIn(chance)} by the market`} />
        </div>
      )}

      <ul className="flex flex-col gap-2 rounded-[20px] bg-porcelain px-5 py-4 text-[14px] leading-relaxed text-inkstone">
        {cap !== null && (
          <li>
            <b>{kind === "covered" ? "Your upside pays for the income." : "The cap locks up money for a while."}</b> {usd(cost)} goes in; {usd(back)} of it comes back
            unless {name} rises past {fmt(cap)}. Above {fmt(capTop!)}, where Gemini&apos;s ladder ends, your gains count again.
          </li>
        )}
        <li>
          <b>{kind === "covered" ? "It still costs a little on average." : "Insurance has a price."}</b> By the market&apos;s odds this pays back{" "}
          <span className="tnum font-bold">{usd(ev)}</span> on average for its <span className="tnum">{usd(cost)}</span> cost. The{" "}
          <span className="tnum">{usd(Math.max(0, cost - ev))}</span> difference is Gemini&apos;s fees plus the gap between its asking prices and the market&apos;s odds.
        </li>
        {floor !== null && downTo !== null && (
          <li>
            <b>It stops at {fmt(downTo)}.</b> That&apos;s the lowest price Gemini lists for this market. If {name} falls further, the extra losses aren&apos;t covered.
          </li>
        )}
        {kind === "covered" && (
          <li>
            <b>It doesn&apos;t protect you.</b> If {name} falls, you lose on what you hold just as before; the income only softens it a little.
          </li>
        )}
        <li>
          <b>It doesn&apos;t touch your {name}.</b> Contour never holds or sees it; this pays out on where the price ends, and it&apos;s sized for{" "}
          {protection.units.toLocaleString("en-US", { maximumFractionDigits: 4 })} {name}.
        </li>
      </ul>
    </section>
  );
}

/** Holding alone (dashed) vs holding + position (violet), outcome by outcome, with the floor and cap marked. */
function ProtectChart({
  ladder,
  alone,
  withPos,
  floor,
  cap = null,
  hover,
  onHover,
}: {
  ladder: Ladder;
  alone: number[];
  withPos: number[];
  floor: number | null;
  cap?: number | null;
  hover: number | null;
  onHover: (j: number | null) => void;
}) {
  const { ref, width: measured } = useSize<HTMLDivElement>();
  const W = measured || 600;
  const H = 240;
  const pad = { l: 56, r: 12, t: 16, b: 30 };
  const n = alone.length;
  const all = [...alone, ...withPos, 0];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const yMin = lo - span * 0.08;
  const yMax = hi + span * 0.08;
  const step = (W - pad.l - pad.r) / n;
  const x = (j: number) => pad.l + (j + 0.5) * step;
  const y = (v: number) => pad.t + ((yMax - v) / (yMax - yMin)) * (H - pad.t - pad.b);
  const line = (vs: number[]) => vs.map((v, j) => `${j ? "L" : "M"}${x(j).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const cuts = ladder.cuts ?? [];
  const floorIdx = floor === null ? -1 : cuts.findIndex((c) => c >= floor);
  const floorX = floorIdx >= 0 ? pad.l + (floorIdx + 1) * step : null;
  const capIdx = cap === null ? -1 : cuts.findIndex((c) => c >= cap);
  const capX = capIdx >= 0 ? pad.l + (capIdx + 1) * step : null;
  const topX = cap === null ? null : pad.l + cuts.length * step;
  const stride = tickStride(cuts.length, W - pad.l - pad.r, 58);
  const ticks = [yMin, 0, yMax].map((v) => Math.round(v / 10) * 10).filter((v, i, a) => a.indexOf(v) === i);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (hover !== null && hover >= n) onHover(null);
  }, [hover, n, onHover]);
  const money = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const pick = (clientX: number, el: SVGSVGElement) => {
    const px = clientX - el.getBoundingClientRect().left;
    if (px < pad.l || px > W - pad.r) return null;
    return Math.min(n - 1, Math.max(0, Math.floor((px - pad.l) / step)));
  };

  return (
    <div ref={ref} className="mt-3 w-full select-none" style={{ height: H }}>
      {measured > 0 && (
        <svg
          ref={svgRef}
          width={W}
          height={H}
          role="img"
          tabIndex={0}
          aria-label="Change in value by outcome: your holding alone versus with this position"
          className="rounded-[12px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal-violet"
          style={{ touchAction: "pan-y" }}
          onPointerDown={(e) => onHover(pick(e.clientX, e.currentTarget))}
          onPointerMove={(e) => onHover(pick(e.clientX, e.currentTarget))}
          onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") onHover(hover === null ? 0 : Math.min(n - 1, hover + 1));
            else if (e.key === "ArrowLeft") onHover(hover === null ? n - 1 : Math.max(0, hover - 1));
            else if (e.key === "Escape") onHover(null);
            else return;
            e.preventDefault();
          }}
          onBlur={() => onHover(null)}
        >
          {/* protected zone: below the floor */}
          {floorX !== null && <rect x={pad.l} y={pad.t} width={floorX - pad.l} height={H - pad.t - pad.b} rx={10} fill="rgba(89,79,244,0.06)" />}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? COLORS.ink : COLORS.mist} strokeWidth={t === 0 ? 1.5 : 1} />
              <text x={pad.l - 10} y={y(t)} dy="0.32em" textAnchor="end" fontSize={12.5} fill={t === 0 ? COLORS.ink : COLORS.smoke} fontWeight={t === 0 ? 700 : 500} className="tnum">
                {money(t)}
              </text>
            </g>
          ))}
          {floorX !== null && (
            <>
              <line x1={floorX} x2={floorX} y1={pad.t} y2={H - pad.b} stroke={COLORS.slate} strokeWidth={1.25} strokeDasharray="4 4" />
              <text x={floorX - 6} y={pad.t + 12} textAnchor="end" fontSize={12} fontWeight={700} fill={COLORS.violet}>
                Protected
              </text>
            </>
          )}
          {/* capped zone: gains given up between the cap and the top strike */}
          {capX !== null && topX !== null && (
            <>
              <rect x={capX} y={pad.t} width={Math.max(0, topX - capX)} height={H - pad.t - pad.b} rx={10} fill="rgba(31,31,31,0.04)" />
              <line x1={capX} x2={capX} y1={pad.t} y2={H - pad.b} stroke={COLORS.slate} strokeWidth={1.25} strokeDasharray="4 4" />
              <text x={capX + 6} y={pad.t + 12} fontSize={12} fontWeight={700} fill={COLORS.slate}>
                Capped
              </text>
            </>
          )}
          <path d={line(alone)} fill="none" stroke={COLORS.smoke} strokeWidth={1.75} strokeDasharray="5 5" />
          <path d={line(withPos)} fill="none" stroke={COLORS.violet} strokeWidth={3} strokeLinejoin="round" />
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke={COLORS.ink} strokeOpacity={0.3} />
              <circle cx={x(hover)} cy={y(alone[hover])} r={4.5} fill={COLORS.white} stroke={COLORS.smoke} strokeWidth={2} />
              <circle cx={x(hover)} cy={y(withPos[hover])} r={5} fill={COLORS.white} stroke={COLORS.violet} strokeWidth={2.5} />
            </g>
          )}
          {cuts.map((c, i) =>
            i % stride === 0 ? (
              <text
                key={i}
                x={pad.l + (i + 1) * step}
                y={H - 8}
                textAnchor="middle"
                fontSize={12.5}
                fill={c === floor || c === cap ? COLORS.ink : COLORS.smoke}
                fontWeight={c === floor || c === cap ? 700 : 500}
                className="tnum"
              >
                {ladder.cutLabels[i]}
              </text>
            ) : null,
          )}
        </svg>
      )}
    </div>
  );
}

const chip = (on: boolean) =>
  `ease tnum rounded-full border py-1.5 text-[14px] font-bold ${on ? "border-signal-violet bg-signal-violet text-white" : "border-mist bg-porcelain text-inkstone hover:border-ash"}`;

/** The order panel's inputs for the holding strategies: how much you hold, the floor and/or the cap. */
export function ProtectControls({
  name,
  units,
  setUnits,
  floors,
  floor,
  setFloor,
  unit,
  cap,
}: {
  name: string;
  units: number;
  setUnits: (n: number) => void;
  /** Empty for a covered call (no floor). */
  floors: number[];
  floor: number;
  setFloor: (n: number) => void;
  unit: Ladder["unit"];
  /** Collar or covered call: the cap choices and the chosen cap. `income` words it for a covered call. */
  cap?: { caps: number[]; value: number; set: (n: number) => void; income?: boolean };
}) {
  const [text, setText] = useState(String(units));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== input.current) setText(String(units));
  }, [units]);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <label className="stat-label" htmlFor="units">
            Your holding
          </label>
          <p className="mt-1 font-bold text-inkstone">How much {name} do you hold?</p>
        </div>
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Quick amounts">
          {[1, 10, 50, 100].map((a) => (
            <button key={a} type="button" aria-pressed={units === a} onClick={() => setUnits(a)} className={chip(units === a)}>
              {a}
            </button>
          ))}
        </div>
        <div className="relative">
          <input
            id="units"
            ref={input}
            className="input tnum !pr-16 text-[20px] font-bold"
            inputMode="decimal"
            value={text}
            onChange={(e) => {
              const t = e.target.value.replace(/[^0-9.]/g, "");
              setText(t);
              const n = Number(t);
              if (n > 0) setUnits(Math.round(n * 1e4) / 1e4);
            }}
            onBlur={() => setText(String(units))}
          />
          <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate">{name}</span>
        </div>
      </div>
      {floors.length > 0 && (
        <div className="flex flex-col gap-3">
          <div>
            <span className="stat-label" id="floor-label">
              Floor
            </span>
            <p className="mt-1 font-bold text-inkstone">Protect me below</p>
            <p className="text-[14px] text-slate">A higher floor protects more of your value, and costs more.</p>
          </div>
          <div role="radiogroup" aria-labelledby="floor-label" className="grid grid-cols-3 gap-2">
            {floors.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={f === floor} onClick={() => setFloor(f)} className={chip(f === floor)}>
                {formatValue(f, unit)}
              </button>
            ))}
          </div>
        </div>
      )}
      {cap && (
        <div className="flex flex-col gap-3">
          <div>
            <span className="stat-label" id="cap-label">
              Cap
            </span>
            <p className="mt-1 font-bold text-inkstone">Give up gains above</p>
            <p className="text-[14px] text-slate">
              {cap.income ? "A lower cap earns more income, and gives up more upside." : "A lower cap pays for more of your floor, and gives up more upside."}
            </p>
          </div>
          <div role="radiogroup" aria-labelledby="cap-label" className="grid grid-cols-3 gap-2">
            {cap.caps.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={c === cap.value} onClick={() => cap.set(c)} className={chip(c === cap.value)}>
                {formatValue(c, unit)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
