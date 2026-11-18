import {
  compile,
  formatValue,
  fromMarket,
  marketMoments,
  forecastHash,
  marketIdHex,
  protect,
  spread,
  tryNormalize,
  type DepthMap,
  type Ladder,
  type Quote,
} from "@contour/core";
import { GeminiPublicClient, type RawEvent } from "@contour/gemini";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import type { DB } from "./db";
import { loadSamples, loadSnapshot, saveSnapshot } from "./snapshot";

/** How often the desk refreshes its own frozen copy of Gemini's markets while Gemini is up. */
const SNAPSHOT_EVERY_MS = 10 * 60_000;
/**
 * Markets stop being listed or quoted this long before they settle: in the last minutes Gemini's
 * makers pull their quotes, the ladder turns one-sided, and there's no time left to lock a position.
 */
export const CLOSE_BUFFER_MS = 10 * 60_000;

/** Used when Gemini's category list can't be read. */
const FALLBACK_CATEGORIES = ["Politics", "Economics", "Tech", "Business", "Crypto", "Sports", "Culture", "Commodities", "Midterms", "Weather", "Finance", "Economy"];
/** "Live" re-lists in-play events that already belong to a real category, so it's skipped. */
const SKIP_CATEGORIES = new Set(["Live"]);

/**
 * One front-page section per Gemini category: how much it trades, what Contour can trade as one
 * curve, and its most popular markets that can't be, with the reason in plain words.
 */
export interface CategorySection {
  category: string;
  events: number;
  /** Traded in the last 24 hours across the section's markets: what "busiest" means on the front page. */
  volume24h: number;
  /** Traded since each market listed. */
  volume: number;
  tradable: number;
  popular: { ticker: string; title: string; volume24h: number; volume: number; reason: string }[];
}

/** Why a market can't be one curve, for a reader rather than a log. */
export function plainReason(reason: string): string {
  if (/fewer than \d+ outcomes/.test(reason)) return "A single yes/no question";
  if (/not provably mutually exclusive/.test(reason)) return "More than one outcome can come true";
  if (/none of the listed outcomes/.test(reason)) return "The winner may not be on the list";
  if (/spread/.test(reason)) return "A point spread";
  if (/several underlyings/.test(reason)) return "Player props: several stats in one market";
  if (/quoted|tight two-sided/.test(reason)) return "Too thinly quoted right now";
  if (/exceeds the/.test(reason)) return "Too many outcomes for one position";
  if (/duplicate strikes/.test(reason)) return "More than one underlying";
  return "Its outcomes don't form one set";
}

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
  volume24h: number | null;
  marketProb: number[];
  cutLabels: string[];
  bucketLabels: string[];
  /** Readout: implied center and spread for ordered ladders; the leader for named outcomes. */
  readout: { center: string | null; spread: string | null; leader: string | null; leaderProb: number | null };
  /** What a calmer view (market center, 0.6x width, confidence 0.5, $100) would get, from the real compiler. */
  teaser: {
    belief: number[];
    worst: number;
    best: number;
    probProfitYou: number;
    payouts: number[];
    trade: boolean;
    /** Races only: the example "this candidate is underrated" view. */
    focus?: { label: string; marketProb: number; yourProb: number; paysIfWins: number };
  } | null;
  /** A made-up demo market (fixtures/demo/sample-markets.json): explorable, never quotable. */
  sample?: boolean;
}

export interface LiveView {
  /** When the asks were captured (ms). */
  at: number;
  frozen: boolean;
  sample: boolean;
  /** The underlying's spot price from Gemini's exchange (crypto only). */
  spot: { pair: string; price: number; open24h: number | null; bid: number | null; ask: number | null } | null;
  asks: { symbol: string; yesAsk: number | null; noAsk: number | null }[];
}

const isSampleTicker = (ticker: string) => loadSamples().some((e) => e.ticker === ticker);
/** Configured categorical allowlist plus the sample races, which are exclusive by construction. */
const allowlist = () => [...config.categoricalAllowlist, ...loadSamples().map((e) => e.ticker)];

