import type { Ladder, Quote } from "@contour/core";
import { env } from "./env";

export interface MarketSummary {
  ticker: string;
  title: string;
  category: string;
  series: string | null;
  expiry: string;
  kind: Ladder["kind"];
  strikeCount: number;
  bucketCount: number;
  quotedCount: number;
  volume: number | null;
  /** Traded in the last 24 hours. */
  volume24h?: number | null;
  marketProb: number[];
  cutLabels: string[];
  bucketLabels: string[];
  readout: { center: string | null; spread: string | null; leader: string | null; leaderProb: number | null };
  teaser: {
    belief: number[];
    worst: number;
    best: number;
    probProfitYou: number;
    payouts: number[];
    trade: boolean;
    focus?: { label: string; marketProb: number; yourProb: number; paysIfWins: number };
  } | null;
  /** A made-up demo market: explorable, never quotable. */
  sample?: boolean;
}

/** One front-page section per Gemini category (see the desk's CategorySection). */
export interface CategorySection {
  category: string;
  events: number;
  /** Traded in the last 24 hours: what "busiest" means on the front page. */
  volume24h: number;
  /** Traded since each market listed. */
  volume: number;
  tradable: number;
  /** Its most active markets that can't be one curve, with the reason in plain words. */
  popular: { ticker: string; title: string; volume24h: number; volume: number; reason: string }[];
}

export interface StoredQuote {
  quoteId: string;
  ticker: string;
  title?: string;
  forecastHash: string;
  marketIdHex: string;
  /** What goes on-chain: the escrowed stake and payouts, without the quote's cash. */
  scheduleBaseUnits: string[];
  stakeBaseUnits: string;
  /** The quote's cash, which stays in the wallet (absent on quotes from before it stopped being escrowed). */
  keptBaseUnits?: string;
  expiryTs: number;
  validUntil: number;
  capturedAt: string;
  preimage: { ticker: string; marketProb: number[]; belief: number[]; confidence: number; quoteId: string; capturedAt: string; protect?: { units: number; floor?: number; cap?: number }; spread?: { direction: "up" | "down"; from: number; to: number } };
  quote: Omit<Quote, "raw"> & { iterations: number };
  marketProb: number[];
  bucketLabels: string[];
  crossedStrikes: string[];
}

/** Fast tier for a market page: the underlying's spot price and every contract's current asks. */
export interface LiveView {
  at: number;
  frozen: boolean;
  sample: boolean;
  spot: { pair: string; price: number; open24h: number | null; bid: number | null; ask: number | null } | null;
  asks: { symbol: string; yesAsk: number | null; noAsk: number | null }[];
}


