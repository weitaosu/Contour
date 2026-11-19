import { randomUUID } from "node:crypto";
import { escrowTerms, paysIn, tradingFeeUsd, GEMINI_TAKER_FEE_RATE, type Ladder } from "@contour/core";
import type { RawContract, RawEvent } from "@contour/gemini";
import type { DB } from "./db";
import { CLOSE_BUFFER_MS, type StoredQuote } from "./markets";

/**
 * Paper trading: positions that fill at Gemini's live prices and are valued, bought, sold and
 * settled like real ones, with paper cash and no wallet. A browser gets an account the first time it
 * asks for one. Money is kept in USDC base units (6 decimals) as integers.
 *
 * Valuation follows Kalshi: a position is worth what selling it now would fetch, at the bids, after
 * estimated sell fees, which is not a guaranteed cash-out amount. Its "if it settles" payout per outcome
 * comes from the contracts held.
 */

export const PAPER_START_BASE = 10_000 * 1e6;
/** A fill may cost at most this much more per contract than the quote the user reviewed (price protection). */
export const MAX_SLIPPAGE = 0.01;
/** A sale may fetch at most this share less than the preview the user saw. */
export const SELL_TOLERANCE = 0.01;
/** Value history: at most one point per position (and per account) this often. */
const MARK_EVERY_MS = 60_000;

const base = (usd: number) => Math.round(usd * 1e6);
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

/** What the paper engine needs from the market service (an interface so tests can stub it). */
export interface PaperMarkets {
  getEvent(ticker: string, maxAgeMs?: number): Promise<RawEvent>;
  getLadder(ticker: string): Promise<{ ladder: Ladder; frozen: boolean; sample: boolean }>;
  isFrozen?(ticker: string): boolean;
}

export type Strategy = "view" | "near" | "spread" | "protect";

export interface PaperRequest {
  belief: number[];
  confidence: number;
  protect?: { units: number; floor?: number; cap?: number };
  spread?: { direction: "up" | "down"; from: number; to: number };
  shape?: "range";
}

export interface LadderInfo {
  kind: Ladder["kind"];
  bucketLabels: string[];
  cutLabels: string[];
  cuts: number[] | null;
  unit: Ladder["unit"];
  /** Contract symbols in ladder order, to work out which outcome won at settlement. */
  symbols: string[];
  /** Per contract: its YES pays at or below the strike ("Before …"). Absent on positions opened before these ladders. */
  below?: boolean[];
  /** The extra "none of the listed" outcome, last in bucketLabels, won when every contract resolves NO. */
  none?: string;
  /** The market's odds when the position was opened. */
  marketProb: number[];
}

interface PositionRow {
  id: string;
  account: string;
  ticker: string;
  title: string;
  category: string | null;
  strategy: Strategy;
  view_label: string | null;
  request_json: string;
  ladder_json: string;
  expiry: string;
  status: "open" | "closed" | "settled";
  cash_base: number;
  cost_base: number;
  realized_base: number;
  payout_base: number | null;
  outcome_bucket: number | null;
  outcome_label: string | null;
  opened_at: number;
  updated_at: number;
  closed_at: number | null;
  /** 1 for a demo position on a made-up past market (its trades are sample data). */
  demo: number;
}

interface LegRow {
  position: string;
  symbol: string;
  side: "yes" | "no";
  label: string;
  strike: number | null;
  qty: number;
  cost_base: number;
  fee_base: number;
  pays_json: string;
  /** Worth at the mark when filled (null on legs filled before it was recorded: treated as cost). */
  entry_mark_base: number | null;
}

interface TradeRow {
  id: number;
  account: string;
  position: string;
  kind: "open" | "add" | "sell" | "settle";
  quote_id: string | null;
  cash_base: number;
  realized_base: number;
  detail_json: string;
  created_at: number;
}

export interface FillDetail {
  symbol: string;
  side: "yes" | "no";
  label: string;
  qty: number;
  price: number;
  feeBase: number;
}

// ---------------------------------------------------------------------------------------------
// Prices

const num = (v: string | null | undefined) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const inRange = (p: number | null) => (p !== null && p > 0 && p < 1 ? p : null);

/** What buying one contract of `side` costs right now (the ask). */
export function buyPrice(c: RawContract | undefined, side: "yes" | "no"): number | null {
  if (!c) return null;
  return inRange(num(side === "yes" ? c.prices?.buy?.yes : c.prices?.buy?.no));
}

/**
 * What selling one contract of `side` fetches right now (the bid). Gemini sends it as `sell`; failing
 * that, a YES bid mirrors a NO ask (1 − ask). Never above the same side's ask: a crossed, stale bid
 * mustn't make a position look worth more than it would cost to buy.
 */
export function sellPrice(c: RawContract | undefined, side: "yes" | "no"): number | null {
  if (!c) return null;
  const p = c.prices;
  const direct = num(side === "yes" ? p?.sell?.yes : p?.sell?.no);
  const mirror = side === "yes" ? (num(p?.buy?.no) !== null ? 1 - num(p?.buy?.no)! : num(p?.bestBid)) : num(p?.buy?.yes) !== null ? 1 - num(p?.buy?.yes)! : null;
  let bid = direct ?? mirror;
  const ask = buyPrice(c, side);
  if (bid !== null && ask !== null) bid = Math.min(bid, ask);
  return inRange(bid !== null ? Math.round(bid * 1e4) / 1e4 : null);
}

