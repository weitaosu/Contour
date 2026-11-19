"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tradingFeeUsd, type Quote } from "@contour/core";
import { desk, type LiveView } from "./desk";

/**
 * How often each tier refreshes, brokerage-style: the numbers you'd fill at move quickly, while the
 * charts and summaries (which re-solve the whole position) hold still and update far less often.
 */
export const LIVE_MS = 2_500; // spot price, the order ticket's fill price, the "now" marker
export const CHART_MS = 30_000; // market odds, profit chart, tiles, headline

/** Spot price and current asks, polled every LIVE_MS while the tab is visible. */
export function useLive(ticker: string, enabled = true) {
  return useQuery({
    queryKey: ["live", ticker],
    queryFn: ({ signal }) => desk.live(ticker, signal),
    enabled,
    refetchInterval: LIVE_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export interface LiveFill {
  /** Contracts + fees for the same legs at the current asks. */
  costNow: number;
  /** Contracts + fees as quoted. */
  costThen: number;
  /** costNow − costThen: positive means the same contracts now cost more. */
  delta: number;
  /** Legs whose contract has no ask right now. */
  missing: number;
  /** The position at today's prices, same contracts: every outcome's payout shifts by −delta. */
  minPayout: number;
  maxPayout: number;
  /** The biggest single-contract price move across the legs, in dollars. */
  maxMove: number;
}

/**
 * Re-price a quote's exact contracts at the live asks, like a brokerage ticket's "estimated cost".
 * The stake stays the same, so whatever the contracts cost more (or less) comes out of (or goes back
 * into) the cash kept aside, and every outcome's payout moves by the same amount.
 */
export function liveFill(quote: Pick<Quote, "legs" | "feeRate" | "minPayout" | "maxPayout">, live: LiveView | undefined): LiveFill | null {
  if (!live || !quote.legs.length) return null;
  const asks = new Map(live.asks.map((a) => [a.symbol, a]));
  let costNow = 0;
  let costThen = 0;
  let missing = 0;
  let maxMove = 0;
  for (const leg of quote.legs) {
    const a = asks.get(leg.symbol);
    const ask = a ? (leg.side === "yes" ? a.yesAsk : a.noAsk) : null;
    costThen += leg.usd + leg.fee;
    if (ask === null || !(ask > 0 && ask < 1)) {
      missing++;
      costNow += leg.usd + leg.fee;
      continue;
    }
    costNow += leg.qty * ask + tradingFeeUsd(leg.qty, ask, quote.feeRate);
    maxMove = Math.max(maxMove, Math.abs(ask - leg.price));
  }
  const delta = Math.round((costNow - costThen) * 100) / 100;
  // Kept to the cent and consistent with delta, so "to fill" and "really at risk" always agree.
  const now = Math.round((costThen + delta) * 100) / 100;
  return { costNow: now, costThen, delta, missing, minPayout: quote.minPayout - delta, maxPayout: quote.maxPayout - delta, maxMove };
}

/**
 * "up" or "down" for a moment after a value ticks, then null: drives the green/red flash on live
 * numbers (Webull colors a print green on an uptick and red on a downtick).
 */
export function useTickFlash(value: number | null | undefined, ms = 900): { dir: "up" | "down" | null; n: number } {
  const prev = useRef(value);
  const [state, setState] = useState<{ dir: "up" | "down" | null; n: number }>({ dir: null, n: 0 });
  useEffect(() => {
    const p = prev.current;
    prev.current = value;
    if (p === null || p === undefined || value === null || value === undefined || Math.abs(value - p) < 1e-9) return;
    setState((s) => ({ dir: value > p ? "up" : "down", n: s.n + 1 }));
    const t = setTimeout(() => setState((s) => ({ ...s, dir: null })), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return state;
}