/** Paper trading (no wallet): one account per browser, positions filled at Gemini's live prices. */
export type PaperStrategy = "view" | "near" | "spread" | "protect";
export interface PaperRequest {
  belief: number[];
  confidence: number;
  protect?: { units: number; floor?: number; cap?: number };
  spread?: { direction: "up" | "down"; from: number; to: number };
  shape?: "range";
}
export interface PaperPositionSummary {
  id: string;
  ticker: string;
  title: string;
  category: string | null;
  strategy: PaperStrategy;
  viewLabel: string | null;
  status: "open" | "closed" | "settled";
  awaiting: boolean;
  expiry: string;
  openedAt: number;
  closedAt: number | null;
  costUsd: number;
  /** Market value at the mark: the midpoint of bid and ask (how brokerages value holdings). */
  valueUsd: number;
  /** Cash-out estimate: what selling it all now would fetch at the bids, after sell fees. */
  cashOutUsd: number | null;
  /** Gemini's buy fees inside costUsd. */
  feesPaidUsd: number;
  pricing: "live" | "frozen" | "none" | "final";
  /** valueUsd − costUsd, which is moveUsd − entryCostUsd. */
  unrealizedUsd: number;
  /** What buying cost beyond the mark: fees, plus paying the ask instead of the midpoint. */
  entryCostUsd: number;
  /** How the mark has moved since buying: the part of the return that's the market. */
  moveUsd: number;
  realizedUsd: number;
  schedule: number[];
  payoutUsd: number | null;
  outcomeLabel: string | null;
  contracts: number;
  investedUsd: number;
  returnedUsd: number;
  /** A demo position on a made-up past market (sample data). */
  demo: boolean;
  /** Closed and settled positions: how each contract ended, in short. */
  results?: { label: string; side: "yes" | "no"; result: PaperContractResult["result"]; pnlUsd: number }[];
}
/** How one contract in a position ended: bought, then sold, settled, or a mix. */
export interface PaperContractResult {
  symbol: string;
  side: "yes" | "no";
  label: string;
  qty: number;
  avgPrice: number;
  costUsd: number;
  result: "won" | "lost" | "sold" | "mixed" | "open";
  soldQty: number;
  avgSellPrice: number | null;
  settledQty: number;
  won: boolean | null;
  returnedUsd: number;
  pnlUsd: number;
}
export interface PaperFill { symbol: string; side: "yes" | "no"; label: string; qty: number; price: number; feeUsd: number }
export interface PaperTrade {
  id: number;
  position: string;
  title: string;
  kind: "open" | "add" | "sell" | "settle";
  cashUsd: number;
  realizedUsd: number;
  fraction: number | null;
  outcome: string | null;
  fills: PaperFill[];
  at: number;
}
export interface PaperMark { at: number; valueUsd: number }
export interface PaperPortfolio {
  account: string;
  createdAt: number;
  /** When a demo portfolio was added; its history before then, and demo positions, are sample data. */
  demoAt: number | null;
  totals: { cashUsd: number; positionsUsd: number; cashOutUsd: number; totalUsd: number; startUsd: number; unrealizedUsd: number; realizedUsd: number; openCount: number };
  positions: PaperPositionSummary[];
  history: PaperMark[];
  trades: PaperTrade[];
}
export interface PaperLeg {
  symbol: string;
  side: "yes" | "no";
  label: string;
  strike: number | null;
  qty: number;
  avgPrice: number;
  costUsd: number;
  feesUsd: number;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  valueUsd: number | null;
  cashOutUsd: number | null;
  pnlUsd: number | null;
  pays: number[];
}
export interface PaperPositionDetail extends PaperPositionSummary {
  request: PaperRequest;
  ladder: { kind: Ladder["kind"]; bucketLabels: string[]; cutLabels: string[]; cuts: number[] | null; unit: Ladder["unit"]; symbols: string[]; marketProb: number[] };
  cashInPositionUsd: number;
  legs: PaperLeg[];
  contractResults: PaperContractResult[];
  history: PaperMark[];
  trades: PaperTrade[];
  accountCashUsd: number;
  canBuyMore: boolean;
  canSell: boolean;
}

