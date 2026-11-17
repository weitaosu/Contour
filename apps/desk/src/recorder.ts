import { GeminiPublicClient, type RawContract, type RawEvent } from "@contour/gemini";
import type { DB } from "./db";

const num = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

function quotedCount(e: RawEvent) {
  return e.contracts.filter((c) => c.prices?.buy?.yes && c.prices?.buy?.no).length;
}

/** Ladders we record: crypto price ladders (hourly, daily, weekly, monthly) and quoted weather ladders. */
export function isRecorded(e: RawEvent): boolean {
  if (e.template === "prices-ladder" && e.contracts.length >= 3) return true;
  if (e.category === "Weather" && e.ticker.startsWith("WX") && quotedCount(e) >= 3) return true;
  return false;
}

function staticContract(c: RawContract) {
  return {
    label: c.label,
    ticker: c.ticker,
    instrumentSymbol: c.instrumentSymbol,
    strike: c.strike,
    quantityMinimum: c.quantityMinimum,
    quantityIncrement: c.quantityIncrement,
    priceIncrement: c.priceIncrement,
    expiryDate: c.expiryDate,
  };
}

export function recordEvents(db: DB, events: RawEvent[], now = Date.now()) {
  const getLadder = db.prepare("SELECT contracts_json FROM ladders WHERE ticker = ?");
  const upsertLadder = db.prepare(`INSERT INTO ladders (ticker, series, title, category, template, expiry, contracts_json, first_seen)
    VALUES (@ticker, @series, @title, @category, @template, @expiry, @contracts_json, @first_seen)
    ON CONFLICT(ticker) DO UPDATE SET contracts_json = excluded.contracts_json, expiry = excluded.expiry, title = excluded.title`);
  const insSnap = db.prepare("INSERT INTO snapshots (ticker, captured_at, prices_json) VALUES (?, ?, ?)");
  let n = 0;
  const tx = db.transaction(() => {
    for (const e of events) {
      if (!isRecorded(e)) continue;
      const prev = getLadder.get(e.ticker) as { contracts_json: string } | undefined;
      const contracts: Record<string, unknown> = prev ? JSON.parse(prev.contracts_json) : {};
      for (const c of e.contracts) contracts[c.instrumentSymbol] = staticContract(c);
      upsertLadder.run({
        ticker: e.ticker,
        series: e.series ?? null,
        title: e.title,
        category: e.category,
        template: e.template ?? null,
        expiry: e.expiryDate,
        contracts_json: JSON.stringify(contracts),
        first_seen: now,
      });
      const prices: Record<string, (number | null)[]> = {};
      for (const c of e.contracts) {
        const p = c.prices ?? {};
        prices[c.instrumentSymbol] = [num(p.buy?.yes), num(p.buy?.no), num(p.bestBid), num(p.bestAsk)];
      }
      insSnap.run(e.ticker, now, JSON.stringify(prices));
      n++;
    }
  });
  tx();
  return n;
}

/** For recorded ladders past expiry without an outcome, fetch the event and store resolution sides. */
export async function recordOutcomes(db: DB, client: GeminiPublicClient, now = Date.now(), maxPerRun = 25) {
  const due = db
    .prepare(
      `SELECT l.ticker FROM ladders l LEFT JOIN outcomes o ON o.ticker = l.ticker
       WHERE o.ticker IS NULL AND l.expiry < ? ORDER BY l.expiry DESC LIMIT ?`,
    )
    .all(new Date(now - 15_000).toISOString(), maxPerRun) as { ticker: string }[];
  const ins = db.prepare(
    "INSERT OR REPLACE INTO outcomes (ticker, resolved_at, settlement_value, sides_json, checked_at) VALUES (?, ?, ?, ?, ?)",
  );
  let n = 0;
  for (const { ticker } of due) {
    try {
      const e = await client.getEvent(ticker);
      if (e.status !== "settled") continue;
      const sides: Record<string, string> = {};
      for (const c of e.contracts) if (c.resolutionSide) sides[c.instrumentSymbol] = c.resolutionSide;
      ins.run(ticker, e.resolvedAt ?? null, e.settlement?.value ?? null, JSON.stringify(sides), now);
      n++;
    } catch (err) {
      console.warn(`[recorder] outcome ${ticker}:`, (err as Error).message);
    }
  }
  return n;
}

export async function recordTick(db: DB, client: GeminiPublicClient) {
  const [crypto, weather] = await Promise.all([
    client.listAllEvents({ status: "active", category: "Crypto" }),
    client.listAllEvents({ status: "active", category: "Weather" }),
  ]);
  const snaps = recordEvents(db, [...crypto, ...weather]);
  const outs = await recordOutcomes(db, client);
  return { snaps, outs };
}

export function startRecorder(db: DB, client: GeminiPublicClient, intervalMs = 5 * 60_000) {
  const run = async () => {
    try {
      const r = await recordTick(db, client);
      console.log(`[recorder] ${new Date().toISOString()} snapshots=${r.snaps} outcomes=${r.outs}`);
    } catch (err) {
      console.error("[recorder] tick failed:", (err as Error).message);
    }
  };
  void run();
  return setInterval(run, intervalMs);
}
