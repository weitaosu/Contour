import type { FastifyReply } from "fastify";

/** Fan-out of server-sent events, keyed by topic (a position pubkey, an owner, or "all"). */
export class SseHub {
  private subs = new Map<string, Set<FastifyReply>>();

  subscribe(topic: string, reply: FastifyReply, origin?: string) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    });
    reply.raw.write(`: connected ${new Date().toISOString()}\n\n`);
    let set = this.subs.get(topic);
    if (!set) this.subs.set(topic, (set = new Set()));
    set.add(reply);
    const hb = setInterval(() => reply.raw.write(`: hb\n\n`), 15_000);
    reply.raw.on("close", () => {
      clearInterval(hb);
      set!.delete(reply);
    });
  }

  publish(topic: string, event: string, data: unknown) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const t of [topic, "all"]) for (const r of this.subs.get(t) ?? []) r.raw.write(msg);
  }
}
