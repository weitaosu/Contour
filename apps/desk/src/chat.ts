import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { MarketService } from "./markets";

/**
 * "Ask Grok": a chat about the markets, answered by xAI's Grok. The desk holds the key (XAI_API_KEY)
 * and gives Grok live context with every question: the busiest markets and their odds, and the market
 * the user is looking at with its live price. Grok's live search, when the API offers it, lets it
 * explain price moves from the news. Replies stream back as plain text.
 */

const XAI_URL = "https://api.x.ai/v1/responses";
const model = () => process.env.XAI_MODEL || "grok-4";
const key = () => process.env.XAI_API_KEY ?? "";
/** Let Grok search the web and X for recent news (its web_search and x_search tools; on unless XAI_LIVE_SEARCH=false). */
const liveSearch = () => process.env.XAI_LIVE_SEARCH !== "false";

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4_000) }))
    .min(1)
    .max(24),
  /** The market page the user is on, if any. */
  ticker: z.string().max(64).optional(),
});

/** A few questions per minute per visitor, so one tab can't run up the bill. */
const WINDOW_MS = 5 * 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, number[]>();
function allowed(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;
const dollars = (n: number | null) => (n === null ? "n/a" : `$${Math.round(n).toLocaleString("en-US")}`);

/** The busiest markets, one line each: what they are, when they settle, how much trades, and the odds' center. */
async function marketsContext(markets: MarketService): Promise<string> {
  try {
    const { markets: all } = await markets.listMarkets();
    const top = [...all].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)).slice(0, 30);
    return top
      .map((m) => {
        const read = m.readout.leader ? `leader ${m.readout.leader} ${m.readout.leaderProb !== null ? pct(m.readout.leaderProb) : ""}` : m.readout.center ? `market expects ≈ ${m.readout.center}${m.readout.spread ? ` (± ${m.readout.spread})` : ""}` : "";
        return `- ${m.title} [${m.ticker}] · ${m.category} · settles ${m.expiry} · 24h volume ${dollars(m.volume24h)} · ${read}`;
      })
      .join("\n");
  } catch (err) {
    return `(market list unavailable: ${(err as Error).message})`;
  }
}

/** The market on screen: its live price, 24h move, and the odds of every outcome. */
async function pageContext(markets: MarketService, ticker: string): Promise<string> {
  try {
    const [{ ladder, frozen }, live] = await Promise.all([markets.getLadder(ticker), markets.live(ticker).catch(() => null)]);
    const lines = [`The user is looking at: ${ladder.title} [${ladder.eventTicker}] · ${ladder.category} · settles ${ladder.expiry}${frozen ? " · prices frozen (Gemini offline)" : ""}`];
    const s = live?.spot;
    if (s) {
      const move = s.open24h ? ` · 24h change ${(((s.price - s.open24h) / s.open24h) * 100).toFixed(2)}% from ${s.open24h}` : "";
      lines.push(`Live ${s.pair} price on Gemini: ${s.price}${move}`);
    }
    lines.push("Market odds by outcome (from Gemini's contract prices):");
    ladder.bucketLabels.forEach((label, j) => lines.push(`  ${label}: ${pct(ladder.marketProb[j])}`));
    return lines.join("\n");
  } catch (err) {
    return `The user is on market ${ticker}, but its data couldn't be loaded (${(err as Error).message}).`;
  }
}

function systemPrompt(today: string, list: string, page: string | null) {
  return [
    `You are Grok, built into Contour, a demo app on Solana devnet for trading Gemini prediction markets. Today is ${today}.`,
    "How Contour works: a market is a ladder of YES/NO contracts on one question (a price on a date, a game total, the weather). The user draws where they think the result lands (their view, a violet curve), and Contour buys a mix of contracts that pays across that range, instead of betting everything on one contract. Prices are Gemini's live asks; the market's odds come from them.",
    "Help users with: which markets look active or interesting and why, why a price or the odds are moving (use live search for recent news and posts when you can, and say what you found and when), how a market or outcome works, and how to think about a view. Be concrete and brief: a few short paragraphs or bullets. Quote numbers from the data below. If you don't know or the data doesn't say, say so; never invent prices, odds or news.",
    "You can point out what the odds imply and what would make a market move, but don't promise outcomes or tell anyone how much to bet. When suggesting markets, give reasons both ways. Remind people briefly, once, that this is information and not investment advice, and that Contour runs on devnet test funds.",
    "",
    "Contour's busiest markets right now (by 24h volume):",
    list,
    ...(page ? ["", page] : []),
  ].join("\n");
}

/** Answer text from xAI's server-sent events. */
async function* deltas(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        // Responses API: the answer arrives as "response.output_text.delta" events (searches and reasoning are skipped).
        const ev = JSON.parse(data) as { type?: string; delta?: string };
        if (ev.type === "response.output_text.delta" && ev.delta) yield ev.delta;
      } catch {
        // a partial or non-JSON line: skip it
      }
    }
  }
}

/** Grok through xAI's Responses API, with its web and X search tools when `search` (they cite sources inline). */
async function callGrok(input: { role: string; content: string }[], search: boolean) {
  return fetch(XAI_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: model(),
      stream: true,
      input,
      ...(search ? { tools: [{ type: "web_search" }, { type: "x_search" }], max_turns: 3 } : {}),
    }),
    signal: AbortSignal.timeout(150_000),
  });
}

export function registerChatRoutes(app: FastifyInstance, ctx: { markets: MarketService }) {
  /** Whether the chat is set up, so the app can say so instead of failing on the first question. */
  app.get("/chat/status", async () => ({ enabled: !!key(), model: model() }));

  app.post("/chat", async (req, reply) => {
    if (!key()) return reply.status(503).send({ error: "Ask Grok isn't set up on this desk yet (no XAI_API_KEY)." });
    if (!allowed(req.ip)) return reply.status(429).send({ error: "That's a lot of questions at once. Give it a minute and ask again." });
    const body = Body.parse(req.body);
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const [list, page] = await Promise.all([marketsContext(ctx.markets), body.ticker ? pageContext(ctx.markets, body.ticker) : Promise.resolve(null)]);
    const messages = [{ role: "system", content: systemPrompt(today, list, page) }, ...body.messages];

    let res = await callGrok(messages, liveSearch());
    // If the search tools are refused (or their request shape changed), ask again without them.
    if (!res.ok && liveSearch() && res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429) res = await callGrok(messages, false);
    if (!res.ok || !res.body) {
      let detail = `${res.status}`;
      try {
        const j = (await res.json()) as { error?: string | { message?: string }; message?: string };
        detail = typeof j.error === "string" ? j.error : (j.error?.message ?? j.message ?? detail);
      } catch {}
      req.log.warn(`[chat] xAI error: ${detail}`);
      return reply.status(502).send({ error: `Grok didn't answer: ${String(detail).slice(0, 200)}` });
    }
    reply.header("content-type", "text/plain; charset=utf-8").header("cache-control", "no-cache");
    return reply.send(Readable.from(deltas(res.body)));
  });
}
