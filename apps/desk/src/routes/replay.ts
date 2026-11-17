import type { FastifyInstance } from "fastify";
import type { DB } from "../db";
import { computeReplay } from "../replay";

let cache: { at: number; data: unknown } | null = null;

export function registerReplayRoutes(app: FastifyInstance, ctx: { db: DB }) {
  app.get("/replay", async () => {
    if (!cache || Date.now() - cache.at > 5 * 60_000) cache = { at: Date.now(), data: computeReplay(ctx.db) };
    return cache.data;
  });
}