export class MarketService {
  /** frozenAt: when the data was captured, if it came from the saved snapshot instead of live Gemini. */
  private list: { at: number; markets: MarketSummary[]; rejected: number; frozenAt: number | null; sections: CategorySection[] } | null = null;
  private listPromise: Promise<void> | null = null;
  private events = new Map<string, { at: number; event: RawEvent; frozen?: boolean; promise?: Promise<RawEvent> }>();
  private books = new Map<string, { at: number; yes?: number; no?: number; yesAsk: number | null; noAsk: number | null }>();
  private lastSnapshotAt = 0;

  constructor(public client: GeminiPublicClient) {}

  /** The categories to list: every category Gemini has ("*"), or the configured ones. */
  private async categories(): Promise<string[]> {
    if (!config.marketCategories.includes("*")) return config.marketCategories;
    try {
      const { categories } = await this.client.getCategories();
      return categories.filter((c) => !SKIP_CATEGORIES.has(c));
    } catch (err) {
      console.warn("[markets] category list:", (err as Error).message);
      return FALLBACK_CATEGORIES;
    }
  }

  private async refreshList() {
    const all: RawEvent[] = [];
    const seen = new Set<string>();
    let failures = 0;
    for (const category of await this.categories()) {
      try {
        // An event can be listed under more than one category; keep the first copy.
        for (const e of await this.client.listAllEvents({ status: "active", category }, 100, 5)) {
          if (seen.has(e.ticker)) continue;
          seen.add(e.ticker);
          all.push(e);
        }
      } catch (err) {
        failures++;
        console.warn(`[markets] ${category}:`, (err as Error).message);
      }
    }
    // Gemini gave us nothing at all: serve the frozen copy rather than an empty demo.
    let frozenAt: number | null = null;
    let source = all;
    if (all.length === 0 && failures > 0) {
      const snap = loadSnapshot();
      if (snap) {
        source = snap.events;
        frozenAt = snap.capturedAt;
        console.warn(`[markets] Gemini unavailable; serving ${snap.events.length} markets frozen at ${new Date(snap.capturedAt).toISOString()}`);
      }
    }
    const markets: MarketSummary[] = [];
    const tradable: RawEvent[] = [];
    let rejected = 0;
    const stats = new Map<string, CategorySection>();
    const section = (cat: string) => {
      let s = stats.get(cat);
      if (!s) stats.set(cat, (s = { category: cat, events: 0, volume24h: 0, volume: 0, tradable: 0, popular: [] }));
      return s;
    };
    const sampleTickers = new Set(loadSamples().map((e) => e.ticker));
    for (const e of [...source, ...loadSamples()]) {
      const sample = sampleTickers.has(e.ticker);
      // Frozen markets may have expired since; keep them so the demo can still be explored.
      if (frozenAt === null && !sample && new Date(e.expiryDate).getTime() < Date.now() + CLOSE_BUFFER_MS) continue;
      const r = tryNormalize(e, { categoricalAllowlist: allowlist() });
      const vol = Number(e.volume ?? 0) || 0;
      const vol24 = Number(e.volume24h ?? 0) || 0;
      if (!sample) {
        const st = section(e.category);
        st.events++;
        st.volume += vol;
        st.volume24h += vol24;
        if ("ladder" in r) st.tradable++;
        else if (vol > 0) st.popular.push({ ticker: e.ticker, title: e.title, volume24h: vol24, volume: vol, reason: plainReason(r.reason) });
      }
      if (!("ladder" in r)) {
        rejected++;
        continue;
      }
      const l = r.ladder;
      // Samples are never written into the saved Gemini snapshot or the live event cache.
      if (!sample) {
        tradable.push(e);
        // Never let frozen data overwrite a fresher live event we already hold.
        const held = this.events.get(e.ticker);
        if (frozenAt === null || !held?.event || held.frozen) this.events.set(e.ticker, { at: frozenAt ?? Date.now(), event: e, frozen: frozenAt !== null });
      }
      let readout: MarketSummary["readout"] = { center: null, spread: null, leader: null, leaderProb: null };
      let teaser: MarketSummary["teaser"] = null;
      try {
        if (l.cuts) {
          const mm = marketMoments(l);
          const r = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v) : Math.round(v * 100) / 100);
          readout = { center: formatValue(r(mm.mean), l.unit), spread: formatValue(r(mm.sd), l.unit), leader: null, leaderProb: null };
          const belief = fromMarket(l, 0, 0.6);
          const q = compile({ ladder: l, belief, confidence: 0.5, stakeUsd: 100, maxIter: 8_000 });
          teaser = { belief, worst: q.minPayout, best: q.maxPayout, probProfitYou: q.probProfitBelief, payouts: q.payoutByBucket, trade: q.advice === "trade" };
        } else {
          const order = l.marketProb.map((p, i) => [p, i] as const).sort((a, b) => b[0] - a[0]);
          const j = order[0][1];
          readout = { center: null, spread: null, leader: l.bucketLabels[j], leaderProb: l.marketProb[j] };
          // Example view: the runner-up is underrated by 10 points; everyone else scales down.
          const k = order[1][1];
          const boost = 0.1;
          const belief = l.marketProb.map((p, i) => (i === k ? p + boost : p * (1 - (p === 1 ? 0 : boost / (1 - l.marketProb[k])))));
          const sum = belief.reduce((a, b) => a + b, 0);
          const b = belief.map((x) => Math.max(1e-4, x / sum));
          const q = compile({ ladder: l, belief: b, confidence: 1, stakeUsd: 100, maxIter: 8_000 });
          teaser = {
            belief: b,
            worst: q.minPayout,
            best: q.maxPayout,
            probProfitYou: q.probProfitBelief,
            payouts: q.payoutByBucket,
            trade: q.advice === "trade",
            focus: { label: l.bucketLabels[k], marketProb: l.marketProb[k], yourProb: b[k], paysIfWins: q.payoutByBucket[k] },
          };
        }
      } catch {
        // teaser is optional
      }
      markets.push({
        readout,
        teaser,
        bucketLabels: l.bucketLabels,
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
        volume24h: e.volume24h !== undefined && e.volume24h !== null ? Number(e.volume24h) || 0 : null,
        marketProb: l.marketProb,
        cutLabels: l.cutLabels,
        ...(sample ? { sample: true } : {}),
      });
    }
    markets.sort((a, b) => a.category.localeCompare(b.category) || a.expiry.localeCompare(b.expiry) || a.title.localeCompare(b.title));
    // Sections by how much each traded in the last 24 hours (lifetime volume breaks ties); each keeps
    // its few most active untradable markets.
    const busier = (a: { volume24h: number; volume: number }, b: { volume24h: number; volume: number }) => b.volume24h - a.volume24h || b.volume - a.volume;
    const sections = [...stats.values()]
      .filter((s) => s.events > 0)
      .map((s) => ({ ...s, volume: Math.round(s.volume), volume24h: Math.round(s.volume24h), popular: s.popular.sort(busier).slice(0, 4) }))
      .sort(busier);
    this.list = { at: Date.now(), markets, rejected, frozenAt, sections };
    // Live and healthy: refresh the desk's own frozen copy every few minutes.
    if (frozenAt === null && tradable.length && Date.now() - this.lastSnapshotAt > SNAPSHOT_EVERY_MS) {
      try {
        saveSnapshot(tradable);
        this.lastSnapshotAt = Date.now();
      } catch (err) {
        console.warn("[snapshot] save failed:", (err as Error).message);
      }
    }
  }

  /** Stale-while-revalidate list of tradable ladders (refreshes every 2 min: it reads every category). */
  async listMarkets(): Promise<{ markets: MarketSummary[]; rejected: number; updatedAt: number; frozenAt: number | null; sections: CategorySection[] }> {
    const stale = !this.list || Date.now() - this.list.at > 120_000;
    if (stale && !this.listPromise) {
      this.listPromise = this.refreshList().finally(() => (this.listPromise = null));
    }
    if (!this.list) await this.listPromise;
    return { markets: this.list!.markets, rejected: this.list!.rejected, updatedAt: this.list!.at, frozenAt: this.list!.frozenAt, sections: this.list!.sections };
  }

  /** A market's event from the frozen copy, for when Gemini can't serve it live. */
  private frozenEvent(ticker: string): { at: number; event: RawEvent } | null {
    const snap = loadSnapshot();
    const event = snap?.events.find((e) => e.ticker === ticker);
    return snap && event ? { at: snap.capturedAt, event } : null;
  }

  async getEvent(ticker: string, maxAgeMs = 5_000): Promise<RawEvent> {
    // Sample markets are local, made-up data: never ask Gemini for them.
    const sample = loadSamples().find((e) => e.ticker === ticker);
    if (sample) return sample;
    const hit = this.events.get(ticker);
    if (hit && !hit.frozen && Date.now() - hit.at < maxAgeMs) return hit.event;
    if (hit?.promise) return hit.promise;
    const promise = this.client.getEvent(ticker);
    this.events.set(ticker, { at: hit?.at ?? 0, event: hit?.event as RawEvent, frozen: hit?.frozen, promise });
    try {
      const event = await promise;
      this.events.set(ticker, { at: Date.now(), event });
      return event;
    } catch (err) {
      // Gemini can't serve it: fall back to the frozen copy so the demo stays explorable.
      const frozen = hit?.frozen ? { at: hit.at, event: hit.event } : this.frozenEvent(ticker);
      if (frozen) {
        this.events.set(ticker, { ...frozen, frozen: true });
        return frozen.event;
      }
      if (hit?.event) this.events.set(ticker, { at: hit.at, event: hit.event });
      else this.events.delete(ticker);
      throw err;
    }
  }

  async getLadder(
    ticker: string,
    maxAgeMs = 5_000,
  ): Promise<{ ladder: Ladder; event: RawEvent; capturedAt: string; frozen: boolean; sample: boolean }> {
    const event = await this.getEvent(ticker, maxAgeMs);
    const r = tryNormalize(event, { categoricalAllowlist: allowlist() });
    if (!("ladder" in r)) throw Object.assign(new Error(`Ladder not tradable: ${r.reason}`), { statusCode: 422 });
    const sample = isSampleTicker(ticker);
    const held = sample ? undefined : this.events.get(ticker);
    const at = held?.at ?? Date.now();
    return { ladder: r.ladder, event, capturedAt: new Date(at).toISOString(), frozen: !!held?.frozen, sample };
  }

  private spots = new Map<string, { at: number; value: LiveView["spot"]; promise?: Promise<LiveView["spot"]> }>();

  /** Gemini spot pair for a crypto ladder ("BTC2611182200" → "btcusd"); null when there is no spot market. */
  static spotPair(e: Pick<RawEvent, "ticker" | "category">): string | null {
    if (e.category?.toLowerCase() !== "crypto") return null;
    const m = /^([A-Z]+?)(?:\d{2}M)?\d{10}$/.exec(e.ticker);
    return m ? `${m[1].toLowerCase()}usd` : null;
  }

  /** The underlying's spot price, cached briefly and shared by every viewer. Null when Gemini has no such pair. */
  private async spot(pair: string, maxAgeMs: number): Promise<LiveView["spot"]> {
    const hit = this.spots.get(pair);
    if (hit && Date.now() - hit.at < (hit.value ? maxAgeMs : 60_000)) return hit.value;
    if (hit?.promise) return hit.promise;
    const promise = this.client
      .getTicker(pair)
      .then((t) => {
        const price = Number(t.close);
        const open = Number(t.open);
        const bid = Number(t.bid);
        const ask = Number(t.ask);
        if (!(price > 0)) return null;
        return { pair, price, open24h: open > 0 ? open : null, bid: bid > 0 ? bid : null, ask: ask > 0 ? ask : null };
      })
      .catch((err) => {
        console.warn(`[spot] ${pair}:`, (err as Error).message);
        return hit?.value ?? null;
      });
    this.spots.set(pair, { at: hit?.at ?? 0, value: hit?.value ?? null, promise });
    const value = await promise;
    this.spots.set(pair, { at: Date.now(), value });
    return value;
  }

  /**
   * The fast-moving numbers for a market page: the underlying's spot price and every contract's
   * current asks. Cheap to serve every few seconds; the full ladder and quote refresh far less often.
   */
  async live(ticker: string, maxAgeMs = 2_500): Promise<LiveView> {
    const sample = isSampleTicker(ticker);
    const event = await this.getEvent(ticker, maxAgeMs);
    const held = sample ? undefined : this.events.get(ticker);
    const frozen = !!held?.frozen;
    const pair = sample || frozen ? null : MarketService.spotPair(event);
    const num = (v: string | null | undefined) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    return {
      at: held?.at ?? Date.now(),
      frozen,
      sample,
      spot: pair ? await this.spot(pair, maxAgeMs) : null,
      asks: event.contracts.map((c) => ({ symbol: c.instrumentSymbol, yesAsk: num(c.prices?.buy?.yes), noAsk: num(c.prices?.buy?.no) })),
    };
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
  /** Holding strategies: floor (protect), floor + cap (collar), cap only (covered call). stakeUsd is then the computed cost. */
  protect?: { units: number; floor?: number; cap?: number };
  /** Call/put spread built from equal steps between two strikes, sized to stakeUsd. */
  spread?: { direction: "up" | "down"; from: number; to: number };
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
    protect?: { units: number; floor?: number; cap?: number };
    spread?: { direction: "up" | "down"; from: number; to: number };
  };
  quote: Omit<Quote, "raw"> & { iterations: number };
  marketProb: number[];
  bucketLabels: string[];
  crossedStrikes: string[];
}

