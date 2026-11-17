import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type DB = Database.Database;

export function openDb(path = process.env.DB_PATH ?? resolve(process.cwd(), "../../data/desk.sqlite")): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ladders (
      ticker TEXT PRIMARY KEY,
      series TEXT, title TEXT, category TEXT, template TEXT,
      expiry TEXT NOT NULL,
      contracts_json TEXT NOT NULL,          -- static contract fields keyed by instrumentSymbol
      first_seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      captured_at INTEGER NOT NULL,          -- unix ms
      prices_json TEXT NOT NULL              -- {symbol: [yesAsk, noAsk, bestBid, bestAsk]}
    );
    CREATE INDEX IF NOT EXISTS snapshots_ticker ON snapshots(ticker, captured_at);
    CREATE TABLE IF NOT EXISTS outcomes (
      ticker TEXT PRIMARY KEY,
      resolved_at TEXT,
      settlement_value TEXT,
      sides_json TEXT NOT NULL,              -- {symbol: "yes" | "no"}
      checked_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL,
      forecast_hash TEXT NOT NULL,
      preimage_json TEXT NOT NULL,
      quote_json TEXT NOT NULL,
      schedule_json TEXT NOT NULL,           -- base units as decimal strings
      stake_base TEXT NOT NULL,
      expiry_ts INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS quotes_hash ON quotes(forecast_hash);
    CREATE TABLE IF NOT EXISTS positions (
      pubkey TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      ticker TEXT,
      quote_id TEXT,
      forecast_hash TEXT,
      state TEXT NOT NULL,
      stake_base TEXT, max_payout_base TEXT, schedule_json TEXT,
      expiry_ts INTEGER,
      opened_sig TEXT, accepted_sig TEXT, settled_sig TEXT, cancelled_sig TEXT, unwound_sig TEXT,
      outcome_bucket INTEGER, score_bps INTEGER, payout_base TEXT,
      note TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS positions_owner ON positions(owner);
    CREATE TABLE IF NOT EXISTS fills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position TEXT NOT NULL,
      symbol TEXT NOT NULL, side TEXT NOT NULL, strike REAL,
      qty REAL NOT NULL, price REAL, quoted_price REAL NOT NULL,
      mode TEXT NOT NULL, status TEXT NOT NULL,   -- filled | unfilled
      detail_json TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stream_events (
      signature TEXT NOT NULL,
      idx INTEGER NOT NULL,
      slot INTEGER, block_time INTEGER,
      name TEXT NOT NULL, payload_json TEXT NOT NULL,
      source TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      PRIMARY KEY (signature, idx)
    );
    CREATE TABLE IF NOT EXISTS faucet_claims (
      owner TEXT PRIMARY KEY, last_at INTEGER NOT NULL, count INTEGER NOT NULL
    );
  `);
}
