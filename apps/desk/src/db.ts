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
  // Direct-payment positions (see recordDirectPayment) name the wallet that was paid.
  const cols = db.prepare("PRAGMA table_info(positions)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "pay_to")) db.exec("ALTER TABLE positions ADD COLUMN pay_to TEXT");
  // Simulated ladders written by scripts/seed-sim.ts for the demo (never by the recorder), so replay can say so.
  const ladderCols = db.prepare("PRAGMA table_info(ladders)").all() as { name: string }[];
  if (!ladderCols.some((c) => c.name === "demo")) db.exec("ALTER TABLE ladders ADD COLUMN demo INTEGER NOT NULL DEFAULT 0");
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

    -- Paper trading: a per-browser account whose positions fill at Gemini's live prices, without a wallet.
    CREATE TABLE IF NOT EXISTS paper_accounts (
      id TEXT PRIMARY KEY,
      cash_base INTEGER NOT NULL,            -- USDC base units (6 dp) not in any position
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS paper_positions (
      id TEXT PRIMARY KEY,
      account TEXT NOT NULL,
      ticker TEXT NOT NULL, title TEXT NOT NULL, category TEXT,
      strategy TEXT NOT NULL,                -- view | near | spread | protect
      view_label TEXT,
      request_json TEXT NOT NULL,            -- how to quote more of the same: belief, confidence, protect/spread/shape
      ladder_json TEXT NOT NULL,             -- outcome labels, cuts, unit and contract order at open
      expiry TEXT NOT NULL,
      status TEXT NOT NULL,                  -- open | closed | settled
      cash_base INTEGER NOT NULL,            -- cash held in the position (paid back in every outcome)
      cost_base INTEGER NOT NULL,            -- cost basis of what's still held
      realized_base INTEGER NOT NULL DEFAULT 0,
      payout_base INTEGER, outcome_bucket INTEGER, outcome_label TEXT,
      opened_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS paper_positions_account ON paper_positions(account, opened_at);
    CREATE TABLE IF NOT EXISTS paper_legs (
      position TEXT NOT NULL,
      symbol TEXT NOT NULL, side TEXT NOT NULL,
      label TEXT NOT NULL, strike REAL,
      qty REAL NOT NULL,
      cost_base INTEGER NOT NULL,            -- contracts at their fill prices, excluding fees
      fee_base INTEGER NOT NULL,             -- buy fees paid
      pays_json TEXT NOT NULL,               -- per outcome: 1 if this contract pays $1 there
      entry_mark_base INTEGER,               -- worth at the mark when filled: separates entry cost from market moves
      PRIMARY KEY (position, symbol, side)
    );
    CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account TEXT NOT NULL, position TEXT NOT NULL,
      kind TEXT NOT NULL,                    -- open | add | sell | settle
      quote_id TEXT UNIQUE,                  -- a quote fills at most once
      cash_base INTEGER NOT NULL,            -- signed flow into the account's cash
      realized_base INTEGER NOT NULL DEFAULT 0,
      detail_json TEXT NOT NULL,             -- the fills: legs with qty, price, fee
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS paper_trades_account ON paper_trades(account, id);
    CREATE INDEX IF NOT EXISTS paper_trades_position ON paper_trades(position, id);
    CREATE TABLE IF NOT EXISTS paper_marks (
      owner TEXT NOT NULL,                   -- a position id, or "acct:<account>" for the whole account
      at INTEGER NOT NULL,
      value_base INTEGER NOT NULL,
      PRIMARY KEY (owner, at)
    );
  `);
  // Columns added after the paper tables first shipped.
  const legCols = db.prepare("PRAGMA table_info(paper_legs)").all() as { name: string }[];
  if (!legCols.some((c) => c.name === "entry_mark_base")) db.exec("ALTER TABLE paper_legs ADD COLUMN entry_mark_base INTEGER");
  // Demo portfolios: accounts made before demos existed are "legacy" and never get one; a new account
  // starts with demo_state NULL and is seeded on its first load (see paperDemo.ts).
  const acctCols = db.prepare("PRAGMA table_info(paper_accounts)").all() as { name: string }[];
  if (!acctCols.some((c) => c.name === "demo_state")) db.exec("ALTER TABLE paper_accounts ADD COLUMN demo_state TEXT DEFAULT 'legacy'");
  if (!acctCols.some((c) => c.name === "demo_at")) db.exec("ALTER TABLE paper_accounts ADD COLUMN demo_at INTEGER");
  // Which demo a seeded account has (older demos get their past trades replaced in place).
  if (!acctCols.some((c) => c.name === "demo_v")) db.exec("ALTER TABLE paper_accounts ADD COLUMN demo_v INTEGER DEFAULT 1");
  const posCols = db.prepare("PRAGMA table_info(paper_positions)").all() as { name: string }[];
  if (!posCols.some((c) => c.name === "demo")) db.exec("ALTER TABLE paper_positions ADD COLUMN demo INTEGER NOT NULL DEFAULT 0");
}
