import { pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import { GeminiPublicClient } from "@contour/gemini";
import Fastify from "fastify";
import { z } from "zod";
import { config } from "./config";
import { openDb } from "./db";
import { makeQuote, MarketService } from "./markets";
import { startRecorder } from "./recorder";
import { SseHub } from "./sse";
import { registerPositionRoutes } from "./routes/positions";
import { registerReplayRoutes } from "./routes/replay";
import { registerHookRoutes } from "./routes/hooks";
import { getChain } from "./chain";
import { makeExecutor } from "./executor";
import { handleStreamTx, runScheduler, type HandlerCtx } from "./handler";
import { PublicKey } from "@solana/web3.js";
import { configPda } from "@contour/chain";

export async function buildServer() {
  const db = openDb();
  const gemini = new GeminiPublicClient(config.geminiBase);
  const markets = new MarketService(gemini);
  const hub = new SseHub();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 5 * 1024 * 1024 });
  await app.register(cors, { origin: config.webOrigin, methods: ["GET", "POST", "OPTIONS"] });
  // Keep the raw body: QuickNode signs the exact bytes it sends.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    try {
      done(null, body === "" ? {} : JSON.parse(body as string));
    } catch (err) {
      (err as Error & { statusCode?: number }).statusCode = 400;
      done(err as Error, undefined);
    }
  });
  const chain = getChain();
  const executor = makeExecutor(markets);
  const ctx: HandlerCtx = { db, hub, markets, executor, chain, log: app.log };

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) app.log.error(err);
    reply.status(status).send({ error: err.message });
  });

  app.get("/health", async () => ({ ok: true, executionMode: config.executionMode, programId: config.programId || null }));

  app.get("/config", async () => ({
    executionMode: config.executionMode,
    programId: config.programId || null,
    usdcMint: config.usdcMint || null,
    cluster: "devnet",
    faucetEnabled: config.faucetEnabled && !!chain?.mintAuthority,
    desk: chain?.desk.publicKey.toBase58() ?? null,
  }));

  app.get("/markets", async (req) => {
    const q = z.object({ category: z.string().optional(), search: z.string().optional() }).parse(req.query);
    const { markets: all, rejected, updatedAt, frozenAt } = await markets.listMarkets();
    const s = q.search?.toLowerCase().trim();
    const filtered = all.filter(
      (m) => (!q.category || m.category === q.category) && (!s || m.title.toLowerCase().includes(s) || m.ticker.toLowerCase().includes(s)),
    );
    return { markets: filtered, rejected, updatedAt, frozenAt };
  });

  app.get("/markets/:ticker", async (req) => {
    const { ticker } = z.object({ ticker: z.string().min(1) }).parse(req.params);
    const { ladder, capturedAt, event, frozen, sample } = await markets.getLadder(ticker);
    return { ladder, capturedAt, volume: event.volume ? Number(event.volume) : null, frozen, sample };
  });

  // Fast tier for market pages: spot price and current asks, polled every few seconds.
  app.get("/live/:ticker", async (req) => {
    const { ticker } = z.object({ ticker: z.string().min(1) }).parse(req.params);
    return markets.live(ticker);
  });

  const quoteBody = z.object({
    ticker: z.string().min(1),
    belief: z.array(z.number().nonnegative()).min(2).max(40),
    confidence: z.number().min(0).max(1),
    stakeUsd: z.number().positive().max(100_000),
    // Holding strategies, priced from NO contracts: floor = protect; floor + cap = collar; cap only = covered call.
    protect: z
      .object({ units: z.number().positive().max(1_000_000), floor: z.number().finite().optional(), cap: z.number().finite().optional() })
      .refine((p) => p.floor !== undefined || p.cap !== undefined, "protect needs a floor, a cap, or both")
      .optional(),
    // Call/put spread: equal steps between two strikes, sized to stakeUsd.
    spread: z.object({ direction: z.enum(["up", "down"]), from: z.number().finite(), to: z.number().finite() }).optional(),
  });
  app.post("/quote", async (req) => {
    const body = quoteBody.parse(req.body);
    const s = body.belief.reduce((a, b) => a + b, 0);
    if (!(Math.abs(s - 1) < 1e-6)) throw Object.assign(new Error("belief must sum to 1"), { statusCode: 400 });
    return makeQuote(markets, db, body);
  });

  registerPositionRoutes(app, { db, hub, markets });
  registerReplayRoutes(app, { db });
  registerHookRoutes(app, ctx);

  app.post("/faucet", async (req, reply) => {
    const { owner } = z.object({ owner: z.string().min(32).max(64) }).parse(req.body);
    if (!config.faucetEnabled || !chain?.mintAuthority) return reply.status(403).send({ error: "faucet disabled" });
    const row = db.prepare("SELECT last_at, count FROM faucet_claims WHERE owner = ?").get(owner) as { last_at: number; count: number } | undefined;
    if (row && Date.now() - row.last_at < 10 * 60_000) return reply.status(429).send({ error: "one faucet claim per 10 minutes" });
    const signature = await chain.faucet(new PublicKey(owner));
    db.prepare("INSERT INTO faucet_claims (owner, last_at, count) VALUES (?, ?, 1) ON CONFLICT(owner) DO UPDATE SET last_at = excluded.last_at, count = count + 1").run(owner, Date.now());
    return { signature, usdc: 1000, sol: 0.05 };
  });

  // Localnet only: QuickNode cannot stream a local validator, so for local development the desk can
  // subscribe to program logs over the validator's websocket. Refused for any non-local RPC, so on
  // devnet the QuickNode Stream is always the event source.
  if (chain && process.env.LOCAL_EVENT_SOURCE === "websocket") {
    const host = new URL(config.solanaRpcUrl).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      app.log.error("LOCAL_EVENT_SOURCE=websocket is only allowed with a local validator; ignoring");
    } else {
      chain.connection.onLogs(new PublicKey(config.programId), (l) => {
        if (l.err) return;
        void handleStreamTx(ctx, { signature: l.signature, logs: l.logs }, "local-websocket");
      }, "confirmed");
      app.log.info("[events] localnet websocket event source enabled");
    }
  }

  if (chain && config.schedulerEnabled) {
    let grace = 86_400;
    chain.deskProgram.account.config
      .fetch(configPda())
      .then((c) => (grace = Number(c.settleGraceSecs.toString())))
      .catch((e) => app.log.warn(`[scheduler] config not readable yet: ${e.message}`));
    let running = false;
    setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await runScheduler(ctx, grace);
      } finally {
        running = false;
      }
    }, 30_000);
  }

  if (config.recorderEnabled) startRecorder(db, gemini);
  // Warm the market list.
  void markets.listMarkets().catch((e) => app.log.warn(e));

  return { app, db, markets, hub, gemini, ctx };
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { app } = await buildServer();
  await app.listen({ port: config.port, host: config.host });
}
