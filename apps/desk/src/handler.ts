import { compile, scoreBps, normalizeEvent, outcomeBucket, GEMINI_TAKER_FEE_RATE, tradingFeeUsd } from "@contour/core";
import { decodeEvents } from "@contour/chain";
import { PublicKey } from "@solana/web3.js";
import { config } from "./config";
import type { DB } from "./db";
import type { Executor } from "./executor";
import { loadQuoteByHash, type MarketService } from "./markets";
import type { SseHub } from "./sse";
import type { DeskChain } from "./chain";

export interface StreamTx {
  signature: string;
  slot?: number | null;
  blockTime?: number | null;
  logs: string[];
}

export interface HandlerCtx {
  db: DB;
  hub: SseHub;
  markets: MarketService;
  executor: Executor;
  chain: DeskChain | null;
  log: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
}

const g = (d: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (d[k] !== undefined) return d[k];
  return undefined;
};
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
/** Event fields as plain JSON with snake_case keys normalized to camelCase. */
function fields(d: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [camel(k), v])) as Record<string, unknown>;
}

function now() {
  return Date.now();
}

function setPosition(db: DB, pubkey: string, patch: Record<string, unknown>) {
  const exists = db.prepare("SELECT 1 FROM positions WHERE pubkey = ?").get(pubkey);
  if (!exists) {
    db.prepare("INSERT INTO positions (pubkey, owner, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
      pubkey,
      (patch.owner as string) ?? "",
      (patch.state as string) ?? "Open",
      now(),
      now(),
    );
  }
  const cols = Object.keys(patch);
  if (cols.length) {
    db.prepare(`UPDATE positions SET ${cols.map((c) => `${c} = @${c}`).join(", ")}, updated_at = @__now WHERE pubkey = @__pk`).run({
      ...patch,
      __now: now(),
      __pk: pubkey,
    });
  }
}

