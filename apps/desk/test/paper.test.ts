import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { compile, escrowTerms, fromMarket, normalizeEvent, type EventLike, type Ladder } from "@contour/core";
import type { RawEvent } from "@contour/gemini";
import { migrate, type DB } from "../src/db";
import { DEMO_GROWTH, ensureDemo } from "../src/paperDemo";
import { MAX_SLIPPAGE, PAPER_START_BASE, buyPrice, markPrice, openPosition, resetAccount, addToPosition, planSale, portfolio, positionDetail, sellPosition, sellPrice, type PaperMarkets } from "../src/paper";

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/sol_calm.json"), "utf8"));
const FUTURE = new Date(Date.now() + 3 * 86_400_000).toISOString();

function setup() {
  const db: DB = new Database(":memory:");
  migrate(db);
  const event: RawEvent = JSON.parse(JSON.stringify({ ...fixture.event, status: "active", expiryDate: FUTURE }));
  const ladder: Ladder = { ...normalizeEvent(event as unknown as EventLike), expiry: FUTURE };
  const markets: PaperMarkets & { event: RawEvent } = {
    event,
    async getEvent() {
      return this.event;
    },
    async getLadder() {
      return { ladder, frozen: false, sample: false };
    },
  };
  let n = 0;
  const quote = (stakeUsd: number, shift = 1.2) => {
    const belief = fromMarket(ladder, shift, 0.7);
    const q = compile({ ladder, belief, confidence: 0.75, stakeUsd });
    const { raw, ...rest } = q;
    const quoteId = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
    const stored = {
      quoteId,
      ticker: ladder.eventTicker,
      title: ladder.title,
      validUntil: Date.now() + 30_000,
      expiryTs: Math.floor(new Date(FUTURE).getTime() / 1000),
      preimage: { ticker: ladder.eventTicker, marketProb: ladder.marketProb, belief, confidence: 0.75, quoteId, capturedAt: new Date().toISOString() },
      quote: { ...rest, iterations: raw.iterations },
    };
    db.prepare("INSERT INTO quotes (id, ticker, forecast_hash, preimage_json, quote_json, schedule_json, stake_base, expiry_ts, created_at) VALUES (?, ?, 'h', '{}', ?, '[]', '0', 0, ?)").run(
      quoteId,
      ladder.eventTicker,
      JSON.stringify(stored),
      Date.now(),
    );
    return { quoteId, q };
  };
  const cash = (acct: string) => (db.prepare("SELECT cash_base FROM paper_accounts WHERE id = ?").get(acct) as { cash_base: number }).cash_base;
  return { db, markets, ladder, quote, cash };
}

describe("paper prices", () => {
  it("never values a contract above what it would cost to buy (crossed, stale bids)", () => {
    const c = { prices: { buy: { yes: "0.81", no: "0.05" }, sell: { yes: "0.95", no: "0.19" } } } as never;
    expect(sellPrice(c, "yes")).toBe(0.81);
    expect(buyPrice(c, "yes")).toBe(0.81);
    // Without a sell price, a YES bid mirrors the NO ask.
    expect(sellPrice({ prices: { buy: { yes: "0.40", no: "0.62" } } } as never, "yes")).toBeCloseTo(0.38, 9);
  });

  it("marks at the midpoint like a brokerage, never at the bid, and ignores stale last trades", () => {
    // 88¢ bid / 98¢ ask with a last trade of 42¢ from hours ago: the mark is the midpoint.
    const c = { prices: { buy: { yes: "0.98", no: "0.12" }, sell: { yes: "0.88", no: "0.02" }, lastTradePrice: "0.42" } } as never;
    expect(markPrice(c, "yes")).toBeCloseTo(0.93, 9);
    expect(markPrice(c, "no")).toBeCloseTo(0.07, 9);
    // One side of the book only: the last trade if it's consistent with it, else that side's price.
    expect(markPrice({ prices: { buy: { yes: "0.20" }, lastTradePrice: "0.15" } } as never, "yes")).toBeCloseTo(0.15, 9);
    expect(markPrice({ prices: { buy: { yes: "0.20" }, lastTradePrice: "0.35" } } as never, "yes")).toBeCloseTo(0.2, 9);
  });
});

