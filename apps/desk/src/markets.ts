import {
  compile,
  forecastHash,
  marketIdHex,
  tryNormalize,
  type DepthMap,
  type Ladder,
  type Quote,
} from "@contour/core";
import { GeminiPublicClient, type RawEvent } from "@contour/gemini";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import type { DB } from "./db";

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
  marketProb: number[];
  cutLabels: string[];
}

export class MarketService {
  private list: { at: number; markets: MarketSummary[]; rejected: number } | null = null;
  private listPromise: Promise<void> | null = null;
  private events = new Map<string, { at: number; event: RawEvent; promise?: Promise<RawEvent> }>();
  private books = new Map<string, { at: number; yes?: number; no?: number; yesAsk: number | null; noAsk: number | null }>();

  constructor(public client: GeminiPublicClient) {}

  private async refreshList() {
    const all: RawEvent[] = [];
    for (const category of config.marketCategories) {
      try {
        all.push(...(await this.client.listAllEvents({ status: "active", category }, 100, 5)));
      } catch (err) {
        console.warn(`[markets] ${category}:`, (err as Error).message);
      }
    }
    const markets: MarketSummary[] = [];
    let rejected = 0;
    for (const e of all) {
      if (new Date(e.expiryDate).getTime() < Date.now()) continue;
      const r = tryNormalize(e, { categoricalAllowlist: config.categoricalAllowlist });
      if (!("ladder" in r)) {
        rejected++;
        continue;
      }
      const l = r.ladder;
      this.events.set(e.ticker, { at: Date.now(), event: e });
      markets.push({
        ticker: l.eventTicker,
        title: l.title,
        category: l.category,
        series: l.series,
        expiry: l.expiry,
        kind: l.kind,
        strikeCount: l.strikes.length,
        bucketCount: l.marketProb.length,
        quotedCount: l.quoted.filter(Boolean).length,
        volume: e.volume ? Number(e.volume) : null,
        marketProb: l.marketProb,
        cutLabels: l.cutLabels,
      });
    }
    markets.sort((a, b) => a.category.localeCompare(b.category) || a.expiry.localeCompare(b.expiry) || a.title.localeCompare(b.title));
    this.list = { at: Date.now(), markets, rejected };
  }

  /** Stale-while-revalidate list of tradable ladders (refreshes every 60 s). */
  async listMarkets(): Promise<{ markets: MarketSummary[]; rejected: number; updatedAt: number }> {
    const stale = !this.list || Date.now() - this.list.at > 60_000;
    if (stale && !this.listPromise) {
      this.listPromise = this.refreshList().finally(() => (this.listPromise = null));
    }
    if (!this.list) await this.listPromise;
    return { markets: this.list!.markets, rejected: this.list!.rejected, updatedAt: this.list!.at };
  }

  async getEvent(ticker: string, maxAgeMs = 5_000): Promise<RawEvent> {
    const hit = this.events.get(ticker);
    if (hit && Date.now() - hit.at < maxAgeMs) return hit.event;
    if (hit?.promise) return hit.promise;
    const promise = this.client.getEvent(ticker);
    this.events.set(ticker, { at: hit?.at ?? 0, event: hit?.event as RawEvent, promise });
    try {
      const event = await promise;
      this.events.set(ticker, { at: Date.now(), event });
      return event;
    } catch (err) {
      if (hit?.event) this.events.set(ticker, { at: hit.at, event: hit.event });
      else this.events.delete(ticker);
      throw err;
    }
  }

  async getLadder(ticker: string, maxAgeMs = 5_000): Promise<{ ladder: Ladder; event: RawEvent; capturedAt: string }> {
    const event = await this.getEvent(ticker, maxAgeMs);
    const r = tryNormalize(event, { categoricalAllowlist: config.categoricalAllowlist });
    if (!("ladder" in r)) throw Object.assign(new Error(`Ladder not tradable: ${r.reason}`), { statusCode: 422 });
    const at = this.events.get(ticker)?.at ?? Date.now();
    return { ladder: r.ladder, event, capturedAt: new Date(at).toISOString() };
  }