/**
 * The mark: what one contract of `side` is worth for display, the way brokerages value holdings.
 * Robinhood marks options at the midpoint of bid and ask, and uses it for current value and total
 * return; nobody headlines the bid, which would make every position look as if it lost the whole
 * spread the moment it was bought. (Polymarket switches to the last trade when the spread is wider
 * than 10¢, but Gemini's last trades are often hours stale, so the midpoint is the better price here.)
 * Selling still happens at the bid (sellPrice), shown separately as the cash-out estimate.
 */
export function markPrice(c: RawContract | undefined, side: "yes" | "no"): number | null {
  if (!c) return null;
  const bid = sellPrice(c, side);
  const ask = buyPrice(c, side);
  const lastYes = inRange(num(c.prices?.lastTradePrice));
  const last = lastYes === null ? null : side === "yes" ? lastYes : 1 - lastYes;
  const round = (p: number) => Math.round(p * 1e4) / 1e4;
  if (bid !== null && ask !== null) return round((bid + ask) / 2);
  // One side of the book only: the last trade if it's consistent with it, else that side.
  if (bid !== null) return round(last !== null ? Math.max(bid, last) : bid);
  if (ask !== null) return round(last !== null ? Math.min(ask, last) : ask);
  return last !== null ? round(last) : null;
}

const contractsBySymbol = (e: RawEvent) => new Map(e.contracts.map((c) => [c.instrumentSymbol, c]));

// ---------------------------------------------------------------------------------------------
// Accounts

export function ensureAccount(db: DB, id: string) {
  const now = Date.now();
  db.prepare("INSERT OR IGNORE INTO paper_accounts (id, cash_base, created_at, updated_at, demo_state) VALUES (?, ?, ?, ?, NULL)").run(id, PAPER_START_BASE, now, now);
  return db.prepare("SELECT * FROM paper_accounts WHERE id = ?").get(id) as {
    id: string;
    cash_base: number;
    created_at: number;
    updated_at: number;
    /** null: a demo portfolio is due; "seeding" | "seeded" | "empty" | "legacy" otherwise. */
    demo_state: string | null;
    demo_at: number | null;
    demo_v: number | null;
  };
}

function addCash(db: DB, account: string, delta: number) {
  db.prepare("UPDATE paper_accounts SET cash_base = cash_base + ?, updated_at = ? WHERE id = ?").run(delta, Date.now(), account);
}

/** Wipe a paper account. With `demo`, it gets a fresh demo portfolio on its next load; without, it starts empty. */
export function resetAccount(db: DB, id: string, demo = true) {
  db.transaction(() => {
    const ids = (db.prepare("SELECT id FROM paper_positions WHERE account = ?").all(id) as { id: string }[]).map((r) => r.id);
    for (const p of ids) {
      db.prepare("DELETE FROM paper_legs WHERE position = ?").run(p);
      db.prepare("DELETE FROM paper_marks WHERE owner = ?").run(p);
    }
    db.prepare("DELETE FROM paper_positions WHERE account = ?").run(id);
    db.prepare("DELETE FROM paper_trades WHERE account = ?").run(id);
    db.prepare("DELETE FROM paper_marks WHERE owner = ?").run(`acct:${id}`);
    db.prepare("DELETE FROM paper_accounts WHERE id = ?").run(id);
  })();
  const acct = ensureAccount(db, id);
  if (!demo) db.prepare("UPDATE paper_accounts SET demo_state = 'empty' WHERE id = ?").run(id);
  return acct;
}

// ---------------------------------------------------------------------------------------------
// Filling a quote (open, or buy more)

function loadQuote(db: DB, quoteId: string): StoredQuote {
  const row = db.prepare("SELECT quote_json FROM quotes WHERE id = ?").get(quoteId) as { quote_json: string } | undefined;
  if (!row) throw fail(404, "That quote doesn't exist. Review the trade again.");
  return JSON.parse(row.quote_json) as StoredQuote;
}

/**
 * Fill a reviewed quote at the live asks. Each contract fills at today's ask as long as it's no more
 * than MAX_SLIPPAGE above the price the user reviewed; otherwise the whole order is refused so the
 * user can review it at the new prices. Returns the fills and what they cost.
 */
