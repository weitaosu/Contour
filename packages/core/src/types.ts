export type LadderKind = "threshold" | "buckets" | "categorical";

/** One tradable contract. For threshold ladders: one per strike. Otherwise: one per outcome. */
export interface Instrument {
  symbol: string; // instrumentSymbol from the API, never constructed
  label: string;
  yesAsk: number | null;
  noAsk: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  minQty: number;
  qtyStep: number;
  priceStep: number;
}

export interface Ladder {
  eventTicker: string;
  title: string;
  category: string;
  series: string | null;
  expiry: string; // ISO
  kind: LadderKind;
  /** Threshold ladders: ascending strikes, length n. Empty otherwise. */
  strikes: number[];
  /** Ordered ladders: n_buckets - 1 cut points on the outcome axis. null for categorical. */
  cuts: number[] | null;
  /** One label per bucket (n+1 for threshold ladders). */
  bucketLabels: string[];
  /** Short labels for chart ticks at each cut. */
  cutLabels: string[];
  instruments: Instrument[];
  marketProb: number[]; // per bucket, sums to 1
  quoted: boolean[]; // per instrument: both sides have asks
  crossed: boolean[]; // per instrument: yesAsk + noAsk < 1 (stale / transient quote)
  interpolated: boolean[]; // per instrument: mid was interpolated for the curve
  unit: { prefix: string; suffix: string };
}

export interface Leg {
  symbol: string;
  label: string;
  side: "yes" | "no";
  strike: number | null;
  instrumentIndex: number;
  price: number;
  qty: number;
  usd: number;
  capped?: boolean;
}

export interface Comparison {
  symbol: string;
  label: string;
  side: "yes" | "no";
  price: number;
  qty: number;
  payoutIfWin: number;
  probWinBelief: number;
  probWinMarket: number;
}

export interface Quote {
  legs: Leg[];
  cashUsd: number;
  payoutByBucket: number[]; // USD, final, after post-processing
  scheduleBase: number[]; // USDC base units (6 dp), the on-chain schedule
  stakeBase: number;
  minPayout: number;
  maxPayout: number;
  evUnderBelief: number;
  evUnderMarket: number;
  probProfitBelief: number;
  probProfitMarket: number;
  expectedLogGrowth: number; // under the blended forecast, after post-processing
  advice: "trade" | "no_edge";
  comparison: Comparison | null;
  maxAbsorbableStakeUsd: number | null;
  raw: {
    weights: number[];
    instruments: { index: number; side: "cash" | "yes" | "no"; price: number }[];
    payoutByBucket: number[];
    expectedLogGrowth: number;
    iterations: number;
    converged: boolean;
  };
}

/** Contracts available at the quoted ask, per instrument symbol and side. */
export type DepthMap = Record<string, { yes?: number; no?: number }>;