/** Entry point for every transaction delivered by the QuickNode Stream. Idempotent on (signature, event index). */
export async function handleStreamTx(ctx: HandlerCtx, tx: StreamTx, source: string) {
  let events;
  try {
    events = decodeEvents(tx.logs);
  } catch (err) {
    ctx.log.warn(`[stream] could not decode ${tx.signature}: ${(err as Error).message}`);
    return;
  }
  const ins = ctx.db.prepare(
    `INSERT OR IGNORE INTO stream_events (signature, idx, slot, block_time, name, payload_json, source, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const data = fields(ev.data);
    const r = ins.run(tx.signature, i, tx.slot ?? null, tx.blockTime ?? null, ev.name, JSON.stringify(data), source, now());
    if (r.changes === 0) continue; // already processed
    try {
      await dispatch(ctx, ev.name, data, tx.signature);
    } catch (err) {
      ctx.log.error(`[handler] ${ev.name} ${tx.signature}: ${(err as Error).message}`);
    }
  }
}

async function dispatch(ctx: HandlerCtx, name: string, d: Record<string, unknown>, sig: string) {
  const position = String(d.position);
  const publish = (event: string, extra: Record<string, unknown> = {}) => ctx.hub.publish(position, event, { position, signature: sig, ...d, ...extra });
  switch (name) {
    case "PositionOpened":
    case "positionOpened": {
      setPosition(ctx.db, position, {
        owner: String(d.owner),
        state: "Open",
        stake_base: String(d.stake),
        max_payout_base: String(g(d, "maxPayout")),
        schedule_json: JSON.stringify(d.schedule),
        expiry_ts: Number(g(d, "expiryTs")),
        forecast_hash: String(g(d, "forecastHash")),
        opened_sig: sig,
      });
      publish("opened");
      await onOpened(ctx, position, d, sig);
      break;
    }
    case "PositionAccepted":
    case "positionAccepted":
      setPosition(ctx.db, position, { state: "Active", accepted_sig: sig });
      publish("accepted");
      break;
    case "PositionCancelled":
    case "positionCancelled":
      setPosition(ctx.db, position, { state: "Cancelled", cancelled_sig: sig });
      publish("cancelled");
      break;
    case "PositionSettled":
    case "positionSettled":
      setPosition(ctx.db, position, {
        state: "Settled",
        settled_sig: sig,
        outcome_bucket: Number(d.bucket),
        score_bps: Number(g(d, "scoreBps")),
        payout_base: String(d.payout),
      });
      publish("settled");
      break;
    case "PositionUnwound":
    case "positionUnwound":
      setPosition(ctx.db, position, { state: "Unwound", unwound_sig: sig, payout_base: String(g(d, "ownerAmount")) });
      publish("unwound");
      break;
    default:
      ctx.log.warn(`[handler] unknown event ${name}`);
  }
}

/** BUILD_PLAN 6.5 steps 1-4: check the quote, re-price, accept, then hedge through the executor. */
async function onOpened(ctx: HandlerCtx, position: string, d: Record<string, unknown>, sig: string) {
  const note = (text: string) => {
    setPosition(ctx.db, position, { note: text });
    ctx.hub.publish(position, "note", { position, note: text });
    ctx.log.info(`[desk] ${position}: ${text}`);
  };
  const hash = String(g(d, "forecastHash"));
  const quote = loadQuoteByHash(ctx.db, hash);
  if (!quote) return note("No desk quote matches this forecast hash; not accepting. Cancel to get your stake back.");
  setPosition(ctx.db, position, { quote_id: quote.quoteId, ticker: quote.ticker });

  // 1. Schedule, stake, expiry and market must equal the quote; the quote must be fresh.
  const sched = (d.schedule as unknown[]).map(String);
  if (sched.length !== quote.scheduleBaseUnits.length || sched.some((x, i) => x !== quote.scheduleBaseUnits[i]))
    return note("On-chain schedule differs from the quoted schedule; not accepting.");
  if (String(d.stake) !== quote.stakeBaseUnits) return note("Stake differs from the quote; not accepting.");
  if (Number(g(d, "expiryTs")) !== quote.expiryTs) return note("Expiry differs from the quote; not accepting.");
  if (String(g(d, "marketId")) !== quote.marketIdHex) return note("Market differs from the quote; not accepting.");
  const openedMs = Number(g(d, "openedTs")) * 1000;
  if (openedMs - quote.createdAt > config.acceptMaxQuoteAgeMs) return note("Quote was older than 60 seconds at open; not accepting.");

  // 2. Re-price the legs at current asks, Gemini's taker fees included. The escrow holds what the legs
  // and fees cost at the quote (older quotes also escrowed the cash, which then counts as spent here).
  const legs = quote.quote.legs;
  const kept = Number(quote.keptBaseUnits ?? 0) / 1e6;
  let cost = quote.quote.cashUsd - kept;
  const feeRate = quote.quote.feeRate ?? GEMINI_TAKER_FEE_RATE;
  try {
    const fresh = await ctx.markets.getEvent(quote.ticker, 0);
    for (const l of legs) {
      const c = fresh.contracts.find((x) => x.instrumentSymbol === l.symbol);
      const ask = c?.prices?.buy?.[l.side];
      cost += ask ? Number(ask) * l.qty + tradingFeeUsd(l.qty, Number(ask), feeRate) : Infinity;
    }
  } catch (err) {
    return note(`Could not re-price on Gemini (${(err as Error).message}); not accepting.`);
  }
  const stake = Number(quote.stakeBaseUnits) / 1e6;
  // The slack stays a share of the whole amount the user set (escrowed or not), as before.
  if (cost > stake + (stake + kept) * config.maxRepriceOverStake) {
    return note(`Prices moved: the legs now cost $${cost.toFixed(2)} for a $${stake.toFixed(2)} stake; not accepting. Cancel to get your stake back.`);
  }

  // 3. Accept: post collateral so the vault holds the largest payout.
  if (!ctx.chain) return note("Desk chain access is not configured; cannot accept.");
  let acceptSig: string;
  try {
    acceptSig = await ctx.chain.accept(new PublicKey(position));
  } catch (err) {
    return note(`Accept failed: ${(err as Error).message.slice(0, 200)}`);
  }
  setPosition(ctx.db, position, { accepted_sig: acceptSig, state: "Active" });
  ctx.hub.publish(position, "accepting", { position, signature: acceptSig });

  // 4. Hedge each leg (paper by default).
  const insFill = ctx.db.prepare(
    `INSERT INTO fills (position, symbol, side, strike, qty, price, quoted_price, mode, status, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const l of legs) {
    try {
      const f = await ctx.executor.place(l, quote.ticker);
      // Record the Gemini taker fee the fill pays (simulated fills too), so fill costs reconcile with the quote.
      const fee = f.price !== null && f.price !== undefined ? tradingFeeUsd(f.qty, f.price, feeRate) : 0;
      insFill.run(position, f.symbol, f.side, l.strike, f.qty, f.price, f.quotedPrice, f.mode, f.status, JSON.stringify({ ...(f.detail ?? {}), fee }), now());
    } catch (err) {
      insFill.run(position, l.symbol, l.side, l.strike, l.qty, null, l.price, ctx.executor.mode, "unfilled", JSON.stringify({ label: l.label, reason: (err as Error).message }), now());
    }
  }
  ctx.hub.publish(position, "hedged", { position, fills: legs.length, mode: ctx.executor.mode, openedSig: sig });
}

/** Settle Active positions past expiry once Gemini reports the event settled; unwind after grace. */
export async function runScheduler(ctx: HandlerCtx, graceSecs: number) {
  if (!ctx.chain) return;
  const nowS = Math.floor(Date.now() / 1000);
  const due = ctx.db
    .prepare("SELECT pubkey, owner, ticker, quote_id, expiry_ts FROM positions WHERE state = 'Active' AND expiry_ts <= ?")
    .all(nowS) as { pubkey: string; owner: string; ticker: string | null; quote_id: string | null; expiry_ts: number }[];
  for (const p of due) {
    if (!p.ticker || !p.quote_id) continue;
    try {
      // Settle whenever Gemini has a result (settle stays valid while Active). Unwind only if there is
      // still no usable result after the grace period.
      const ev = await ctx.markets.getEvent(p.ticker, 10_000);
      if (ev.status !== "settled") {
        if (nowS > p.expiry_ts + graceSecs) {
          const sig = await ctx.chain.unwind(new PublicKey(p.pubkey), new PublicKey(p.owner));
          ctx.log.info(`[scheduler] unwound ${p.pubkey}: ${sig}`);
          setPosition(ctx.db, p.pubkey, { state: "Unwound", unwound_sig: sig });
          ctx.hub.publish(p.pubkey, "unwound", { position: p.pubkey, signature: sig });
        }
        continue;
      }
      const ladder = normalizeEvent(ev, { allowUnquoted: true, categoricalAllowlist: config.categoricalAllowlist });
      const o = outcomeBucket(ladder, ev);
      if (!o || !o.consistent || o.bucket < 0) {
        ctx.log.warn(`[scheduler] ${p.pubkey}: settlement inconsistent (${o?.detail}); leaving for unwind`);
        continue;
      }
      const q = ctx.db.prepare("SELECT preimage_json FROM quotes WHERE id = ?").get(p.quote_id) as { preimage_json: string };
      const pre = JSON.parse(q.preimage_json) as { belief: number[]; marketProb: number[] };
      const score = scoreBps(pre.belief, pre.marketProb, o.bucket);
      const sig = await ctx.chain.settle(new PublicKey(p.pubkey), new PublicKey(p.owner), o.bucket, score);
      ctx.log.info(`[scheduler] settled ${p.pubkey} bucket=${o.bucket} score=${score}: ${sig}`);
      // Record our own transaction now; the Stream's PositionSettled event later confirms the same values.
      const sched = JSON.parse((ctx.db.prepare("SELECT schedule_json FROM positions WHERE pubkey = ?").get(p.pubkey) as { schedule_json: string }).schedule_json) as string[];
      setPosition(ctx.db, p.pubkey, {
        state: "Settled",
        settled_sig: sig,
        outcome_bucket: o.bucket,
        score_bps: score,
        payout_base: String(sched[o.bucket]),
        note: `Outcome: ${o.detail} (Gemini settlement ${o.settlementValue ?? "n/a"}).`,
      });
      ctx.hub.publish(p.pubkey, "settled", { position: p.pubkey, signature: sig, bucket: o.bucket, scoreBps: score });
    } catch (err) {
      ctx.log.warn(`[scheduler] ${p.pubkey}: ${(err as Error).message.slice(0, 200)}`);
    }
  }
}

export { compile };
