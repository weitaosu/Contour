import type { FastifyInstance } from "fastify";
import type { DB } from "../db";
import { computeReplay } from "../replay";

let cache: { key: string; data: unknown } | null = null;

export function registerReplayRoutes(app: FastifyInstance, ctx: { db: DB }) {
  // The replay only changes when an outcome is recorded (or simulated ladders are seeded or removed),
  // and computing it compiles three quotes per ladder, so it's recomputed only when that set changes.
  const version = ctx.db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(checked_at), 0) AS t, (SELECT COUNT(*) FROM ladders WHERE demo = 1) AS d FROM outcomes");
  app.get("/replay", async () => {
    const v = version.get() as { n: number; t: number; d: number };
    const key = `${v.n}:${v.t}:${v.d}`;
    if (!cache || cache.key !== key) cache = { key, data: computeReplay(ctx.db) };
    return cache.data;
  });
  // Warm it once the server is up, so the first visitor doesn't wait for it.
  app.addHook("onListen", async () => {
    setTimeout(() => void app.inject({ method: "GET", url: "/replay" }).catch(() => {}), 1_000);
  });
}
