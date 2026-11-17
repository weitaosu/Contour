import type { Leg } from "@contour/core";
import { assertLiveAllowed, executionMode, type ExecutionMode } from "@contour/gemini/signed";
import type { MarketService } from "../markets";

export interface Fill {
  symbol: string;
  side: "yes" | "no";
  qty: number;
  price: number | null; // fill price, null if unfilled
  quotedPrice: number;
  status: "filled" | "unfilled";
  mode: ExecutionMode;
  detail: Record<string, unknown>;
}

export interface Executor {
  mode: ExecutionMode;
  place(leg: Leg, ticker: string): Promise<Fill>;
}

/**
 * Paper execution: fill at the current ask if it is at or below the quoted price, and record the quote used.
 * Nothing is sent to Gemini. Every paper fill is shown in the UI as "simulated fill at live quote".
 */
export class PaperExecutor implements Executor {
  mode = "paper" as const;
  constructor(private markets: MarketService) {}
  async place(leg: Leg, ticker: string): Promise<Fill> {
    const event = await this.markets.getEvent(ticker, 2_000);
    const c = event.contracts.find((x) => x.instrumentSymbol === leg.symbol);
    const ask = c?.prices?.buy?.[leg.side];
    const askNum = ask ? Number(ask) : null;
    const quote = { capturedAt: new Date().toISOString(), buy: c?.prices?.buy ?? null, bestBid: c?.prices?.bestBid ?? null, bestAsk: c?.prices?.bestAsk ?? null };
    if (askNum !== null && askNum <= leg.price + 1e-9) {
      return { symbol: leg.symbol, side: leg.side, qty: leg.qty, price: askNum, quotedPrice: leg.price, status: "filled", mode: "paper", detail: { label: leg.label, simulated: true, quote } };
    }
    return {
      symbol: leg.symbol,
      side: leg.side,
      qty: leg.qty,
      price: null,
      quotedPrice: leg.price,
      status: "unfilled",
      mode: "paper",
      detail: { label: leg.label, simulated: true, reason: askNum === null ? "no ask on this side" : `ask moved to ${askNum}`, ask: askNum, quote },
    };
  }
}

/** Live execution exists behind the same interface but refuses to run unless both live flags are set. */
export class LiveExecutor implements Executor {
  mode = "live" as const;
  constructor() {
    assertLiveAllowed();
  }
  async place(): Promise<Fill> {
    assertLiveAllowed();
    throw new Error("Live execution is not enabled in this build.");
  }
}

export function makeExecutor(markets: MarketService): Executor {
  const mode = executionMode();
  if (mode === "live") return new LiveExecutor();
  // Sandbox execution is a stretch item; until verified it falls back to paper, and the UI says paper.
  return new PaperExecutor(markets);
}
