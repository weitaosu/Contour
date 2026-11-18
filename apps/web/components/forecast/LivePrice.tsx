"use client";

import type { LiveView } from "@/lib/desk";
import { useTickFlash } from "@/lib/live";

/** Spot prices read like a quote board: cents for big prices, more digits for small ones. */
export function spotText(v: number) {
  const digits = v >= 1000 ? 2 : v >= 10 ? 2 : v >= 1 ? 4 : 5;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/**
 * A number that tints green on an uptick and grey on a downtick, then settles. Used for anything
 * that streams (spot price, cost to fill), never for the charts.
 */
export function TickNumber({ value, text, className = "" }: { value: number | null; text: string; className?: string }) {
  const { dir, n } = useTickFlash(value);
  return (
    <span key={n} className={`tnum -mx-1 px-1 ${dir ? `tick-${dir}` : ""} ${className}`}>
      {text}
    </span>
  );
}

export function LiveDot({ label = "Live" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-gain">
      <span className="live-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** The underlying's live price under the market title, Robinhood-style: big number, change, a live dot. */
export function LivePrice({ spot, name, compact = false, settles }: { spot: NonNullable<LiveView["spot"]>; name: string; compact?: boolean; settles?: string }) {
  const change = spot.open24h ? spot.price - spot.open24h : null;
  const pctChange = change !== null && spot.open24h ? change / spot.open24h : null;
  const up = (change ?? 0) >= 0;
  return (
    <div
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 ${compact ? "" : "mt-3"}`}
      title={`Gemini's last ${name}/USD trade, and its change over 24 hours. The market settles on its reference index${settles ? ` at ${settles}` : ""}, which can differ slightly from this price.`}
    >
      <span className="text-[14px] font-bold text-slate">{name} now</span>
      <TickNumber
        value={spot.price}
        text={spotText(spot.price)}
        className={`font-bold leading-none text-inkstone ${compact ? "text-[22px]" : "text-[28px] md:text-[32px]"}`}
      />
      {change !== null && pctChange !== null && (
        <span className={`tnum text-[15px] font-bold ${up ? "text-gain" : "text-slate"}`}>
          {up ? "▲" : "▼"} {spotText(Math.abs(change))} ({(Math.abs(pctChange) * 100).toFixed(2)}%) <span className="font-normal text-smoke">24h</span>
        </span>
      )}
      <LiveDot label="Live on Gemini" />
    </div>
  );
}
