import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { fromMarket } from "@contour/core";
import type { DB } from "../db";
import { makeQuote, type MarketService } from "../markets";
import { addToPosition, openPosition, portfolio, positionDetail, resetAccount, sellPosition } from "../paper";
import { ensureDemo } from "../paperDemo";

/** A paper account id: a random id the browser keeps (no wallet, no sign-up). */
const Account = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const Id = z.string().uuid();

/** The demo's live positions: one outlook each on a few different price markets, filled at today's prices. */
const DEMO_LIVE = [
  { title: "Higher", shift: 0.8, scale: 0.85, stake: 600 },
  { title: "Stays near", shift: 0, scale: 0.55, stake: 450, shape: "range" as const },
  { title: "Lower", shift: -0.8, scale: 0.85, stake: 350 },
];

type Sell = (account: string, id: string, fraction: number, minProceedsUsd?: number) => Promise<{ sale: unknown; position: unknown }>;

/** `sell`: replaces the plain practice-cash sale (the server's pays positions bought with SOL out in SOL). */
export function registerPaperRoutes(app: FastifyInstance, ctx: { db: DB; markets: MarketService; sell?: Sell }) {
  // Quotes and fills the demo's live positions through the same path as any paper trade.
  async function openLive(account: string) {
    const { markets: list } = await ctx.markets.listMarkets();
    const seen = new Set<string>();
    const picks = list
      .filter((m) => !m.sample && m.kind === "threshold" && new Date(m.expiry).getTime() - Date.now() > 36 * 3_600_000 && m.quotedCount >= 6)
      .filter((m) => {
        const series = m.ticker.replace(/\d.*$/, "");
        if (seen.has(series)) return false;
        seen.add(series);
        return true;
      });
    let k = 0;
    for (const m of picks) {
      if (k >= DEMO_LIVE.length) break;
      const v = DEMO_LIVE[k];
      try {
        const { ladder, frozen } = await ctx.markets.getLadder(m.ticker);
        if (frozen) continue;
        const belief = fromMarket(ladder, v.shift, v.scale);
        const q = await makeQuote(ctx.markets, ctx.db, { ticker: m.ticker, belief, confidence: 0.75, stakeUsd: v.stake, ...(v.shape ? { shape: v.shape } : {}) });
        if (!q.quote.legs.length) continue;
        await openPosition(ctx.db, ctx.markets, account, q.quoteId, `${v.title} · demo trade`);
        k++;
      } catch (err) {
        console.warn(`[paper demo] ${m.ticker}:`, (err as Error).message);
      }
    }
  }

  app.get("/paper/:account", async (req) => {
    const { account } = z.object({ account: Account }).parse(req.params);
    await ensureDemo(ctx.db, ctx.markets, account, openLive);
    return portfolio(ctx.db, ctx.markets, account);
  });

  // Start over: with a fresh demo portfolio (default), or empty with just the starting cash.
  app.post("/paper/:account/reset", async (req) => {
    const { account } = z.object({ account: Account }).parse(req.params);
    const { demo } = z.object({ demo: z.boolean().default(true) }).parse(req.body ?? {});
    resetAccount(ctx.db, account, demo);
    await ensureDemo(ctx.db, ctx.markets, account, openLive);
    return portfolio(ctx.db, ctx.markets, account);
  });

  app.get("/paper/:account/positions/:id", async (req) => {
    const { account, id } = z.object({ account: Account, id: Id }).parse(req.params);
    return positionDetail(ctx.db, ctx.markets, account, id);
  });

  // Open a position from a reviewed desk quote (the paper stand-in for signing on-chain).
  app.post("/paper/:account/positions", async (req) => {
    const { account } = z.object({ account: Account }).parse(req.params);
    const body = z.object({ quoteId: z.string().uuid(), label: z.string().max(160).optional() }).parse(req.body);
    const id = await openPosition(ctx.db, ctx.markets, account, body.quoteId, body.label);
    return positionDetail(ctx.db, ctx.markets, account, id);
  });

  // Buy more of the same position from a fresh quote with its stored view.
  app.post("/paper/:account/positions/:id/add", async (req) => {
    const { account, id } = z.object({ account: Account, id: Id }).parse(req.params);
    const body = z.object({ quoteId: z.string().uuid() }).parse(req.body);
    await addToPosition(ctx.db, ctx.markets, account, id, body.quoteId);
    return positionDetail(ctx.db, ctx.markets, account, id);
  });

  // Sell part or all of a position at the bids.
  app.post("/paper/:account/positions/:id/sell", async (req) => {
    const { account, id } = z.object({ account: Account, id: Id }).parse(req.params);
    const body = z.object({ fraction: z.number().gt(0).lte(1), minProceedsUsd: z.number().nonnegative().optional() }).parse(req.body);
    if (ctx.sell) return ctx.sell(account, id, body.fraction, body.minProceedsUsd);
    const sale = await sellPosition(ctx.db, ctx.markets, account, id, body.fraction, body.minProceedsUsd);
    return { sale, position: await positionDetail(ctx.db, ctx.markets, account, id) };
  });
}