/** Compile, size against the book, persist and hash a quote. */
export async function makeQuote(markets: MarketService, db: DB, req: QuoteRequest, opts: { withDepth?: boolean } = {}): Promise<StoredQuote> {
  const { ladder, capturedAt, frozen, sample } = await markets.getLadder(req.ticker);
  // Sample markets have made-up prices: never quote them, so nothing can be signed against them.
  if (sample) {
    throw Object.assign(new Error("This is a sample market with made-up prices, so it can't be traded. The preview still works."), { statusCode: 403 });
  }
  // Frozen prices are for exploring only: never lock a payout schedule against them.
  if (frozen) {
    throw Object.assign(new Error("Prices are frozen while Gemini is offline, so positions can't be opened. The preview still works."), { statusCode: 503 });
  }
  const left = new Date(ladder.expiry).getTime() - Date.now();
  if (left < CLOSE_BUFFER_MS) {
    throw Object.assign(new Error(left > 0 ? "This market settles in a few minutes, so it's closed for new positions." : "This market has settled."), { statusCode: 409 });
  }
  if (req.belief.length !== ladder.marketProb.length) {
    throw Object.assign(new Error(`belief must have ${ladder.marketProb.length} buckets`), { statusCode: 400 });
  }
  let quote: Quote;
  const direct = !!(req.protect || req.spread); // built straight from contracts: no view, no solver
  if (direct && ladder.kind !== "threshold") throw Object.assign(new Error("This strategy is only available on price ladders."), { statusCode: 400 });
  if (req.protect) {
    // Floor / collar / covered call, priced directly from NO asks.
    quote = protect({ ladder, units: req.protect.units, floor: req.protect.floor ?? null, cap: req.protect.cap });
    if (!quote.legs.length) throw Object.assign(new Error("Nothing can be built at those prices."), { statusCode: 422 });
  } else if (req.spread) {
    // Call/put spread: equal steps between two strikes, sized to the stake.
    quote = spread({ ladder, direction: req.spread.direction, from: req.spread.from, to: req.spread.to, stakeUsd: req.stakeUsd });
    if (!quote.legs.length) throw Object.assign(new Error("The amount is too small for one contract per step."), { statusCode: 422 });
  } else {
    quote = compile({ ladder, belief: req.belief, confidence: req.confidence, stakeUsd: req.stakeUsd });
    if (opts.withDepth !== false && quote.legs.length > 0) {
      const depth = await markets.depthFor(ladder, [...new Set(quote.legs.map((l) => l.instrumentIndex))]);
      quote = compile({ ladder, belief: req.belief, confidence: req.confidence, stakeUsd: req.stakeUsd, depth, warmStart: quote.raw.weights });
    }
  }
  const quoteId = randomUUID();
  // Strategies built straight from contracts record their settings in the hashed preimage and carry
  // no view (belief = market). Absent keys are skipped by the canonical hash.
  const preimage = {
    ticker: ladder.eventTicker,
    marketProb: ladder.marketProb,
    belief: direct ? ladder.marketProb : req.belief,
    confidence: direct ? 0 : req.confidence,
    quoteId,
    capturedAt,
    ...(req.protect ? { protect: { units: req.protect.units, floor: req.protect.floor, cap: req.protect.cap } } : {}),
    ...(req.spread ? { spread: { direction: req.spread.direction, from: req.spread.from, to: req.spread.to } } : {}),
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
