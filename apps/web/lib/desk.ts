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
  scheduleBaseUnits: string[];
  stakeBaseUnits: string;
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
  quote: (
    body: {
      ticker: string;
      belief: number[];
      confidence: number;
      stakeUsd: number;
      /** Floor (protect), floor + cap (collar), or cap only (covered call). */
      protect?: { units: number; floor?: number; cap?: number };
      spread?: { direction: "up" | "down"; from: number; to: number };
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