async function fillQuote(markets: PaperMarkets, q: StoredQuote) {
  // Fills use the live asks with price protection (below), so a quote a minute old is still safe to fill.
  if (Date.now() > q.validUntil + 90_000) throw fail(409, "This quote has expired. Review the trade again for today's prices.");
  const left = new Date(q.expiryTs * 1000).getTime() - Date.now();
  if (left < CLOSE_BUFFER_MS) throw fail(409, "This market settles in a few minutes, so it's closed for new positions.");
  if (!q.quote.legs.length) throw fail(409, "There's nothing to buy at this view: no contract is worth its price.");
  const { ladder, frozen, sample } = await markets.getLadder(q.ticker);
  if (sample) throw fail(403, "This is a sample market with made-up prices, so it can't be traded.");
  if (frozen) throw fail(503, "Prices are frozen while Gemini is offline, so trades can't fill right now.");
  const event = await markets.getEvent(q.ticker, 3_000);
  const bySym = contractsBySymbol(event);
  const feeRate = q.quote.feeRate ?? GEMINI_TAKER_FEE_RATE;
  const fills: (FillDetail & { costBase: number; entryBase: number; strike: number | null; pays: number[] })[] = [];
  for (const leg of q.quote.legs) {
    const contract = bySym.get(leg.symbol);
    const ask = buyPrice(contract, leg.side);
    if (ask === null) throw fail(409, `"${leg.label}" ${leg.side.toUpperCase()} has no ask right now. Review the trade again.`);
    if (ask > leg.price + MAX_SLIPPAGE + 1e-9)
      throw fail(409, `Prices moved since your quote ("${leg.label}" ${leg.side.toUpperCase()} is ${Math.round(ask * 100)}¢, was ${Math.round(leg.price * 100)}¢). Review the trade again.`);
    const idx = ladder.instruments[leg.instrumentIndex]?.symbol === leg.symbol ? leg.instrumentIndex : ladder.instruments.findIndex((i) => i.symbol === leg.symbol);
    if (idx < 0) throw fail(409, "The market's contracts changed. Review the trade again.");
    const pays = ladder.marketProb.map((_, j) => (paysIn(ladder, idx, leg.side, j) ? 1 : 0));
    fills.push({ symbol: leg.symbol, side: leg.side, label: leg.label, strike: leg.strike, qty: leg.qty, price: ask, costBase: base(leg.qty * ask), entryBase: base(leg.qty * (markPrice(contract, leg.side) ?? ask)), feeBase: base(tradingFeeUsd(leg.qty, ask, feeRate)), pays });
  }
  // Cash the quote keeps inside the position (usually none: it stays in the account; see escrowTerms).
  const terms = escrowTerms(q.quote);
  const quotedContracts = q.quote.legs.reduce((s, l) => s + base(l.usd) + base(l.fee), 0);
  const cashBase = Math.max(0, terms.stakeBase - quotedContracts);
  const payBase = fills.reduce((s, f) => s + f.costBase + f.feeBase, 0) + cashBase;
  const info: LadderInfo = {
    kind: ladder.kind,
    bucketLabels: ladder.bucketLabels,
    cutLabels: ladder.cutLabels,
    cuts: ladder.cuts,
    unit: ladder.unit,
    symbols: ladder.instruments.map((i) => i.symbol),
    ...(ladder.instruments.some((i) => i.below) ? { below: ladder.instruments.map((i) => i.below === true) } : {}),
    ...(ladder.none ? { none: ladder.none } : {}),
    marketProb: ladder.marketProb,
  };
  return { fills, cashBase, payBase, ladder: info, category: ladder.category, title: ladder.title, expiry: ladder.expiry };
}

function strategyOf(q: StoredQuote): Strategy {
  return q.preimage.protect ? "protect" : q.preimage.spread ? "spread" : q.preimage.shape === "range" ? "near" : "view";
}