  /**
   * Contracts available at (or better than) the quoted ask, from the order book.
   * YES: asks priced <= yesAsk. NO: a NO ask at p mirrors a YES bid at 1 - p, so bids priced >= 1 - noAsk.
   * The public book only shows the YES side; NO asks without a mirroring YES bid exist (verified on
   * SOL >= $80), so NO depth is "unknown" (no cap) rather than zero when no mirroring bid is found.
   */
  async depthFor(ladder: Ladder, indices: number[], maxAgeMs = 15_000): Promise<DepthMap> {
    const depth: DepthMap = {};
    for (const i of indices) {
      const ins = ladder.instruments[i];
      let b = this.books.get(ins.symbol);
      if (!b || Date.now() - b.at > maxAgeMs || b.yesAsk !== ins.yesAsk || b.noAsk !== ins.noAsk) {
        try {
          const book = await this.client.getBook(ins.symbol, 10);
          const yes = ins.yesAsk === null ? 0 : book.asks.filter((l) => Number(l.price) <= ins.yesAsk! + 1e-9).reduce((a, l) => a + Number(l.amount), 0);
          const mirrored = ins.noAsk === null ? [] : book.bids.filter((l) => 1 - Number(l.price) <= ins.noAsk! + 1e-9);
          const no = mirrored.length ? mirrored.reduce((a, l) => a + Number(l.amount), 0) : undefined;
          b = { at: Date.now(), yes, no, yesAsk: ins.yesAsk, noAsk: ins.noAsk };
          this.books.set(ins.symbol, b);
        } catch (err) {
          console.warn(`[depth] ${ins.symbol}:`, (err as Error).message);
          continue; // depth unknown for this instrument
        }
      }
      depth[ins.symbol] = { ...(b.yes !== undefined ? { yes: b.yes } : {}), ...(b.no !== undefined ? { no: b.no } : {}) };
    }
    return depth;
  }
}

export interface QuoteRequest {
  ticker: string;
  belief: number[];
  confidence: number;
  stakeUsd: number;
}

export interface StoredQuote {
  quoteId: string;
  ticker: string;
  title: string;
  forecastHash: string;
  marketIdHex: string;
  scheduleBaseUnits: string[];
  stakeBaseUnits: string;
  expiryTs: number;
  validUntil: number;
  capturedAt: string;
  preimage: {
    ticker: string;
    marketProb: number[];
    belief: number[];
    confidence: number;
    quoteId: string;
    capturedAt: string;
  };
  quote: Omit<Quote, "raw"> & { iterations: number };
  marketProb: number[];
  bucketLabels: string[];
  crossedStrikes: string[];
}

/** Compile, size against the book, persist and hash a quote. */
export async function makeQuote(markets: MarketService, db: DB, req: QuoteRequest, opts: { withDepth?: boolean } = {}): Promise<StoredQuote> {
  const { ladder, capturedAt } = await markets.getLadder(req.ticker);
  if (req.belief.length !== ladder.marketProb.length) {
    throw Object.assign(new Error(`belief must have ${ladder.marketProb.length} buckets`), { statusCode: 400 });
  }
  let quote = compile({ ladder, belief: req.belief, confidence: req.confidence, stakeUsd: req.stakeUsd });
  if (opts.withDepth !== false && quote.legs.length > 0) {
    const depth = await markets.depthFor(ladder, [...new Set(quote.legs.map((l) => l.instrumentIndex))]);
    quote = compile({ ladder, belief: req.belief, confidence: req.confidence, stakeUsd: req.stakeUsd, depth, warmStart: quote.raw.weights });
  }
  const quoteId = randomUUID();
  const preimage = {
    ticker: ladder.eventTicker,
    marketProb: ladder.marketProb,
    belief: req.belief,
    confidence: req.confidence,
    quoteId,
    capturedAt,
  };
  const hash = forecastHash(preimage);
  const expiryTs = Math.floor(new Date(ladder.expiry).getTime() / 1000);
  const now = Date.now();
  const { raw, ...rest } = quote;
  const stored: StoredQuote = {
    quoteId,
    ticker: ladder.eventTicker,
    title: ladder.title,
    forecastHash: hash,
    marketIdHex: marketIdHex(ladder.eventTicker),
    scheduleBaseUnits: quote.scheduleBase.map(String),
    stakeBaseUnits: String(quote.stakeBase),
    expiryTs,
    validUntil: now + config.quoteTtlMs,
    capturedAt,
    preimage,
    quote: { ...rest, iterations: raw.iterations },
    marketProb: ladder.marketProb,
    bucketLabels: ladder.bucketLabels,
    crossedStrikes: ladder.instruments.filter((_, i) => ladder.crossed[i]).map((i) => i.label),
  };
  db.prepare(
    `INSERT INTO quotes (id, ticker, forecast_hash, preimage_json, quote_json, schedule_json, stake_base, expiry_ts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(quoteId, stored.ticker, hash, JSON.stringify(preimage), JSON.stringify(stored), JSON.stringify(stored.scheduleBaseUnits), stored.stakeBaseUnits, expiryTs, now);
  return stored;
}

export function loadQuoteByHash(db: DB, hash: string): (StoredQuote & { createdAt: number }) | null {
  const row = db.prepare("SELECT quote_json, created_at FROM quotes WHERE forecast_hash = ?").get(hash) as
    | { quote_json: string; created_at: number }
    | undefined;
  return row ? { ...(JSON.parse(row.quote_json) as StoredQuote), createdAt: row.created_at } : null;
}
