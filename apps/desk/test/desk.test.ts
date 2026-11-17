import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { assertLiveAllowed, executionMode } from "@contour/gemini/signed";
import { decodeEvents } from "@contour/chain";
import { migrate } from "../src/db";
import { extractTxs, verifyQuicknode } from "../src/routes/hooks";
import { handleStreamTx, type HandlerCtx } from "../src/handler";
import { LiveExecutor } from "../src/executor";

describe("live order guard", () => {
  it("refuses unless both flags are set", () => {
    expect(() => assertLiveAllowed({} as NodeJS.ProcessEnv)).toThrow();
    expect(() => assertLiveAllowed({ EXECUTION_MODE: "live" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => assertLiveAllowed({ ALLOW_LIVE_ORDERS: "true" } as NodeJS.ProcessEnv)).toThrow();
    expect(() => assertLiveAllowed({ EXECUTION_MODE: "live", ALLOW_LIVE_ORDERS: "true" } as NodeJS.ProcessEnv)).not.toThrow();
  });
  it("defaults to paper and the live executor cannot be built without the flags", () => {
    expect(executionMode({} as NodeJS.ProcessEnv)).toBe("paper");
    const prev = { ...process.env };
    delete process.env.EXECUTION_MODE;
    delete process.env.ALLOW_LIVE_ORDERS;
    expect(() => new LiveExecutor()).toThrow();
    process.env = prev;
  });
});

describe("QuickNode webhook", () => {
  const token = "secret";
  const sign = (nonce: string, ts: string, body: string) => createHmac("sha256", token).update(nonce + ts + body).digest("hex");
  it("verifies HMAC(nonce + timestamp + body)", () => {
    const body = JSON.stringify([{ signature: "s", logs: [] }]);
    const h = { "x-qn-nonce": "n", "x-qn-timestamp": "1", "x-qn-signature": sign("n", "1", body) };
    expect(verifyQuicknode(token, h, body)).toBe(true);
    expect(verifyQuicknode(token, h, body + " ")).toBe(false);
    expect(verifyQuicknode(token, { ...h, "x-qn-signature": "00" }, body)).toBe(false);
    expect(verifyQuicknode(token, {}, body)).toBe(false);
  });
  it("extracts transactions from filter output and raw block shapes", () => {
    expect(extractTxs([{ signature: "a", slot: 1, blockTime: 2, logs: ["x"] }])).toEqual([{ signature: "a", slot: 1, blockTime: 2, logs: ["x"] }]);
    const block = { data: [{ slot: 9, blockTime: 10, transactions: [{ transaction: { signatures: ["b"] }, meta: { logMessages: ["y"] } }] }] };
    expect(extractTxs(block)).toEqual([{ signature: "b", slot: 9, blockTime: 10, logs: ["y"] }]);
  });
});

const realTx = JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/raw/position_opened_tx.json"), "utf8")) as { signature: string; logs: string[] };

describe("event handler", () => {
  it("decodes a real PositionOpened, is idempotent, and refuses a schedule that differs from the quote", async () => {
    const [ev] = decodeEvents(realTx.logs);
    expect(ev.name).toBe("PositionOpened");
    const d = Object.fromEntries(Object.entries(ev.data).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), v])) as Record<string, any>;
    const db = new Database(":memory:");
    migrate(db);
    const hash = String(d.forecastHash);
    const schedule = (d.schedule as string[]).map((x, i) => (i === 0 ? String(Number(x) + 1) : x)); // tamper one bucket
    const quote = {
      quoteId: "q1",
      ticker: "T",
      title: "T",
      forecastHash: hash,
      marketIdHex: String(d.marketId),
      scheduleBaseUnits: schedule,
      stakeBaseUnits: String(d.stake),
      expiryTs: Number(d.expiryTs),
      quote: { legs: [], cashUsd: 100 },
    };
    db.prepare("INSERT INTO quotes (id, ticker, forecast_hash, preimage_json, quote_json, schedule_json, stake_base, expiry_ts, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
      "q1", "T", hash, "{}", JSON.stringify(quote), "[]", String(d.stake), Number(d.expiryTs), Number(d.openedTs) * 1000,
    );
    const accept = vi.fn(async () => "acceptsig");
    const ctx = {
      db,
      hub: { publish: vi.fn() },
      markets: { getEvent: vi.fn(async () => ({ contracts: [] })) },
      executor: { mode: "paper", place: vi.fn() },
      chain: { accept },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as HandlerCtx;
    await handleStreamTx(ctx, realTx, "test");
    await handleStreamTx(ctx, realTx, "test");
    expect(accept).not.toHaveBeenCalled();
    const row = db.prepare("SELECT state, note FROM positions WHERE pubkey = ?").get(String(d.position)) as { state: string; note: string };
    expect(row.state).toBe("Open");
    expect(row.note).toMatch(/schedule differs/);
    expect((db.prepare("SELECT COUNT(*) AS n FROM stream_events").get() as { n: number }).n).toBe(1);

    // With the matching schedule (and no legs to re-price) the desk accepts exactly once.
    const db2 = new Database(":memory:");
    migrate(db2);
    db2.prepare("INSERT INTO quotes (id, ticker, forecast_hash, preimage_json, quote_json, schedule_json, stake_base, expiry_ts, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(
      "q1", "T", hash, "{}", JSON.stringify({ ...quote, scheduleBaseUnits: d.schedule, quote: { legs: [], cashUsd: Number(d.stake) / 1e6 } }), "[]", String(d.stake), Number(d.expiryTs), Number(d.openedTs) * 1000,
    );
    const ctx2 = { ...ctx, db: db2 } as HandlerCtx;
    await handleStreamTx(ctx2, realTx, "test");
    await handleStreamTx(ctx2, realTx, "test");
    expect(accept).toHaveBeenCalledTimes(1);
  });
});
