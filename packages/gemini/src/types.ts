/** Raw shapes returned by the Gemini Prediction Markets public API (verified Nov 17, 2026). */
export type RawStrike =
  | { type: "above" | "below" | "over" | "spread" | "reference" | string; value: string; availableAt?: string }
  | null;

export interface RawPrices {
  buy?: { yes?: string; no?: string };
  sell?: { yes?: string; no?: string };
  bestBid?: string | null;
  bestAsk?: string | null;
  lastTradePrice?: string | null;
}

export interface RawContract {
  id: string;
  label: string;
  ticker: string;
  instrumentSymbol: string;
  status: string; // active | settled | ...
  marketState?: string;
  expiryDate: string;
  strike: RawStrike;
  prices?: RawPrices;
  priceIncrement?: string;
  quantityMinimum?: string;
  quantityIncrement?: string;
  resolutionSide?: "yes" | "no";
  settlementValue?: string;
  resolvedAt?: string;
  abbreviatedName?: string;
  sortOrder?: number;
}

export interface RawEvent {
  id: string;
  title: string;
  ticker: string;
  type: "binary" | "categorical" | string;
  category: string;
  status: string; // active | settled | closed ...
  expiryDate: string;
  volume?: string;
  /** Traded in the last 24 hours (Gemini sends a number). */
  volume24h?: string | number;
  template?: string | null;
  series?: string;
  sourceDetails?: { agency?: string; index?: string } | null;
  subcategory?: { name?: string; path?: string[] } | null;
  settlement?: { value?: string } | null;
  resolvedAt?: string;
  contracts: RawContract[];
}

export interface EventsPage {
  data: RawEvent[];
  pagination: { limit: number; offset: number; total: number };
}

export interface BookLevel { price: string; amount: string; timestamp?: string }
export interface RawBook { bids: BookLevel[]; asks: BookLevel[] }