describe("paper trading ledger", () => {
  it("opening debits exactly what the trade costs at the live asks and holds the quoted contracts", async () => {
    const { db, markets, quote, cash } = setup();
    const { quoteId, q } = quote(100);
    expect(q.legs.length).toBeGreaterThan(0);
    const id = await openPosition(db, markets, "test-acct-1", quoteId, "Higher");
    const d = await positionDetail(db, markets, "test-acct-1", id);
    const paid = PAPER_START_BASE - cash("test-acct-1");
    // What the user pays is the escrowed part of the stake: contracts + fees (the quote's spare cash stays in the account).
    expect(paid).toBeCloseTo(escrowTerms(q).stakeBase, -4);
    expect(d.costUsd).toBeCloseTo(paid / 1e6, 6);
    expect(d.legs.map((l) => [l.symbol, l.side, l.qty])).toEqual(
      [...q.legs].sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0)).map((l) => [l.symbol, l.side, l.qty]),
    );
    // Its "if it settles" schedule is the quote's payout minus the cash that stayed in the account.
    const kept = escrowTerms(q).keptBase / 1e6;
    d.schedule.forEach((s, j) => expect(s).toBeCloseTo(q.payoutByBucket[j] - kept, 1));
    // Shown at the mark; the cash-out estimate (bids, after sell fees) is lower, and both are below cost.
    expect(d.cashOutUsd).not.toBeNull();
    expect(d.cashOutUsd!).toBeLessThan(d.valueUsd);
    expect(d.valueUsd).toBeLessThan(d.costUsd);
    // Right after buying nothing has moved: the whole gap from cost is the entry cost (fees + half the spread).
    expect(d.moveUsd).toBeCloseTo(0, 6);
    expect(d.entryCostUsd).toBeCloseTo(d.costUsd - d.valueUsd, 6);
    expect(d.entryCostUsd).toBeGreaterThanOrEqual(d.feesPaidUsd - 1e-6);
    expect(d.unrealizedUsd).toBeCloseTo(d.moveUsd - d.entryCostUsd, 6);
  });

  it("refuses a quote twice, and refuses when an ask moved past the price protection", async () => {
    const { db, markets, quote } = setup();
    const { quoteId, q } = quote(100);
    await openPosition(db, markets, "test-acct-2", quoteId);
    await expect(openPosition(db, markets, "test-acct-2", quoteId)).rejects.toThrow(/already been filled/);
    const second = quote(50);
    const leg = second.q.legs[0];
    const c = markets.event.contracts.find((x) => x.instrumentSymbol === leg.symbol)!;
    const moved = (leg.price + MAX_SLIPPAGE + 0.02).toFixed(2);
    c.prices = { ...c.prices, buy: { ...c.prices?.buy, [leg.side]: moved } };
    await expect(openPosition(db, markets, "test-acct-2", second.quoteId)).rejects.toThrow(/Prices moved/);
    expect(q.legs.length).toBeGreaterThan(0);
  });

  it("buying more merges into the same contracts and adds to the cost basis", async () => {
    const { db, markets, quote, cash } = setup();
    const a = quote(100);
    const id = await openPosition(db, markets, "test-acct-3", a.quoteId);
    const before = await positionDetail(db, markets, "test-acct-3", id);
    const cashBefore = cash("test-acct-3");
    const b = quote(60);
    await addToPosition(db, markets, "test-acct-3", id, b.quoteId);
    const after = await positionDetail(db, markets, "test-acct-3", id);
    expect(after.costUsd - before.costUsd).toBeCloseTo((cashBefore - cash("test-acct-3")) / 1e6, 6);
    expect(after.contracts).toBeCloseTo(before.contracts + b.q.legs.reduce((s, l) => s + l.qty, 0), 6);
    expect(after.trades.map((t) => t.kind)).toEqual(["add", "open"]);
  });

  it("selling half books realized P&L on half the cost basis; selling the rest closes it", async () => {
    const { db, markets, quote, cash } = setup();
    const { quoteId } = quote(200);
    const acct = "test-acct-4";
    const id = await openPosition(db, markets, acct, quoteId);
    const d0 = await positionDetail(db, markets, acct, id);
    const preview = planSale({ cash_base: Math.round(d0.cashInPositionUsd * 1e6), cost_base: Math.round(d0.costUsd * 1e6) }, db.prepare("SELECT * FROM paper_legs WHERE position = ?").all(id) as never, markets.event, 0.5);
    const cashBefore = cash(acct);
    const half = await sellPosition(db, markets, acct, id, 0.5, preview.proceedsBase / 1e6);
    expect(half.proceedsUsd).toBeCloseTo(preview.proceedsBase / 1e6, 6);
    expect(cash(acct) - cashBefore).toBe(preview.proceedsBase);
    expect(half.realizedUsd).toBeCloseTo(half.proceedsUsd - d0.costUsd / 2, 4);
    const d1 = await positionDetail(db, markets, acct, id);
    expect(d1.costUsd).toBeCloseTo(d0.costUsd / 2, 4);
    expect(d1.status).toBe("open");
    // A preview the market has since beaten by more than the tolerance is refused.
    await expect(sellPosition(db, markets, acct, id, 1, half.proceedsUsd * 3)).rejects.toThrow(/Prices moved/);
    const rest = await sellPosition(db, markets, acct, id, 1);
    const d2 = await positionDetail(db, markets, acct, id);
    expect(d2.status).toBe("closed");
    expect(d2.legs).toHaveLength(0);
    expect(d2.realizedUsd).toBeCloseTo(half.realizedUsd + rest.realizedUsd, 6);
    // Per contract: all sold, results adding up to the position's.
    d2.contractResults.forEach((c) => expect(c.result).toBe("sold"));
    expect(d2.contractResults.reduce((a, c) => a + c.pnlUsd, 0)).toBeCloseTo(d2.realizedUsd, 1);
    // Every dollar is accounted for: start = cash now − realized P&L.
    expect(cash(acct) / 1e6 - d2.realizedUsd).toBeCloseTo(PAPER_START_BASE / 1e6, 4);
  });

  it("settles on Gemini's result: winning contracts pay $1 each and the cash comes back", async () => {
    const { db, markets, ladder, quote, cash } = setup();
    const acct = "test-acct-5";
    const { quoteId } = quote(150);
    const id = await openPosition(db, markets, acct, quoteId);
    const d0 = await positionDetail(db, markets, acct, id);
    // Resolve so the price lands in the outcome this position pays most in.
    const k = d0.schedule.indexOf(Math.max(...d0.schedule));
    const strikes = [...markets.event.contracts].sort((a, b) => Number(a.strike?.value) - Number(b.strike?.value));
    strikes.forEach((c, i) => (c.resolutionSide = i < k ? "yes" : "no"));
    markets.event = { ...markets.event, status: "settled" };
    const cashBefore = cash(acct);
    const p = await portfolio(db, markets, acct);
    const s = p.positions.find((x) => x.id === id)!;
    expect(s.status).toBe("settled");
    expect(s.outcomeLabel).toBe(ladder.bucketLabels[k]);
    expect(s.payoutUsd).toBeCloseTo(d0.schedule[k], 1);
    expect((cash(acct) - cashBefore) / 1e6).toBeCloseTo(s.payoutUsd!, 6);
    expect(s.realizedUsd).toBeCloseTo(s.payoutUsd! - d0.costUsd, 4);
    expect(p.totals.openCount).toBe(0);
    // Per contract: winners paid $1 each, losers nothing, and the results add up to the position's.
    const det = await positionDetail(db, markets, acct, id);
    expect(det.contractResults.length).toBeGreaterThan(0);
    det.contractResults.forEach((c) => {
      expect(["won", "lost"]).toContain(c.result);
      expect(c.returnedUsd).toBeCloseTo(c.result === "won" ? c.qty : 0, 1);
    });
    expect(det.contractResults.reduce((a, c) => a + c.pnlUsd, 0)).toBeCloseTo(s.realizedUsd, 1);
    // Reading it again doesn't pay twice.
    await portfolio(db, markets, acct);
    expect((cash(acct) - cashBefore) / 1e6).toBeCloseTo(s.payoutUsd!, 6);
  });

  it("refuses a trade the paper cash can't cover", async () => {
    const { db, markets, quote } = setup();
    db.prepare("INSERT INTO paper_accounts (id, cash_base, created_at, updated_at) VALUES (?, ?, ?, ?)").run("test-acct-6", 5_000_000, Date.now(), Date.now());
    const { quoteId } = quote(400);
    await expect(openPosition(db, markets, "test-acct-6", quoteId)).rejects.toThrow(/Not enough paper cash/);
  });
});

