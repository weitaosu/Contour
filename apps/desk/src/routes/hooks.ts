import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config";
import { handleStreamTx, type HandlerCtx, type StreamTx } from "../handler";

/** Verify a QuickNode Streams delivery: hex HMAC-SHA256(token, nonce + timestamp + body). */
export function verifyQuicknode(token: string, headers: Record<string, unknown>, rawBody: string): boolean {
  const nonce = headers["x-qn-nonce"];
  const ts = headers["x-qn-timestamp"];
  const sig = headers["x-qn-signature"];
  if (typeof nonce !== "string" || typeof ts !== "string" || typeof sig !== "string") return false;
  const expected = createHmac("sha256", token).update(nonce + ts + rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Pull {signature, logs} transactions out of a Streams payload. Accepts our filter's output
 * ({signature, slot, blockTime, logs}) and raw Solana block shapes (transaction.signatures + meta.logMessages).
 */
export function extractTxs(body: unknown): StreamTx[] {
  const out: StreamTx[] = [];
  const seen = new Set<string>();
  const visit = (v: unknown, slot?: number, blockTime?: number) => {
    if (Array.isArray(v)) return v.forEach((x) => visit(x, slot, blockTime));
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const s = typeof o.slot === "number" ? o.slot : typeof o.parentSlot === "number" ? (o.parentSlot as number) + 1 : slot;
    const bt = typeof o.blockTime === "number" ? o.blockTime : blockTime;
    if (typeof o.signature === "string" && Array.isArray(o.logs)) {
      if (!seen.has(o.signature)) out.push({ signature: o.signature, slot: s, blockTime: bt, logs: o.logs as string[] });
      seen.add(o.signature);
      return;
    }
    const meta = o.meta as Record<string, unknown> | undefined;
    const txo = o.transaction as Record<string, unknown> | undefined;
    if (meta && Array.isArray(meta.logMessages) && txo && Array.isArray(txo.signatures)) {
      const sigv = String(txo.signatures[0]);
      if (!seen.has(sigv)) out.push({ signature: sigv, slot: s, blockTime: bt, logs: meta.logMessages as string[] });
      seen.add(sigv);
      return;
    }
    for (const val of Object.values(o)) if (val && typeof val === "object") visit(val, s, bt);
  };
  visit(body);
  return out;
}

export function registerHookRoutes(app: FastifyInstance, ctx: HandlerCtx) {
  app.post("/hooks/quicknode", async (req: FastifyRequest & { rawBody?: string }, reply) => {
    const raw = req.rawBody ?? JSON.stringify(req.body ?? null);
    if (!config.quicknodeToken) {
      return reply.status(500).send({ error: "QUICKNODE_STREAM_TOKEN is not configured" });
    }
    if (!req.headers["x-qn-signature"]) return reply.status(400).send({ error: "missing QuickNode signature headers" });
    if (!verifyQuicknode(config.quicknodeToken, req.headers as Record<string, unknown>, raw)) {
      return reply.status(401).send({ error: "bad signature" });
    }
    const txs = extractTxs(req.body);
    // Acknowledge fast; process in the background (handler is idempotent on signature).
    void (async () => {
      for (const tx of txs) await handleStreamTx(ctx, tx, "quicknode");
    })();
    return { ok: true, received: txs.length };
  });
}