export async function openPosition(db: DB, markets: PaperMarkets, account: string, quoteId: string, label?: string) {
  const q = loadQuote(db, quoteId);
  const f = await fillQuote(markets, q);
  const id = randomUUID();
  const now = Date.now();
  db.transaction(() => {
    const acct = ensureAccount(db, account);
    if (db.prepare("SELECT 1 FROM paper_trades WHERE quote_id = ?").get(quoteId)) throw fail(409, "This quote has already been filled.");
    if (acct.cash_base < f.payBase) throw fail(402, `Not enough paper cash: this costs $${(f.payBase / 1e6).toFixed(2)} and you have $${(acct.cash_base / 1e6).toFixed(2)}.`);
    const request: PaperRequest = {
      belief: q.preimage.belief,
      confidence: q.preimage.confidence,
      ...(q.preimage.protect ? { protect: q.preimage.protect } : {}),
      ...(q.preimage.spread ? { spread: q.preimage.spread } : {}),
      ...(q.preimage.shape ? { shape: q.preimage.shape } : {}),
    };
    db.prepare(
      `INSERT INTO paper_positions (id, account, ticker, title, category, strategy, view_label, request_json, ladder_json, expiry, status, cash_base, cost_base, realized_base, opened_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 0, ?, ?)`,
    ).run(id, account, q.ticker, f.title, f.category, strategyOf(q), label?.slice(0, 160) ?? null, JSON.stringify(request), JSON.stringify(f.ladder), f.expiry, f.cashBase, f.payBase, now, now);
    const ins = db.prepare("INSERT INTO paper_legs (position, symbol, side, label, strike, qty, cost_base, fee_base, pays_json, entry_mark_base) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const l of f.fills) ins.run(id, l.symbol, l.side, l.label, l.strike, l.qty, l.costBase, l.feeBase, JSON.stringify(l.pays), l.entryBase);
    addCash(db, account, -f.payBase);
    recordTrade(db, account, id, "open", quoteId, -f.payBase, 0, f.fills);
  })();
  await markAfterTrade(db, markets, account, id);
  return id;
}

export async function addToPosition(db: DB, markets: PaperMarkets, account: string, positionId: string, quoteId: string) {
  const pos = getRow(db, account, positionId);
  if (pos.status !== "open") throw fail(409, "This position is closed, so you can't add to it.");
  const q = loadQuote(db, quoteId);
  if (q.ticker !== pos.ticker) throw fail(400, "That quote is for a different market.");
  const f = await fillQuote(markets, q);
  db.transaction(() => {
    const acct = ensureAccount(db, account);
    if (db.prepare("SELECT 1 FROM paper_trades WHERE quote_id = ?").get(quoteId)) throw fail(409, "This quote has already been filled.");
    if (acct.cash_base < f.payBase) throw fail(402, `Not enough paper cash: this costs $${(f.payBase / 1e6).toFixed(2)} and you have $${(acct.cash_base / 1e6).toFixed(2)}.`);
    const get = db.prepare("SELECT * FROM paper_legs WHERE position = ? AND symbol = ? AND side = ?");
    for (const l of f.fills) {
      const have = get.get(positionId, l.symbol, l.side) as LegRow | undefined;
      if (have)
        db.prepare("UPDATE paper_legs SET qty = ?, cost_base = ?, fee_base = ?, entry_mark_base = ? WHERE position = ? AND symbol = ? AND side = ?").run(
          Math.round((have.qty + l.qty) * 1e6) / 1e6,
          have.cost_base + l.costBase,
          have.fee_base + l.feeBase,
          (have.entry_mark_base ?? have.cost_base) + l.entryBase,
          positionId,
          l.symbol,
          l.side,
        );
      else
        db.prepare("INSERT INTO paper_legs (position, symbol, side, label, strike, qty, cost_base, fee_base, pays_json, entry_mark_base) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
          positionId,
          l.symbol,
          l.side,
          l.label,
          l.strike,
          l.qty,
          l.costBase,
          l.feeBase,
          JSON.stringify(l.pays),
          l.entryBase,
        );
    }
    db.prepare("UPDATE paper_positions SET cash_base = cash_base + ?, cost_base = cost_base + ?, updated_at = ? WHERE id = ?").run(f.cashBase, f.payBase, Date.now(), positionId);
    addCash(db, account, -f.payBase);
    recordTrade(db, account, positionId, "add", quoteId, -f.payBase, 0, f.fills);
  })();
  await markAfterTrade(db, markets, account, positionId);
}

// ---------------------------------------------------------------------------------------------
// Selling

/** Contracts sold for a fraction of a leg: everything when selling it all, else rounded down to 0.01. */
export const sellQty = (qty: number, fraction: number) => (fraction >= 0.999 ? qty : Math.floor(qty * fraction * 100 + 1e-9) / 100);

export interface SalePlan {
  fraction: number;
  proceedsBase: number;
  feeBase: number;
  costSoldBase: number;
  cashOutBase: number;
  fills: FillDetail[];
  /** Legs with nothing to sell into (no bid right now). */
  unpriced: string[];
}

/** What selling `fraction` of a position would fetch at these prices (no side effects). */
export function planSale(pos: Pick<PositionRow, "cash_base" | "cost_base">, legs: LegRow[], event: RawEvent, fraction: number): SalePlan {
  const bySym = contractsBySymbol(event);
  const fills: FillDetail[] = [];
  const unpriced: string[] = [];
  let proceeds = 0;
  let fees = 0;
  for (const l of legs) {
    const q = sellQty(l.qty, fraction);
    if (q <= 0) continue;
    const bid = sellPrice(bySym.get(l.symbol), l.side);
    if (bid === null) {
      unpriced.push(`${l.label} ${l.side.toUpperCase()}`);
      continue;
    }
    const fee = base(tradingFeeUsd(q, bid));
    proceeds += base(q * bid) - fee;
    fees += fee;
    fills.push({ symbol: l.symbol, side: l.side, label: l.label, qty: q, price: bid, feeBase: fee });
  }
  const all = fraction >= 0.999;
  const cashOut = all ? pos.cash_base : Math.round(pos.cash_base * fraction);
  return { fraction, proceedsBase: proceeds + cashOut, feeBase: fees, costSoldBase: all ? pos.cost_base : Math.round(pos.cost_base * fraction), cashOutBase: cashOut, fills, unpriced };
}

export async function sellPosition(db: DB, markets: PaperMarkets, account: string, positionId: string, fraction: number, minProceedsUsd?: number) {
  if (!(fraction > 0 && fraction <= 1)) throw fail(400, "Sell between 1% and 100% of a position.");
  const pos = getRow(db, account, positionId);
  if (pos.status !== "open") throw fail(409, "This position is already closed.");
  if (new Date(pos.expiry).getTime() <= Date.now()) throw fail(409, "This market has closed; the position will settle on its outcome.");
  if (markets.isFrozen?.(pos.ticker)) throw fail(503, "Prices are frozen while Gemini is offline, so sales can't fill right now.");
  const event = await markets.getEvent(pos.ticker, 3_000);
  const legs = getLegs(db, positionId);
  const plan = planSale(pos, legs, event, fraction);
  if (plan.unpriced.length) throw fail(409, `Nobody is bidding on ${plan.unpriced.join(", ")} right now, so it can't be sold. Try again shortly.`);
  if (minProceedsUsd !== undefined && plan.proceedsBase < base(minProceedsUsd) * (1 - SELL_TOLERANCE) - 10_000)
    throw fail(409, `Prices moved: this now fetches $${(plan.proceedsBase / 1e6).toFixed(2)}, not $${minProceedsUsd.toFixed(2)}. Check the new amount and sell again.`);
  const realized = plan.proceedsBase - plan.costSoldBase;
  const all = fraction >= 0.999;
  db.transaction(() => {
    for (const l of legs) {
      const q = sellQty(l.qty, fraction);
      if (all || q >= l.qty - 1e-9) {
        db.prepare("DELETE FROM paper_legs WHERE position = ? AND symbol = ? AND side = ?").run(positionId, l.symbol, l.side);
        continue;
      }
      const keep = (l.qty - q) / l.qty;
      db.prepare("UPDATE paper_legs SET qty = ?, cost_base = ?, fee_base = ?, entry_mark_base = ? WHERE position = ? AND symbol = ? AND side = ?").run(
        Math.round((l.qty - q) * 1e6) / 1e6,
        Math.round(l.cost_base * keep),
        Math.round(l.fee_base * keep),
        l.entry_mark_base === null ? null : Math.round(l.entry_mark_base * keep),
        positionId,
        l.symbol,
        l.side,
      );
    }
    db.prepare(
      `UPDATE paper_positions SET cash_base = cash_base - ?, cost_base = cost_base - ?, realized_base = realized_base + ?, status = ?, updated_at = ?, closed_at = ? WHERE id = ?`,
    ).run(plan.cashOutBase, plan.costSoldBase, realized, all ? "closed" : "open", Date.now(), all ? Date.now() : null, positionId);
    addCash(db, account, plan.proceedsBase);
    recordTrade(db, account, positionId, "sell", null, plan.proceedsBase, realized, plan.fills, { fraction });
  })();
  await markAfterTrade(db, markets, account, positionId);
  return { proceedsUsd: plan.proceedsBase / 1e6, realizedUsd: realized / 1e6 };
}

// ---------------------------------------------------------------------------------------------
// Settlement

/** Gemini has published the result: every contract we can see has resolved. */
const resolved = (e: RawEvent) => e.status === "settled" || (e.contracts.length > 0 && e.contracts.every((c) => c.resolutionSide === "yes" || c.resolutionSide === "no"));

/**
 * The winning outcome: for a price ladder, how many strikes came true on the "at or above" side (a
 * "Before …" contract does when it resolves NO); else the one contract that resolved YES, or the
 * extra "none of the listed" outcome when none did.
 */
export function winningBucket(info: LadderInfo, e: RawEvent): number | null {
  const bySym = contractsBySymbol(e);
  const sides = info.symbols.map((s) => bySym.get(s)?.resolutionSide ?? null);
  if (sides.some((s) => s === null)) return null;
  if (info.kind === "threshold") return sides.filter((s, i) => (info.below?.[i] ? s === "no" : s === "yes")).length;
  const j = sides.indexOf("yes");
  if (j >= 0) return j;
  return info.none ? info.symbols.length : null;
}

function settle(db: DB, pos: PositionRow, legs: LegRow[], e: RawEvent) {
  const bySym = contractsBySymbol(e);
  let payout = pos.cash_base;
  const fills: FillDetail[] = [];
  for (const l of legs) {
    const won = bySym.get(l.symbol)?.resolutionSide === l.side;
    payout += won ? base(l.qty) : 0;
    fills.push({ symbol: l.symbol, side: l.side, label: l.label, qty: l.qty, price: won ? 1 : 0, feeBase: 0 });
  }
  const info = JSON.parse(pos.ladder_json) as LadderInfo;
  const bucket = winningBucket(info, e);
  const realized = payout - pos.cost_base;
  db.transaction(() => {
    db.prepare(
      `UPDATE paper_positions SET status = 'settled', payout_base = ?, outcome_bucket = ?, outcome_label = ?, realized_base = realized_base + ?, cost_base = 0, cash_base = 0, updated_at = ?, closed_at = ? WHERE id = ? AND status = 'open'`,
    ).run(payout, bucket, bucket !== null ? info.bucketLabels[bucket] ?? null : null, realized, Date.now(), Date.now(), pos.id);
    addCash(db, pos.account, payout);
    recordTrade(db, pos.account, pos.id, "settle", null, payout, realized, fills, { outcome: bucket !== null ? info.bucketLabels[bucket] : null });
    mark(db, pos.id, payout, true);
  })();
}

// ---------------------------------------------------------------------------------------------
// Valuation and views

function getRow(db: DB, account: string, id: string): PositionRow {
  const p = db.prepare("SELECT * FROM paper_positions WHERE id = ? AND account = ?").get(id, account) as PositionRow | undefined;
  if (!p) throw fail(404, "No such position in this account.");
  return p;
}
const getLegs = (db: DB, id: string) => db.prepare("SELECT * FROM paper_legs WHERE position = ? ORDER BY strike, symbol, side").all(id) as LegRow[];

function recordTrade(db: DB, account: string, position: string, kind: TradeRow["kind"], quoteId: string | null, cashBase: number, realizedBase: number, fills: FillDetail[], extra: Record<string, unknown> = {}) {
  db.prepare("INSERT INTO paper_trades (account, position, kind, quote_id, cash_base, realized_base, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    account,
    position,
    kind,
    quoteId,
    cashBase,
    realizedBase,
    JSON.stringify({ fills: fills.map(({ symbol, side, label, qty, price, feeBase }) => ({ symbol, side, label, qty, price, feeBase })), ...extra }),
    Date.now(),
  );
}

function mark(db: DB, owner: string, valueBase: number, force = false) {
  const last = db.prepare("SELECT at FROM paper_marks WHERE owner = ? ORDER BY at DESC LIMIT 1").get(owner) as { at: number } | undefined;
  const now = Date.now();
  if (!force && last && now - last.at < MARK_EVERY_MS) return;
  db.prepare("INSERT OR REPLACE INTO paper_marks (owner, at, value_base) VALUES (?, ?, ?)").run(owner, now, valueBase);
}

async function markAfterTrade(db: DB, markets: PaperMarkets, account: string, positionId: string) {
  try {
    const v = await positionDetail(db, markets, account, positionId);
    mark(db, positionId, Math.round(v.valueUsd * 1e6), true);
    const p = await portfolio(db, markets, account, { record: false });
    mark(db, `acct:${account}`, Math.round(p.totals.totalUsd * 1e6), true);
  } catch {
    // marks are best-effort
  }
}

export interface LegView {
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
  /** The mark per contract (see markPrice). */
  mark: number | null;
  /** Worth at the mark: what it's shown as, like a brokerage's market value. */
  valueUsd: number | null;
  /** What selling this leg now would actually fetch: at the bid, after the sell fee. */
  cashOutUsd: number | null;
  /** valueUsd minus what it cost, fees included. */
  pnlUsd: number | null;
  pays: number[];
}

export interface PositionSummary {
  id: string;
  ticker: string;
  title: string;
  category: string | null;
  strategy: Strategy;
  viewLabel: string | null;
  status: "open" | "closed" | "settled";
  /** Open but past its expiry, waiting for Gemini's result. */
  awaiting: boolean;
  expiry: string;
  openedAt: number;
  closedAt: number | null;
  costUsd: number;
  /** Market value at the mark (midpoint of bid and ask, or the last trade when the spread is wide). */
  valueUsd: number;
  /** What selling it all now would fetch: at the bids, after sell fees. Null when a contract has no bid. */
  cashOutUsd: number | null;
  /** Gemini's buy fees inside costUsd: part of what the position is down by, from the moment it's bought. */
  feesPaidUsd: number;
  /** Prices behind valueUsd: live, frozen (Gemini offline), or none (the last recorded value). */
  pricing: "live" | "frozen" | "none" | "final";
  /** valueUsd − costUsd, which is moveUsd − entryCostUsd. */
  unrealizedUsd: number;
  /**
   * The return split in two, so a fresh position isn't mistaken for one that lost value: what buying
   * cost (fees, plus paying the ask rather than the mark), and how the mark has moved since.
   */
  entryCostUsd: number;
  moveUsd: number;
  realizedUsd: number;
  /** Paid out per outcome if it settled with what's held now. */
  schedule: number[];
  payoutUsd: number | null;
  outcomeLabel: string | null;
  contracts: number;
  /** Everything bought into it (opens and adds), and everything it has paid back (sales and settlement). */
  investedUsd: number;
  returnedUsd: number;
  /** A demo position on a made-up past market. */
  demo: boolean;
  /** Closed and settled positions: how each contract ended, in short. */
  results?: { label: string; side: "yes" | "no"; result: ContractResult["result"]; pnlUsd: number }[];
}

/** Cash in and out of one position over its life. */
function flowsOf(db: DB, id: string) {
  const r = db
    .prepare("SELECT COALESCE(SUM(CASE WHEN kind IN ('open','add') THEN -cash_base ELSE 0 END), 0) AS invested, COALESCE(SUM(CASE WHEN kind IN ('sell','settle') THEN cash_base ELSE 0 END), 0) AS returned FROM paper_trades WHERE position = ?")
    .get(id) as { invested: number; returned: number };
  return { investedUsd: r.invested / 1e6, returnedUsd: r.returned / 1e6 };
}

function summarize(
  pos: PositionRow,
  legs: LegRow[],
  event: RawEvent | null,
  pricing: PositionSummary["pricing"],
  lastMark: number | null,
  flows: { investedUsd: number; returnedUsd: number },
): { summary: PositionSummary; legViews: LegView[] } {
  const info = JSON.parse(pos.ladder_json) as LadderInfo;
  const bySym = event ? contractsBySymbol(event) : new Map<string, RawContract>();
  const n = info.bucketLabels.length;
  const schedule = new Array<number>(n).fill(pos.cash_base / 1e6);
  // Two numbers, as Kalshi separates them: the value shown (at the mark) and the cash-out estimate (at the bids).
  let value = pos.cash_base;
  let cashOut: number | null = pos.cash_base;
  let priced = event !== null;
  const legViews: LegView[] = legs.map((l) => {
    const pays = JSON.parse(l.pays_json) as number[];
    pays.forEach((x, j) => (schedule[j] += x * l.qty));
    const c = bySym.get(l.symbol);
    const bid = sellPrice(c, l.side);
    const ask = buyPrice(c, l.side);
    const m = markPrice(c, l.side);
    const legValue = m !== null ? base(l.qty * m) : null;
    const legCashOut = bid !== null ? base(l.qty * bid) - base(tradingFeeUsd(l.qty, bid)) : null;
    if (legValue === null) priced = false;
    else value += legValue;
    cashOut = cashOut === null || legCashOut === null ? null : cashOut + legCashOut;
    return {
      symbol: l.symbol,
      side: l.side,
      label: l.label,
      strike: l.strike,
      qty: l.qty,
      avgPrice: l.qty > 0 ? l.cost_base / 1e6 / l.qty : 0,
      costUsd: (l.cost_base + l.fee_base) / 1e6,
      feesUsd: l.fee_base / 1e6,
      bid,
      ask,
      mark: m,
      valueUsd: legValue !== null ? legValue / 1e6 : null,
      cashOutUsd: legCashOut !== null ? legCashOut / 1e6 : null,
      pnlUsd: legValue !== null ? (legValue - l.cost_base - l.fee_base) / 1e6 : null,
      pays,
    };
  });
  const status = pos.status;
  const valueUsd = status === "settled" ? (pos.payout_base ?? 0) / 1e6 : status === "closed" ? 0 : priced ? value / 1e6 : lastMark !== null ? lastMark / 1e6 : pos.cost_base / 1e6;
  const cashOutUsd = status === "open" && priced && cashOut !== null ? cashOut / 1e6 : null;
  const feesPaidUsd = legs.reduce((s, l) => s + l.fee_base, 0) / 1e6;
  // Worth at the mark when bought: cost minus this is the entry cost; value minus this is the market move.
  const entryValueUsd = (pos.cash_base + legs.reduce((s, l) => s + (l.entry_mark_base ?? l.cost_base), 0)) / 1e6;
  return {
    legViews,
    summary: {
      id: pos.id,
      ticker: pos.ticker,
      title: pos.title,
      category: pos.category,
      strategy: pos.strategy,
      viewLabel: pos.view_label,
      status,
      awaiting: status === "open" && new Date(pos.expiry).getTime() <= Date.now(),
      expiry: pos.expiry,
      openedAt: pos.opened_at,
      closedAt: pos.closed_at,
      costUsd: pos.cost_base / 1e6,
      valueUsd,
      cashOutUsd,
      feesPaidUsd,
      pricing: status !== "open" ? "final" : priced ? pricing : "none",
      unrealizedUsd: status === "open" ? valueUsd - pos.cost_base / 1e6 : 0,
      entryCostUsd: status === "open" ? pos.cost_base / 1e6 - entryValueUsd : 0,
      moveUsd: status === "open" ? valueUsd - entryValueUsd : 0,
      realizedUsd: pos.realized_base / 1e6,
      schedule: schedule.map((x) => Math.round(x * 100) / 100),
      payoutUsd: pos.payout_base !== null ? pos.payout_base / 1e6 : null,
      outcomeLabel: pos.outcome_label,
      contracts: legs.reduce((s, l) => s + l.qty, 0),
      ...flows,
      demo: pos.demo === 1,
    },
  };
}

/** Fetch the live event for an open position, settling it first if Gemini has published the result. */
async function refresh(db: DB, markets: PaperMarkets, pos: PositionRow): Promise<{ pos: PositionRow; event: RawEvent | null; pricing: "live" | "frozen" | "none" }> {
  if (pos.status !== "open") return { pos, event: null, pricing: "none" };
  let event: RawEvent | null = null;
  try {
    event = await markets.getEvent(pos.ticker, 5_000);
  } catch {
    return { pos, event: null, pricing: "none" };
  }
  if (resolved(event)) {
    settle(db, pos, getLegs(db, pos.id), event);
    return { pos: getRow(db, pos.account, pos.id), event: null, pricing: "none" };
  }
  return { pos, event, pricing: markets.isFrozen?.(pos.ticker) ? "frozen" : "live" };
}

const lastMarkOf = (db: DB, owner: string) => (db.prepare("SELECT value_base FROM paper_marks WHERE owner = ? ORDER BY at DESC LIMIT 1").get(owner) as { value_base: number } | undefined)?.value_base ?? null;
const marksOf = (db: DB, owner: string, since = 0) =>
  (db.prepare("SELECT at, value_base FROM paper_marks WHERE owner = ? AND at >= ? ORDER BY at").all(owner, since) as { at: number; value_base: number }[]).map((m) => ({ at: m.at, valueUsd: m.value_base / 1e6 }));

export interface ContractResult {
  symbol: string;
  side: "yes" | "no";
  label: string;
  /** Contracts bought over the position's life. */
  qty: number;
  /** Average price paid per contract, before fees. */
  avgPrice: number;
  /** Everything paid for them, fees included. */
  costUsd: number;
  /** How they ended: won $1 each, lost, sold, or a mix (sold some, the rest settled). */
  result: "won" | "lost" | "sold" | "mixed" | "open";
  /** Contracts sold, and their average sale price. */
  soldQty: number;
  avgSellPrice: number | null;
  /** Contracts that settled, and whether they won. */
  settledQty: number;
  won: boolean | null;
  /** Everything they paid back: sales after fees, plus $1 for each winning contract at settlement. */
  returnedUsd: number;
  pnlUsd: number;
}

/**
 * How each contract in a position ended, from its fills: what was paid, how much was sold and for what,
 * and how the rest settled. Works for any mix of buys, partial sales and settlement.
 */
export function contractResults(db: DB, positionId: string): ContractResult[] {
  const trades = db.prepare("SELECT kind, detail_json FROM paper_trades WHERE position = ? ORDER BY id").all(positionId) as { kind: TradeRow["kind"]; detail_json: string }[];
  const by = new Map<string, ContractResult & { soldValue: number; boughtValue: number }>();
  for (const t of trades) {
    const d = JSON.parse(t.detail_json) as { fills: FillDetail[] };
    for (const f of d.fills) {
      const key = `${f.symbol}|${f.side}`;
      let r = by.get(key);
      if (!r) {
        r = { symbol: f.symbol, side: f.side, label: f.label, qty: 0, avgPrice: 0, costUsd: 0, result: "open", soldQty: 0, avgSellPrice: null, settledQty: 0, won: null, returnedUsd: 0, pnlUsd: 0, soldValue: 0, boughtValue: 0 };
        by.set(key, r);
      }
      if (t.kind === "open" || t.kind === "add") {
        r.qty += f.qty;
        r.boughtValue += f.qty * f.price;
        r.costUsd += f.qty * f.price + f.feeBase / 1e6;
      } else if (t.kind === "sell") {
        r.soldQty += f.qty;
        r.soldValue += f.qty * f.price;
        r.returnedUsd += f.qty * f.price - f.feeBase / 1e6;
      } else {
        r.settledQty += f.qty;
        r.won = f.price >= 1;
        r.returnedUsd += f.price >= 1 ? f.qty : 0;
      }
    }
  }
  return [...by.values()].map(({ soldValue, boughtValue, ...r }) => {
    const held = r.qty - r.soldQty - r.settledQty;
    const result: ContractResult["result"] =
      held > 1e-6 ? "open" : r.soldQty > 1e-6 && r.settledQty > 1e-6 ? "mixed" : r.settledQty > 1e-6 ? (r.won ? "won" : "lost") : "sold";
    const round = (x: number) => Math.round(x * 100) / 100;
    return {
      ...r,
      qty: round(r.qty),
      avgPrice: r.qty > 0 ? boughtValue / r.qty : 0,
      avgSellPrice: r.soldQty > 0 ? soldValue / r.soldQty : null,
      costUsd: round(r.costUsd),
      returnedUsd: round(r.returnedUsd),
      pnlUsd: round(r.returnedUsd - r.costUsd),
      result,
    };
  });
}

function tradeView(t: TradeRow, titles: Map<string, string>) {
  const d = JSON.parse(t.detail_json) as { fills: FillDetail[]; fraction?: number; outcome?: string | null };
  return {
    id: t.id,
    position: t.position,
    title: titles.get(t.position) ?? "",
    kind: t.kind,
    cashUsd: t.cash_base / 1e6,
    realizedUsd: t.realized_base / 1e6,
    fraction: d.fraction ?? null,
    outcome: d.outcome ?? null,
    fills: d.fills.map((f) => ({ ...f, feeUsd: f.feeBase / 1e6 })),
    at: t.created_at,
  };
}

/** The whole account: cash, every position valued now, totals, value history and recent activity. */
export async function portfolio(db: DB, markets: PaperMarkets, account: string, opts: { record?: boolean } = {}) {
  const acct = ensureAccount(db, account);
  const rows = db.prepare("SELECT * FROM paper_positions WHERE account = ? ORDER BY opened_at DESC").all(account) as PositionRow[];
  const positions: PositionSummary[] = [];
  for (const r of rows) {
    const { pos, event, pricing } = await refresh(db, markets, r);
    const legs = getLegs(db, pos.id);
    const { summary } = summarize(pos, legs, event, pricing, lastMarkOf(db, pos.id), flowsOf(db, pos.id));
    // Closed and settled positions carry how each contract ended, for the list's one-line summary.
    if (pos.status !== "open") summary.results = contractResults(db, pos.id).map((c) => ({ label: c.label, side: c.side, result: c.result, pnlUsd: c.pnlUsd }));
    if (opts.record !== false && pos.status === "open" && summary.pricing === "live") mark(db, pos.id, Math.round(summary.valueUsd * 1e6));
    positions.push(summary);
  }
  const cash = (db.prepare("SELECT cash_base FROM paper_accounts WHERE id = ?").get(account) as { cash_base: number }).cash_base / 1e6;
  const open = positions.filter((p) => p.status === "open");
  const positionsUsd = open.reduce((s, p) => s + p.valueUsd, 0);
  const totals = {
    cashUsd: cash,
    positionsUsd,
    totalUsd: cash + positionsUsd,
    startUsd: PAPER_START_BASE / 1e6,
    /** Selling every open position now, at the bids after fees (positions without a bid count at their value). */
    cashOutUsd: open.reduce((s, p) => s + (p.cashOutUsd ?? p.valueUsd), 0),
    unrealizedUsd: open.reduce((s, p) => s + p.unrealizedUsd, 0),
    realizedUsd: positions.reduce((s, p) => s + p.realizedUsd, 0),
    openCount: open.length,
  };
  if (opts.record !== false) mark(db, `acct:${account}`, Math.round(totals.totalUsd * 1e6));
  const titles = new Map(rows.map((r) => [r.id, r.title]));
  const trades = (db.prepare("SELECT * FROM paper_trades WHERE account = ? ORDER BY id DESC LIMIT 100").all(account) as TradeRow[]).map((t) => tradeView(t, titles));
  const fresh = ensureAccount(db, account);
  return {
    account: acct.id,
    createdAt: fresh.created_at,
    /** When a demo portfolio was added: history and demo positions before this are sample data. */
    demoAt: fresh.demo_state === "seeded" ? fresh.demo_at : null,
    totals,
    positions,
    history: marksOf(db, `acct:${account}`),
    trades,
  };
}

/** One position in full: legs valued at the bids, its payout schedule, history, activity and what can be traded. */
export async function positionDetail(db: DB, markets: PaperMarkets, account: string, id: string) {
  const { pos, event, pricing } = await refresh(db, markets, getRow(db, account, id));
  const legs = getLegs(db, pos.id);
  const { summary, legViews } = summarize(pos, legs, event, pricing, lastMarkOf(db, pos.id), flowsOf(db, pos.id));
  const info = JSON.parse(pos.ladder_json) as LadderInfo;
  let marketProb = info.marketProb;
  try {
    if (pos.status === "open") marketProb = (await markets.getLadder(pos.ticker)).ladder.marketProb;
  } catch {
    // keep the odds from when it was opened
  }
  const left = new Date(pos.expiry).getTime() - Date.now();
  const titles = new Map([[pos.id, pos.title]]);
  const trades = (db.prepare("SELECT * FROM paper_trades WHERE position = ? ORDER BY id DESC").all(pos.id) as TradeRow[]).map((t) => tradeView(t, titles));
  const cash = (db.prepare("SELECT cash_base FROM paper_accounts WHERE id = ?").get(account) as { cash_base: number }).cash_base / 1e6;
  return {
    ...summary,
    contractResults: contractResults(db, pos.id),
    valueUsd: summary.valueUsd,
    request: JSON.parse(pos.request_json) as PaperRequest,
    ladder: { ...info, marketProb },
    cashInPositionUsd: pos.cash_base / 1e6,
    legs: legViews,
    history: marksOf(db, pos.id),
    trades,
    accountCashUsd: cash,
    canBuyMore: pos.status === "open" && left > CLOSE_BUFFER_MS && pricing === "live",
    canSell: pos.status === "open" && left > 0 && pricing === "live" && legViews.every((l) => l.bid !== null),
  };
}