describe("demo portfolio", () => {
  it("seeds six volatile months ending about 67% up, with an exact ledger, once", async () => {
    const { db, markets, quote } = setup();
    const acct = "demo-acct-1";
    // Live part: one real paper position at today's (fixture) prices.
    const openLive = async (a: string) => {
      const { quoteId } = quote(400);
      await openPosition(db, markets, a, quoteId, "Higher · demo trade");
    };
    await ensureDemo(db, markets, acct, openLive);
    const p = await portfolio(db, markets, acct);
    expect(p.totals.totalUsd / p.totals.startUsd).toBeCloseTo(DEMO_GROWTH, 2);
    expect(p.positions.filter((x) => x.demo)).toHaveLength(8);
    expect(p.positions.filter((x) => x.status === "open")).toHaveLength(1);
    expect(p.demoAt).not.toBeNull();
    // Ledger: cash = start + every realized result − what's in open positions.
    const open = p.positions.filter((x) => x.status === "open");
    expect(p.totals.cashUsd).toBeCloseTo(p.totals.startUsd + p.totals.realizedUsd - open.reduce((s, x) => s + x.costUsd, 0), 4);
    // History: from the start six months ago to the real value now, through real swings.
    const h = p.history;
    expect(h[0].at).toBeLessThan(Date.now() - 180 * 86_400_000);
    expect(h[0].valueUsd).toBeCloseTo(p.totals.startUsd, 2);
    expect(h[h.length - 1].valueUsd).toBeCloseTo(p.totals.totalUsd, 0);
    let peak = h[0].valueUsd;
    let worst = 0;
    for (const m of h) {
      peak = Math.max(peak, m.valueUsd);
      worst = Math.max(worst, 1 - m.valueUsd / peak);
    }
    expect(worst).toBeGreaterThan(0.08); // volatile: at least one real drawdown on the way up
    expect(h.filter((m) => m.at > Date.now() - 86_400_000).length).toBeGreaterThan(200); // detail for the 1D view
    // Each closed contract's result adds up to its position's, and contracts win or lose by the outcome.
    for (const x of p.positions.filter((y) => y.demo)) {
      const sum = x.results!.reduce((acc, c) => acc + c.pnlUsd, 0);
      expect(sum).toBeCloseTo(x.realizedUsd, 1);
    }
    const mixed = p.positions.find((x) => x.status === "settled" && x.results!.some((c) => c.result === "won") && x.results!.some((c) => c.result === "lost"));
    expect(mixed).toBeDefined();
    // Loading again doesn't add a second demo.
    await ensureDemo(db, markets, acct, openLive);
    const again = await portfolio(db, markets, acct);
    expect(again.positions).toHaveLength(p.positions.length);
  });

  it("an account reset to empty gets no demo", async () => {
    const { db, markets } = setup();
    resetAccount(db, "demo-acct-2", false);
    await ensureDemo(db, markets, "demo-acct-2", async () => {});
    const p = await portfolio(db, markets, "demo-acct-2");
    expect(p.positions).toHaveLength(0);
    expect(p.totals.totalUsd).toBe(p.totals.startUsd);
  });
});