export interface DeskConfig {
  executionMode: "paper" | "sandbox" | "live";
  programId: string | null;
  usdcMint: string | null;
  cluster: string;
  faucetEnabled: boolean;
  /** Desk wallet; null when the desk has no chain keys and cannot accept positions. */
  desk: string | null;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const desk = {
  config: () => fetch(`${env.deskUrl}/config`).then((r) => j<DeskConfig>(r)),
  /** frozenAt is set when Gemini is down and the desk is serving its saved snapshot instead. */
  markets: () =>
    fetch(`${env.deskUrl}/markets`).then((r) => j<{ markets: MarketSummary[]; rejected: number; updatedAt: number; frozenAt?: number | null; sections?: CategorySection[] }>(r)),
  ladder: (ticker: string) =>
    fetch(`${env.deskUrl}/markets/${encodeURIComponent(ticker)}`).then((r) =>
      j<{ ladder: Ladder; capturedAt: string; volume: number | null; frozen?: boolean; sample?: boolean }>(r),
    ),
  live: (ticker: string, signal?: AbortSignal) => fetch(`${env.deskUrl}/live/${encodeURIComponent(ticker)}`, { signal }).then((r) => j<LiveView>(r)),
  paperPortfolio: (account: string) => fetch(`${env.deskUrl}/paper/${account}`).then((r) => j<PaperPortfolio>(r)),
  paperReset: (account: string, demo: boolean) =>
    fetch(`${env.deskUrl}/paper/${account}/reset`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ demo }) }).then((r) => j<PaperPortfolio>(r)),
  paperPosition: (account: string, id: string) => fetch(`${env.deskUrl}/paper/${account}/positions/${id}`).then((r) => j<PaperPositionDetail>(r)),
  paperOpen: (account: string, body: { quoteId: string; label?: string }) =>
    fetch(`${env.deskUrl}/paper/${account}/positions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => j<PaperPositionDetail>(r)),
  paperAdd: (account: string, id: string, quoteId: string) =>
    fetch(`${env.deskUrl}/paper/${account}/positions/${id}/add`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId }) }).then((r) => j<PaperPositionDetail>(r)),
  paperSell: (account: string, id: string, body: { fraction: number; minProceedsUsd?: number }) =>
    fetch(`${env.deskUrl}/paper/${account}/positions/${id}/sell`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
      j<{ sale: { proceedsUsd: number; realizedUsd: number }; position: PaperPositionDetail }>(r),
    ),
  quote: (
    body: {
      ticker: string;
      belief: number[];
      confidence: number;
      stakeUsd: number;
      /** Floor (protect), floor + cap (collar), or cap only (covered call). */
      protect?: { units: number; floor?: number; cap?: number };
      spread?: { direction: "up" | "down"; from: number; to: number };
      /** "range" for Stays near: only positions that lose on both sides. */
      shape?: "free" | "range";
    },
    signal?: AbortSignal,
  ) =>
    fetch(`${env.deskUrl}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }).then((r) =>
      j<StoredQuote>(r),
    ),
  position: (pubkey: string) => fetch(`${env.deskUrl}/positions/${pubkey}`).then((r) => (r.status === 404 ? null : j<PositionView>(r))),
  record: (owner: string) => fetch(`${env.deskUrl}/wallets/${owner}/record`).then((r) => j<RecordView>(r)),
  replay: () => fetch(`${env.deskUrl}/replay`).then((r) => j<ReplayView>(r)),
  faucet: (owner: string) =>
    fetch(`${env.deskUrl}/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner }) }).then((r) =>
      j<{ signature: string; sol: number; usdc: number }>(r),
    ),
  streamUrl: (pubkey: string) => `${env.deskUrl}/positions/${pubkey}/stream`,
};

export interface FillRow {
  id: number;
  symbol: string;
  side: "yes" | "no";
  strike: number | null;
  qty: number;
  price: number | null;
  quoted_price: number;
  mode: string;
  status: "filled" | "unfilled";
  detail: { label?: string; reason?: string; ask?: number } | null;
  created_at: number;
}

export interface PositionView {
  position: {
    pubkey: string;
    owner: string;
    ticker: string | null;
    quote_id: string | null;
    state: string;
    stake_base: string | null;
    max_payout_base: string | null;
    schedule_json: string | null;
    expiry_ts: number | null;
    opened_sig: string | null;
    accepted_sig: string | null;
    settled_sig: string | null;
    cancelled_sig: string | null;
    unwound_sig: string | null;
    outcome_bucket: number | null;
    score_bps: number | null;
    payout_base: string | null;
    note: string | null;
    created_at: number;
    updated_at: number;
  };
  fills: FillRow[];
  quote: StoredQuote | null;
  events: { signature: string; name: string; payload: Record<string, unknown>; block_time: number | null; received_at: number; source: string }[];
  executionMode: string;
}

export interface RecordView {
  owner: string;
  positions: (PositionView["position"] & { title: string | null; bucketLabels: string[] | null })[];
  summary: { count: number; settled: number; meanScore: number | null; totalScore: number };
}

export interface ReplayView {
  sampleSize: number;
  ladders?: number;
  horizonNote?: string;
  generatedAt?: string;
  strategies: { name: string; forecast: string; kind: "contour" | "single"; n: number; mean: number; sd: number; worst: number; best?: number; shareProfit: number }[];
  series: { forecast: string; points: { t: string; ticker: string; contour: number; single: number }[] }[];
  note: string;
}
