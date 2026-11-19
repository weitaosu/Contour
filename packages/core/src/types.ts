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
  /**
   * Threshold ladders only: this contract's YES pays at or below its strike ("Before Jun 1, 2027",
   * "6,300 or below") instead of at or above it. Prices stay exactly as Gemini quotes them; only
   * paysIn and the market curve read the contract the other way (see aboveView).
   */
  below?: boolean;
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
  /**
   * date: strikes and cuts are UTC timestamps (ms) and format as dates ("Before …" ladders), to the
   * precision the contracts are written in: whole years, months, or days.
   */
  unit: { prefix: string; suffix: string; date?: "year" | "month" | "day" };
  /**
   * Categorical only: the label of an extra last outcome, "none of the listed ones" (an unlisted
   * candidate, a game with no result, the No side of a single yes/no question). No listed contract
   * resolves YES in it, so it is paid when every contract resolves NO. Absent when the listed
   * outcomes cover every result.
   */
  none?: string;
}

export interface Leg {
  symbol: string;
  label: string;
  side: "yes" | "no";
  strike: number | null;
  instrumentIndex: number;
  price: number;
  qty: number;
  /** Contract cost at the ask (qty × price), excluding the fee. */
  usd: number;
  /** Gemini trading fee for this leg's order, rounded up to the cent. */
  fee: number;
  capped?: boolean;
}

export interface Comparison {
  symbol: string;
  label: string;
  side: "yes" | "no";
  price: number;
  qty: number;
  /** Gemini trading fee for buying `qty` at `price`; qty is sized so contracts + fee fit in the stake. */
  fee: number;
  payoutIfWin: number;
  probWinBelief: number;
  probWinMarket: number;
}

export interface Quote {
  legs: Leg[];
  /** Stake not spent on contracts or fees: stake − Σ leg.usd − feesUsd, exact to the base unit. It comes back in every outcome, so it stays in the wallet (see escrowTerms). */
  cashUsd: number;
  /** Total Gemini trading fees across all legs (already taken out of the payout schedule). */
  feesUsd: number;
  /** Fee rate the quote was priced with (Gemini taker rate unless overridden). */
  feeRate: number;
  payoutByBucket: number[]; // USD, final, after post-processing
  scheduleBase: number[]; // USDC base units (6 dp), cash included; escrowTerms gives the on-chain schedule
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
    instruments: { index: number; side: "cash" | "yes" | "no" | "pair"; price: number }[];
    payoutByBucket: number[];
    expectedLogGrowth: number;
    iterations: number;
    converged: boolean;
  };
}

/** Contracts available at the quoted ask, per instrument symbol and side. */
export type DepthMap = Record<string, { yes?: number; no?: number }>;
