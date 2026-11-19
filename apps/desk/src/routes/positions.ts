import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config";
import type { DB } from "../db";
import type { MarketService } from "../markets";
import type { SseHub } from "../sse";

export interface Ctx {
  db: DB;
  hub: SseHub;
  markets: MarketService;
}

export function positionView(db: DB, pubkey: string) {
  const pos = db.prepare("SELECT * FROM positions WHERE pubkey = ?").get(pubkey) as Record<string, unknown> | undefined;
  if (!pos) return null;
  const fills = db.prepare("SELECT * FROM fills WHERE position = ? ORDER BY id").all(pubkey) as Record<string, unknown>[];
  const quote = pos.quote_id
    ? (db.prepare("SELECT quote_json FROM quotes WHERE id = ?").get(pos.quote_id as string) as { quote_json: string } | undefined)
    : undefined;
  const events = db
    .prepare("SELECT signature, name, payload_json, block_time, received_at, source FROM stream_events WHERE payload_json LIKE ? ORDER BY received_at")
    .all(`%${pubkey}%`) as Record<string, unknown>[];
  return {
    position: pos,
    fills: fills.map((f) => ({ ...f, detail: f.detail_json ? JSON.parse(f.detail_json as string) : null })),
    quote: quote ? JSON.parse(quote.quote_json) : null,
    events: events.map((e) => ({ ...e, payload: JSON.parse(e.payload_json as string) })),
    executionMode: config.executionMode,
  };
}

export function registerPositionRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get("/positions/:pubkey", async (req, reply) => {
    const { pubkey } = z.object({ pubkey: z.string().min(32).max(64) }).parse(req.params);
    const v = positionView(ctx.db, pubkey);
    if (!v) return reply.status(404).send({ error: "unknown position (the desk has not seen it yet)" });
    return v;
  });

  app.get("/positions/:pubkey/stream", async (req, reply) => {
    const { pubkey } = z.object({ pubkey: z.string().min(32).max(64) }).parse(req.params);
    const origin = req.headers.origin && config.webOrigin.includes(req.headers.origin) ? req.headers.origin : undefined;
    ctx.hub.subscribe(pubkey, reply, origin);
    return reply;
  });

  app.get("/wallets/:owner/record", async (req) => {
    const { owner } = z.object({ owner: z.string().min(32).max(64) }).parse(req.params);
    const rows = ctx.db
      .prepare("SELECT * FROM positions WHERE owner = ? ORDER BY created_at DESC")
      .all(owner) as Record<string, unknown>[];
    const settled = rows.filter((r) => r.state === "Settled" && r.score_bps !== null);
    const scores = settled.map((r) => (r.score_bps as number) / 10_000);
    return {
      owner,
      positions: rows.map((r) => {
        const q = r.quote_id
          ? (ctx.db.prepare("SELECT quote_json FROM quotes WHERE id = ?").get(r.quote_id as string) as { quote_json: string } | undefined)
          : undefined;
        const parsed = q ? JSON.parse(q.quote_json) : null;
        return { ...r, title: parsed?.title ?? parsed?.ticker ?? r.ticker, bucketLabels: parsed?.bucketLabels ?? null };
      }),
      summary: {
        count: rows.length,
        settled: settled.length,
        meanScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
        totalScore: scores.reduce((a, b) => a + b, 0),
      },
    };
  });
}
