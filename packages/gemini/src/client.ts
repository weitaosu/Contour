import { TokenBucket } from "./limiter";
import type { EventsPage, RawBook, RawEvent } from "./types";

export const GEMINI_API_BASE = "https://api.gemini.com";

export interface ListEventsParams {
  status?: "active" | "settled" | string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export class GeminiPublicClient {
  private limiter: TokenBucket;
  constructor(
    private base: string = GEMINI_API_BASE,
    opts: { ratePerSec?: number; burst?: number; fetchImpl?: typeof fetch } = {},
  ) {
    // Gemini documents ~120 req/min for public endpoints; budget 1 req/s with a small burst.
    this.limiter = new TokenBucket(opts.ratePerSec ?? 1, opts.burst ?? 8);
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }
  private fetchImpl: typeof fetch;

  private async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(path, this.base);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      await this.limiter.take();
      const res = await this.fetchImpl(url, { headers: { accept: "application/json" } });
      if (res.status === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`Gemini ${res.status} ${url.pathname}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as T;
    }
  }

  listEvents(params: ListEventsParams = {}): Promise<EventsPage> {
    return this.get<EventsPage>("/v1/prediction-markets/events", { ...params });
  }

  /** Pages through all events matching the filter. */
  async listAllEvents(params: Omit<ListEventsParams, "offset" | "limit"> = {}, pageSize = 100, maxPages = 20): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    for (let page = 0; page < maxPages; page++) {
      const res = await this.listEvents({ ...params, limit: pageSize, offset: page * pageSize });
      out.push(...res.data);
      if (res.data.length < pageSize || out.length >= res.pagination.total) break;
    }
    return out;
  }

  getEvent(ticker: string): Promise<RawEvent> {
    return this.get<RawEvent>(`/v1/prediction-markets/events/${encodeURIComponent(ticker)}`);
  }

  getCategories(): Promise<{ categories: string[] }> {
    return this.get("/v1/prediction-markets/categories");
  }

  /** Order book for one instrument. YES asks are `asks`; a NO ask at price p equals a YES bid at 1-p. */
  getBook(instrumentSymbol: string, depth = 5): Promise<RawBook> {
    return this.get<RawBook>(`/v1/book/${encodeURIComponent(instrumentSymbol)}`, { limit_bids: depth, limit_asks: depth });
  }
}

/** Remove bulky fields (rich-text descriptions, images) before storing snapshots. */
export function slimEvent(e: RawEvent): RawEvent {
  return {
    id: e.id,
    title: e.title,
    ticker: e.ticker,
    type: e.type,
    category: e.category,
    status: e.status,
    expiryDate: e.expiryDate,
    volume: e.volume,
    template: e.template ?? null,
    series: e.series,
    sourceDetails: e.sourceDetails ?? null,
    subcategory: e.subcategory ? { name: e.subcategory.name, path: e.subcategory.path } : null,
    settlement: e.settlement ?? null,
    resolvedAt: e.resolvedAt,
    contracts: e.contracts.map((c) => ({
      id: c.id,
      label: c.label,
      ticker: c.ticker,
      instrumentSymbol: c.instrumentSymbol,
      status: c.status,
      marketState: c.marketState,
      expiryDate: c.expiryDate,
      strike: c.strike,
      prices: c.prices,
      priceIncrement: c.priceIncrement,
      quantityMinimum: c.quantityMinimum,
      quantityIncrement: c.quantityIncrement,
      resolutionSide: c.resolutionSide,
      settlementValue: c.settlementValue,
      resolvedAt: c.resolvedAt,
    })),
  };
}
