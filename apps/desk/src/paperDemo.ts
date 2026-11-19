import { createHash, randomUUID } from "node:crypto";
import type { DB } from "./db";
import { PAPER_START_BASE, ensureAccount, portfolio, type LadderInfo, type PaperMarkets } from "./paper";

/**
 * A demo portfolio for a new paper account, so the portfolio pages have something to show: six months
 * of history ending about two-thirds up on the starting cash, through a volatile path. It has two parts:
 *
 *  - Open positions on today's live markets, filled at Gemini's real prices like any paper trade (the
 *    caller supplies `openLive`, which quotes and fills them). They're real paper positions to sell or
 *    add to.
 *  - Closed and settled positions on made-up past markets, flagged demo, which carry the realized
 *    gains. Their trades, and the account's value history before today, are sample data, and the
 *    pages say so.
 *
 * The ledger stays exact: cash = starting cash + realized results − what's in open positions, and the
 * history ends at the account's real value now.
 */

/** Where the demo account ends up: starting cash × this. */
export const DEMO_GROWTH = 1.67;
const DAY = 86_400_000;
/** Daily volatility of the demo history's random walk (log terms). */
const DAILY_VOL = 0.035;

/** A small deterministic PRNG (mulberry32), seeded per account so a demo looks the same on every load. */
function rng(seed: string) {
  let a = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/**
 * A volatile path from v0 to v1 over the given times: a log random walk pinned at both ends (a
 * Brownian bridge), so it wanders like a market but starts and finishes exactly where it must.
 */
export function bridgePath(times: number[], v0: number, v1: number, dailyVol: number, r: () => number): number[] {
  const t0 = times[0];
  const T = times[times.length - 1] - t0;
  const w: number[] = [0];
  for (let i = 1; i < times.length; i++) w.push(w[i - 1] + normal(r) * dailyVol * Math.sqrt((times[i] - times[i - 1]) / DAY));
  const wT = w[w.length - 1];
  const drift = Math.log(v1 / v0);
  return times.map((t, i) => {
    const u = T > 0 ? (t - t0) / T : 1;
    return v0 * Math.exp(w[i] - u * wT + u * drift);
  });
}

/** History timestamps: every 4 hours back to the start, every 15 minutes over the last 5 days, every 5 minutes over the last day. */
function historyTimes(start: number, end: number): number[] {
  const out: number[] = [];
  for (let t = start; t < end - 5 * DAY; t += 4 * 3_600_000) out.push(t);
  for (let t = Math.max(start, end - 5 * DAY); t < end - DAY; t += 15 * 60_000) out.push(t);
  for (let t = Math.max(start, end - DAY); t < end; t += 5 * 60_000) out.push(t);
  out.push(end);
  return out;
}

/**
 * A made-up past market and what the demo held on it. Price ladders list their strikes and the price
 * the market settled at; named-outcome markets list their outcomes and the winner. Every contract's
 * result then follows from that, as on a real exchange: a YES "X or above" pays $1 if it settled at X
 * or higher and a NO pays if it settled below X; a named outcome's YES pays if it won and its NO if it
 * didn't. Nothing is marked by hand, so the results can't contradict each other.
 */
interface PastTrade {
  /** From the market's settle date ("October 22") and its month ("October 2026"), since the demo's dates are relative to today. */
  title: (day: string, month: string) => string;
  category: string;
  view: string;
  /** Price ladders: the strikes, and where the price settled (null: sold before it settled). */
  strikes?: number[];
  settleAt?: number | null;
  /** Named outcomes: the outcomes, and the winner (null: sold before it settled). */
  outcomes?: string[];
  winner?: string | null;
  daysAgoOpened: number;
  daysHeld: number;
  invested: number;
  /** Share of the account's realized total this trade aims to carry (negative: a loss). */
  weight: number;
  /** Price ladders: `strike`; named outcomes: `outcome`. `price` is the listed price before scaling. */
  legs: { strike?: number; outcome?: string; side: "yes" | "no"; price: number }[];
}

const money = (v: number) => `$${v >= 100 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(2)}`;
const legLabel = (l: PastTrade["legs"][number]) => (l.outcome ?? `${money(l.strike!)} or above`);
const isSettled = (p: PastTrade) => (p.strikes ? p.settleAt !== null && p.settleAt !== undefined : p.winner !== null && p.winner !== undefined);

/** The market's outcomes in order (a price ladder's buckets between its strikes). */
function outcomesOf(p: PastTrade): string[] {
  if (p.outcomes) return p.outcomes;
  const s = p.strikes!;
  return [`Below ${money(s[0])}`, ...s.slice(1).map((x, i) => `${money(s[i])} to ${money(x)}`), `${money(s[s.length - 1])} or above`];
}
/** Which outcome it settled on (index), or null when it was sold first. */
function settledBucket(p: PastTrade): number | null {
  if (!isSettled(p)) return null;
  if (p.outcomes) return p.outcomes.indexOf(p.winner!);
  return p.strikes!.filter((x) => p.settleAt! >= x).length;
}
/** Whether a contract paid $1 at settlement, from the result alone. */
function wins(p: PastTrade, l: PastTrade["legs"][number]): boolean {
  const yes = p.strikes ? p.settleAt! >= l.strike! : p.winner === l.outcome;
  return l.side === "yes" ? yes : !yes;
}

/** Made-up past markets in the shape of Gemini's: real kinds of question, invented results. Several winners carry losing hedges. */
const PAST: PastTrade[] = [
  {
    title: (d) => `BTC price on ${d}`, category: "Crypto", view: "Higher · above $61,500",
    strikes: [58000, 60000, 62000, 64000, 66000], settleAt: 63400,
    daysAgoOpened: 178, daysHeld: 9, invested: 2400, weight: 0.22,
    legs: [{ strike: 60000, side: "yes", price: 0.62 }, { strike: 62000, side: "yes", price: 0.41 }, { strike: 64000, side: "yes", price: 0.22 }, { strike: 66000, side: "yes", price: 0.1 }, { strike: 58000, side: "no", price: 0.14 }],
  },
  {
    title: (d) => `ETH price on ${d}`, category: "Crypto", view: "Stays near · around $1,950",
    strikes: [1850, 1900, 2000, 2050], settleAt: null,
    daysAgoOpened: 150, daysHeld: 6, invested: 900, weight: -0.06,
    legs: [{ strike: 1850, side: "yes", price: 0.71 }, { strike: 1900, side: "yes", price: 0.58 }, { strike: 2000, side: "no", price: 0.6 }, { strike: 2050, side: "no", price: 0.68 }],
  },
  {
    title: (_d, m) => `Fed decision in ${m}?`, category: "Economics", view: "Your own odds · No change more likely",
    outcomes: ["Cut 25 bps", "No change", "Hike"], winner: "No change",
    daysAgoOpened: 131, daysHeld: 15, invested: 1500, weight: 0.15,
    legs: [{ outcome: "No change", side: "yes", price: 0.58 }, { outcome: "Hike", side: "no", price: 0.91 }, { outcome: "Cut 25 bps", side: "yes", price: 0.33 }],
  },
  {
    title: (d) => `Gold price on ${d}`, category: "Commodities", view: "Lower · below $3,320",
    strikes: [3200, 3250, 3300, 3350, 3400], settleAt: 3285,
    daysAgoOpened: 106, daysHeld: 11, invested: 1800, weight: -0.05,
    legs: [{ strike: 3200, side: "no", price: 0.2 }, { strike: 3250, side: "no", price: 0.34 }, { strike: 3300, side: "no", price: 0.52 }, { strike: 3350, side: "no", price: 0.69 }, { strike: 3400, side: "yes", price: 0.12 }],
  },
  {
    title: (d) => `SOL price on ${d}`, category: "Crypto", view: "Big move · far from $140",
    strikes: [120, 125, 130, 150, 155, 160], settleAt: 157.3,
    daysAgoOpened: 79, daysHeld: 8, invested: 2200, weight: 0.2,
    legs: [{ strike: 150, side: "yes", price: 0.27 }, { strike: 155, side: "yes", price: 0.19 }, { strike: 160, side: "yes", price: 0.12 }, { strike: 130, side: "no", price: 0.28 }, { strike: 125, side: "no", price: 0.19 }, { strike: 120, side: "no", price: 0.12 }],
  },
  {
    title: (d) => `Oil (WTI) price on ${d}`, category: "Commodities", view: "Higher · above $68",
    strikes: [66, 68, 70, 72], settleAt: null,
    daysAgoOpened: 61, daysHeld: 5, invested: 700, weight: -0.04,
    legs: [{ strike: 68, side: "yes", price: 0.46 }, { strike: 70, side: "yes", price: 0.29 }, { strike: 72, side: "yes", price: 0.15 }],
  },
  {
    title: (d) => `BTC price on ${d}`, category: "Crypto", view: "Higher · above $66,000",
    strikes: [64000, 66000, 68000, 70000, 72000], settleAt: 69150,
    daysAgoOpened: 38, daysHeld: 10, invested: 3000, weight: 0.33,
    legs: [{ strike: 64000, side: "yes", price: 0.75 }, { strike: 66000, side: "yes", price: 0.55 }, { strike: 68000, side: "yes", price: 0.35 }, { strike: 70000, side: "yes", price: 0.2 }, { strike: 72000, side: "yes", price: 0.1 }, { strike: 64000, side: "no", price: 0.27 }],
  },
  {
    title: (d) => `XRP price on ${d}`, category: "Crypto", view: "Lower · below $1.10",
    strikes: [1, 1.05, 1.1, 1.15, 1.2], settleAt: 0.97,
    daysAgoOpened: 19, daysHeld: 7, invested: 1400, weight: 0.2,
    legs: [{ strike: 1, side: "no", price: 0.31 }, { strike: 1.05, side: "no", price: 0.42 }, { strike: 1.1, side: "no", price: 0.55 }, { strike: 1.2, side: "no", price: 0.78 }, { strike: 1, side: "yes", price: 0.71 }],
  },
];

/**
 * A demo trade's fills, consistent with how it ended. The stake is split evenly across its contracts
 * and every listed price is scaled by one factor, so the ladder stays in order (a higher strike's YES is
 * always cheaper). Settled: winners pay $1 each and losers nothing, and the factor is chosen so the
 * winners pay back about `want`. Sold: every contract sells at a price that returns about `want` in
 * all. Buys total what was invested, fees included (about 2%).
 */
function demoFills(p: PastTrade, k: number, invested: number, want: number) {
  const FEE = 0.02;
  const settled = isSettled(p);
  const per = invested / p.legs.length;
  const won = p.legs.map((l) => settled && wins(p, l));
  const winners = p.legs.filter((_, i) => won[i]);
  const s = settled && winners.length && want > 0 ? winners.reduce((acc, l) => acc + per / l.price, 0) / ((1 + FEE) * want) : 1;
  const buys = p.legs.map((l, i) => {
    const price = Math.min(0.97, Math.max(0.02, Math.round(l.price * s * 100) / 100));
    const label = legLabel(l);
    return { symbol: `DEMO-${k + 1}-${label}-${l.side}`, side: l.side, label, qty: Math.round((per / ((1 + FEE) * price)) * 100) / 100, price, feeBase: Math.round(((per * FEE) / (1 + FEE)) * 1e6), won: won[i] };
  });
  let exits: { symbol: string; side: "yes" | "no"; label: string; qty: number; price: number; feeBase: number }[];
  if (settled) exits = buys.map((b) => ({ symbol: b.symbol, side: b.side, label: b.label, qty: b.qty, price: b.won ? 1 : 0, feeBase: 0 }));
  else {
    // Sold: each contract fetches its share of `want`, after a 1% sell fee.
    const total = buys.reduce((acc, b) => acc + b.qty * b.price, 0);
    exits = buys.map((b) => {
      const share = (want * (b.qty * b.price)) / total;
      const price = Math.min(0.99, Math.max(0.01, Math.round(((share * 1.01) / b.qty) * 100) / 100));
      return { symbol: b.symbol, side: b.side, label: b.label, qty: b.qty, price, feeBase: Math.round(b.qty * price * 0.01 * 1e6) };
    });
  }
  const returned = Math.round(exits.reduce((acc, e) => acc + e.qty * e.price - e.feeBase / 1e6, 0) * 100) / 100;
  return { buys: buys.map(({ won: _w, ...b }) => b), exits, returned };
}

/**
 * Insert the demo's past trades for an account, aiming their results at `realized` in total. Dates are
 * relative to `now`. Returns what they actually realized (rounding makes it differ by cents or dollars).
 */
function insertPast(db: DB, account: string, realized: number, now: number, r: () => number): number {
  const totalWeight = PAST.reduce((s, p) => s + p.weight, 0);
  let booked = 0;
  PAST.forEach((p, k) => {
    const target = k === PAST.length - 1 ? realized - booked : (realized * p.weight) / totalWeight;
    const settled = isSettled(p);
    const { buys, exits, returned } = demoFills(p, k, p.invested, Math.max(0, p.invested + target));
    // What the rounded fills actually cost, so every contract's result adds up to the position's.
    const invested = Math.round(buys.reduce((acc, b) => acc + b.qty * b.price + b.feeBase / 1e6, 0) * 100) / 100;
    const result = Math.round((returned - invested) * 100) / 100;
    booked += result;
    const opened = now - p.daysAgoOpened * DAY + Math.floor(r() * 6) * 3_600_000;
    const closed = opened + p.daysHeld * DAY;
    const id = randomUUID();
    // The market settles on the day the position closed (sold ones a few days after they were sold).
    const settleAt = settled ? closed : closed + 4 * DAY;
    const day = new Date(settleAt).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "America/New_York" });
    const month = new Date(settleAt).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "America/New_York" });
    const outcomes = outcomesOf(p);
    const bucket = settledBucket(p);
    const info: LadderInfo = {
      kind: p.strikes ? "threshold" : "categorical",
      bucketLabels: outcomes,
      cutLabels: [],
      cuts: null,
      unit: { prefix: "$", suffix: "" },
      symbols: [],
      marketProb: outcomes.map(() => 1 / outcomes.length),
    };
    db.prepare(
      `INSERT INTO paper_positions (id, account, ticker, title, category, strategy, view_label, request_json, ladder_json, expiry, status, cash_base, cost_base, realized_base, payout_base, outcome_bucket, outcome_label, opened_at, updated_at, closed_at, demo)
       VALUES (?, ?, ?, ?, ?, 'view', ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).run(
      id,
      account,
      `DEMO-${k + 1}`,
      p.title(day, month),
      p.category,
      p.view,
      JSON.stringify({ belief: [], confidence: 0.75 }),
      JSON.stringify(info),
      new Date(settleAt).toISOString(),
      settled ? "settled" : "closed",
      Math.round(result * 1e6),
      settled ? Math.round(returned * 1e6) : null,
      bucket,
      bucket !== null ? outcomes[bucket] : null,
      opened,
      closed,
      closed,
    );
    const trade = db.prepare("INSERT INTO paper_trades (account, position, kind, quote_id, cash_base, realized_base, detail_json, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)");
    trade.run(account, id, "open", -Math.round(invested * 1e6), 0, JSON.stringify({ fills: buys, demo: true }), opened);
    trade.run(
      account,
      id,
      settled ? "settle" : "sell",
      Math.round(returned * 1e6),
      Math.round(result * 1e6),
      JSON.stringify({ fills: exits, demo: true, ...(settled ? { outcome: bucket !== null ? outcomes[bucket] : null } : { fraction: 1 }) }),
      closed,
    );
    // Its value over its life, daily.
    const days = Array.from({ length: p.daysHeld + 1 }, (_, i) => opened + i * DAY);
    const path = bridgePath(days, invested, Math.max(0.01, returned), 0.06, r);
    const markIns = db.prepare("INSERT OR REPLACE INTO paper_marks (owner, at, value_base) VALUES (?, ?, ?)");
    days.forEach((t, i) => markIns.run(id, t, Math.round(path[i] * 1e6)));
  });
  return booked;
}

/** Bumped when the demo's past trades change: accounts with an older demo get theirs replaced in place. */
export const DEMO_VERSION = 2;

/**
 * Seed the demo for `account` if it's due (a new account, or one reset with the demo), or bring an older
 * demo's past trades up to date. Safe to call on every load: only the first caller seeds, and an account
 * that opted out is left alone.
 */
export async function ensureDemo(db: DB, markets: PaperMarkets, account: string, openLive: (account: string) => Promise<void>) {
  const acct = ensureAccount(db, account);
  if (acct.demo_state === "seeded" && (acct.demo_v ?? 1) < DEMO_VERSION) return refreshPast(db, account, acct.demo_at ?? Date.now());
  if (acct.demo_state !== null) return;
  const claimed = db.prepare("UPDATE paper_accounts SET demo_state = 'seeding' WHERE id = ? AND demo_state IS NULL").run(account).changes === 1;
  if (!claimed) return;
  try {
    await seedDemo(db, markets, account, openLive);
    db.prepare("UPDATE paper_accounts SET demo_state = 'seeded', demo_at = ?, demo_v = ? WHERE id = ?").run(Date.now(), DEMO_VERSION, account);
  } catch (err) {
    console.warn("[paper demo]", (err as Error).message);
    db.prepare("UPDATE paper_accounts SET demo_state = 'empty' WHERE id = ?").run(account);
  }
}

/**
 * Swap an older demo's past trades for the current ones, realizing the same total, so the account's
 * cash and value history stay as they were. Real paper trades are untouched.
 */
function refreshPast(db: DB, account: string, demoAt: number) {
  db.transaction(() => {
    const old = db.prepare("SELECT id, realized_base FROM paper_positions WHERE account = ? AND demo = 1").all(account) as { id: string; realized_base: number }[];
    const oldRealized = old.reduce((s, p) => s + p.realized_base, 0) / 1e6;
    for (const p of old) {
      db.prepare("DELETE FROM paper_trades WHERE position = ?").run(p.id);
      db.prepare("DELETE FROM paper_marks WHERE owner = ?").run(p.id);
      db.prepare("DELETE FROM paper_legs WHERE position = ?").run(p.id);
      db.prepare("DELETE FROM paper_positions WHERE id = ?").run(p.id);
    }
    const booked = insertPast(db, account, oldRealized, demoAt, rng(`${account}:v${DEMO_VERSION}`));
    db.prepare("UPDATE paper_accounts SET cash_base = cash_base + ?, demo_v = ? WHERE id = ?").run(Math.round((booked - oldRealized) * 1e6), DEMO_VERSION, account);
  })();
}

async function seedDemo(db: DB, markets: PaperMarkets, account: string, openLive: (account: string) => Promise<void>) {
  const now = Date.now();
  const r = rng(account);

  // 1. Open positions at today's real prices (best-effort: none if Gemini is unavailable).
  try {
    await openLive(account);
  } catch (err) {
    console.warn("[paper demo] live positions skipped:", (err as Error).message);
  }
  const live = await portfolio(db, markets, account, { record: false });
  const openPnl = live.totals.positionsUsd - live.positions.filter((p) => p.status === "open").reduce((s, p) => s + p.costUsd, 0);

  // 2. Past trades carrying the realized result that lands the account on its target.
  const start = PAPER_START_BASE / 1e6;
  db.transaction(() => {
    const booked = insertPast(db, account, start * (DEMO_GROWTH - 1) - openPnl, now, r);
    db.prepare("UPDATE paper_accounts SET cash_base = cash_base + ?, created_at = ?, updated_at = ? WHERE id = ?").run(Math.round(booked * 1e6), now - 182 * DAY, now, account);
  })();

  // 3. The account's history: six months from the starting cash to its real value now.
  const after = await portfolio(db, markets, account, { record: false });
  const times = historyTimes(now - 182 * DAY, now - 60_000);
  const path = bridgePath(times, start, after.totals.totalUsd, DAILY_VOL, r);
  db.transaction(() => {
    db.prepare("DELETE FROM paper_marks WHERE owner = ?").run(`acct:${account}`);
    const ins = db.prepare("INSERT OR REPLACE INTO paper_marks (owner, at, value_base) VALUES (?, ?, ?)");
    times.forEach((t, i) => ins.run(`acct:${account}`, t, Math.round(path[i] * 1e6)));
  })();
}
