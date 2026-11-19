/**
 * Simulated history for the demo, so Replay and the forecast record have something to show before the
 * recorder has run for days. Nothing here is presented as recorded: every row is flagged, and both
 * pages say how much of what they show is simulated.
 *
 *  - Ladders: Gemini-style price ladders (crypto and commodities) for the past few weeks, shaped like
 *    the real ones in data/gemini-snapshot.json: same tickers, labels, strike spacing and fields. Each
 *    asset follows a fat-tailed random walk that ends at today's real price, and the ladder is priced
 *    off it with a lognormal model plus a bid/ask spread, snapshotted the way the recorder does. Its
 *    outcome is where the walk ended. So the market is close to calibrated, as real ones roughly are.
 *  - A demo trader's forecast record: positions on those ladders, quoted with the desk's own compile()
 *    and escrow terms, hashed like real quotes, settled on the simulated outcome and scored with
 *    scoreBps(). The trader sees a weak, noisy signal of where the price ends, so the record shows a
 *    modest edge with plenty of losses, not a straight line up.
 *
 *   pnpm --filter @contour/desk exec tsx scripts/seed-sim.ts [--days 18] [--record-days 60] [--owner <wallet>] [--remove]
 *
 * Re-running replaces the simulated rows; --remove deletes exactly them (ladders.demo = 1, and positions
 * whose note ends with SIM_NOTE). A wallet's real positions are never touched. Deterministic: the same snapshot file gives the same data.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { compile, escrowTerms, forecastHash, fromMarket, marketIdHex, marketMoments, normalizeEvent, outcomeBucket, scoreBps } from "@contour/core";
import { config } from "../src/config";
import { openDb } from "../src/db";
import type { StoredQuote } from "../src/markets";
import { recordedEvent } from "../src/replay";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
/** The wallet the demo record belongs to: sign in with it to see the record. */
const DEMO_OWNER = "3nhsSAEBwnA3ch95U1vmuJJ6h32Fbf2uFjfSgWrNRfDm";
const OWNER = arg("--owner") ?? DEMO_OWNER;
/** Ends every simulated position's note: how they're found again, so a re-run never touches a wallet's real positions. */
const SIM_NOTE = "Simulated market for the demo.";
/** Days of simulated ladders written for Replay (it compiles three quotes per ladder, so keep this modest). */
const DAYS = Number(arg("--days") ?? 18);
/** Days of the demo trader's history. Older ladders exist only to trade on and are not written to the database. */
const RECORD_DAYS = Number(arg("--record-days") ?? 60);
const SPAN = Math.max(DAYS, RECORD_DAYS);
const REMOVE = process.argv.includes("--remove");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;
const STEP_MS = 5 * 60_000; // the recorder's cadence

// ---------------------------------------------------------------------------------------------------
// Randomness: seeded, so the demo looks the same on every run.

function rng(seed: string) {
  let a = createHash("sha256").update(seed).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
/** Student-t with 4 degrees of freedom, scaled to unit variance: fatter tails than the market prices in. */
function fatTail(r: () => number) {
  const df = 4;
  let chi = 0;
  for (let i = 0; i < df; i++) chi += gauss(r) ** 2;
  return gauss(r) / Math.sqrt(chi / df) / Math.sqrt(df / (df - 2));
}
/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function phi(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

// ---------------------------------------------------------------------------------------------------
// The assets: today's price is read from the real ladders in the snapshot file.

interface Asset {
  sym: string;
  /** What Gemini calls it in titles. */
  name: string;
  category: "Crypto" | "Commodities";
  /** Annualized volatility the market prices with. */
  vol: number;
  /** Also list hourly "today at …" ladders. */
  hourly: boolean;
}
const ASSETS: Asset[] = [
  { sym: "BTC", name: "BTC", category: "Crypto", vol: 0.5, hourly: true },
  { sym: "ETH", name: "ETH", category: "Crypto", vol: 0.65, hourly: true },
  { sym: "SOL", name: "SOL", category: "Crypto", vol: 0.8, hourly: true },
  { sym: "XRP", name: "XRP", category: "Crypto", vol: 0.75, hourly: false },
  { sym: "ZEC", name: "ZEC", category: "Crypto", vol: 1.0, hourly: false },
  { sym: "WTI", name: "Oil (WTI)", category: "Commodities", vol: 0.35, hourly: false },
  { sym: "BRENT", name: "Oil (Brent)", category: "Commodities", vol: 0.32, hourly: false },
  { sym: "XAU", name: "Gold", category: "Commodities", vol: 0.18, hourly: false },
  { sym: "XAG", name: "Silver", category: "Commodities", vol: 0.3, hourly: false },
];

interface RawContract {
  strike?: { value: string };
  prices?: { buy?: { yes?: string; no?: string }; bestBid?: string | null; bestAsk?: string | null };
}
interface RawEvent {
  ticker: string;
  template?: string;
  contracts: RawContract[];
}

/** The price where the ladder's "or above" probability crosses ½: the market's median, read from mid prices. */
function impliedMedian(e: RawEvent): number | null {
  const pts = e.contracts
    .filter((c) => c.strike && c.prices?.bestBid && c.prices?.bestAsk)
    .map((c) => ({ k: Number(c.strike!.value), p: (Number(c.prices!.bestBid) + Number(c.prices!.bestAsk)) / 2 }))
    .sort((a, b) => a.k - b.k);
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    if (a.p >= 0.5 && b.p <= 0.5 && a.p !== b.p) return a.k + ((a.p - 0.5) / (a.p - b.p)) * (b.k - a.k);
  }
  return null;
}

const snapshotFile = resolve(process.cwd(), "../../data/gemini-snapshot.json");
const snapshot = JSON.parse(readFileSync(snapshotFile, "utf8")) as { capturedAt: number; events: RawEvent[] };
const spotOf = new Map<string, number>();
for (const a of ASSETS) {
  const ladders = snapshot.events.filter((e) => e.template === "prices-ladder" && new RegExp(`^${a.sym}\\d{10}$`).test(e.ticker));
  const m = ladders.map(impliedMedian).find((x) => x !== null);
  if (m) spotOf.set(a.sym, m);
}

// ---------------------------------------------------------------------------------------------------
// Gemini's naming: tickers, strike codes, labels and titles.

const pad = (n: number) => String(n).padStart(2, "0");
const tickerTime = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
};
/** 61000 → "61000", 0.9 → "0D90", 43.5 → "43D5" (as Gemini writes strikes into contract tickers). */
const strikeCode = (value: string) => value.replace(".", "D");
const strikeLabel = (k: number) => `$${k.toLocaleString("en-US", { maximumFractionDigits: 4 })} or above`;
const et = (t: number, o: Intl.DateTimeFormatOptions) => new Date(t).toLocaleString("en-US", { timeZone: "America/New_York", ...o });
function title(a: Asset, expiry: number, hourly: boolean) {
  if (hourly) return `${a.name} price today at ${et(expiry, { hour: "numeric" }).replace(/\s/g, "").toLowerCase()} EST`; // "… today at 2pm EST"
  const day = et(expiry, { month: "long", day: "numeric" });
  return a.category === "Crypto" ? `${a.name} price on ${day}` : `${a.name} price on ${day}?`;
}
/** A round strike spacing near the target (1, 2, 2.5 or 5 × a power of ten). */
function niceStep(x: number) {
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).reduce((best, s) => (Math.abs(Math.log(s / x)) < Math.abs(Math.log(best / x)) ? s : best));
}
const decimals = (step: number) => (Number.isInteger(step) ? 0 : String(step).split(".")[1].length);

// ---------------------------------------------------------------------------------------------------
// Price paths: a log random walk at 5-minute steps, run backward from today's price so the last point
// is real. Daily volatility regimes (calm days, busy days) on top of the asset's base volatility.

const now = Math.floor(Date.now() / STEP_MS) * STEP_MS;
const start = now - (SPAN + 3) * DAY;
const steps = (now - start) / STEP_MS;
const paths = new Map<string, Float64Array>();
for (const a of ASSETS) {
  const spot = spotOf.get(a.sym);
  if (!spot) continue;
  const r = rng(`path:${a.sym}`);
  const regime: number[] = [];
  for (let d = 0; d <= SPAN + 4; d++) regime.push(Math.exp(0.3 * gauss(r) - 0.045));
  const sd = a.vol * Math.sqrt(STEP_MS / YEAR);
  const logp = new Float64Array(steps + 1);
  logp[steps] = Math.log(spot);
  for (let i = steps; i > 0; i--) logp[i - 1] = logp[i] - sd * regime[Math.floor(((i * STEP_MS) / DAY) | 0)] * fatTail(r);
  paths.set(a.sym, logp);
}
const priceAt = (sym: string, t: number) => Math.exp(paths.get(sym)![Math.round((t - start) / STEP_MS)]);

// ---------------------------------------------------------------------------------------------------
// Ladders: listing, strikes, snapshots and the outcome.

interface SimLadder {
  ticker: string;
  asset: Asset;
  hourly: boolean;
  title: string;
  expiry: number;
  listed: number;
  strikes: { value: string; k: number; symbol: string }[];
  contractsJson: string;
  snaps: { t: number; prices: Record<string, (number | null)[]> }[];
  final: number;
  sides: Record<string, "yes" | "no">;
  settlementValue: string;
}

function priceLadder(l: Omit<SimLadder, "snaps" | "final" | "sides" | "settlementValue">, t: number, r: () => number) {
  const s = priceAt(l.asset.sym, t);
  const sig = l.asset.vol * Math.sqrt(Math.max(l.expiry - t, STEP_MS) / YEAR);
  const prices: Record<string, (number | null)[]> = {};
  const cents = (x: number) => Math.min(0.99, Math.max(0.01, Math.ceil(x * 100 - 1e-9) / 100));
  for (const k of l.strikes) {
    const p = 1 - phi(Math.log(k.k / s) / sig + sig / 2);
    const half = 0.01 + 0.015 * r();
    // Deep out-of-the-money contracts sit at a 2–3¢ floor, as on Gemini.
    const yesAsk = p < 0.01 ? (r() < 0.5 ? 0.02 : 0.03) : cents(p + half);
    const noAsk = p > 0.99 ? (r() < 0.5 ? 0.02 : 0.03) : cents(1 - p + half);
    const bid = Math.round((yesAsk - 2 * half) * 100) / 100;
    prices[k.symbol] = [yesAsk, noAsk, bid >= 0.01 ? bid : null, yesAsk];
  }
  return prices;
}

function makeLadder(a: Asset, expiry: number, hourly: boolean): SimLadder | null {
  const r = rng(`ladder:${a.sym}:${expiry}:${hourly}`);
  const life = hourly ? 2 * HOUR : 30 * HOUR;
  const listed = expiry - life;
  if (listed < start) return null;
  const s0 = priceAt(a.sym, listed);
  const step = niceStep((s0 * a.vol * Math.sqrt(life / YEAR)) / 3.5);
  const dp = decimals(step);
  const n = hourly ? 10 : 12;
  const centre = Math.round(s0 / step) * step;
  const ticker = `${a.sym}${tickerTime(expiry)}`;
  const iso = new Date(expiry).toISOString();
  const strikes = Array.from({ length: n }, (_, i) => centre + (i - n / 2 + 0.5) * step)
    .map((k) => Math.round(k / step) * step)
    .filter((k) => k > 0)
    .map((k) => {
      const value = k.toFixed(dp < 2 && k < 1 ? 2 : dp);
      return { value, k: Number(value), symbol: `GEMI-${ticker}-HI${strikeCode(value)}` };
    });
  const contracts: Record<string, unknown> = {};
  for (const k of strikes) {
    contracts[k.symbol] = {
      label: strikeLabel(k.k),
      ticker: `HI${strikeCode(k.value)}`,
      instrumentSymbol: k.symbol,
      strike: { type: "above", value: k.value },
      quantityMinimum: "0.01",
      quantityIncrement: "0.01",
      priceIncrement: "0.01",
      expiryDate: iso,
    };
  }
  const base = { ticker, asset: a, hourly, title: title(a, expiry, hourly), expiry, listed, strikes, contractsJson: JSON.stringify(contracts) };
  const every = hourly ? STEP_MS : 6 * STEP_MS; // recorder cadence on hourly ladders; thinned to 30 min on daily ones
  const snaps = [];
  for (let t = listed; t < expiry; t += every) snaps.push({ t, prices: priceLadder(base, t, r) });
  const final = priceAt(a.sym, expiry);
  const sides: Record<string, "yes" | "no"> = {};
  for (const k of strikes) sides[k.symbol] = final >= k.k ? "yes" : "no";
  return { ...base, snaps, final, sides, settlementValue: final.toFixed(Math.max(2, dp)) };
}

const ladders: SimLadder[] = [];
const firstDay = Math.floor(now / DAY) * DAY - SPAN * DAY;
for (let d = firstDay; d < now; d += DAY) {
  for (const a of ASSETS) {
    if (!paths.has(a.sym)) continue;
    const daily = d + 22 * HOUR; // 5pm ET, like Gemini's daily ladders
    if (daily < now - HOUR) {
      const l = makeLadder(a, daily, false);
      if (l) ladders.push(l);
    }
    if (a.hourly)
      for (const h of [15, 19]) {
        // 10am and 2pm ET
        const t = d + h * HOUR;
        if (t < now - HOUR) {
          const l = makeLadder(a, t, true);
          if (l) ladders.push(l);
        }
      }
  }
}
ladders.sort((a, b) => a.expiry - b.expiry);

// ---------------------------------------------------------------------------------------------------
// Write: clear the previous simulation, then ladders, snapshots and outcomes in one transaction.

const db = openDb();
// Simulated positions only (whatever wallet they were seeded to), never a wallet's real ones.
const simPositions = db.prepare("SELECT pubkey, quote_id FROM positions WHERE note LIKE ?").all(`%${SIM_NOTE}`) as { pubkey: string; quote_id: string | null }[];
const clear = db.transaction(() => {
  const demoTickers = (db.prepare("SELECT ticker FROM ladders WHERE demo = 1").all() as { ticker: string }[]).map((r) => r.ticker);
  for (const t of demoTickers) {
    db.prepare("DELETE FROM snapshots WHERE ticker = ?").run(t);
    db.prepare("DELETE FROM outcomes WHERE ticker = ?").run(t);
  }
  db.prepare("DELETE FROM ladders WHERE demo = 1").run();
  for (const p of simPositions) {
    db.prepare("DELETE FROM fills WHERE position = ?").run(p.pubkey);
    db.prepare("DELETE FROM positions WHERE pubkey = ?").run(p.pubkey);
    if (p.quote_id) db.prepare("DELETE FROM quotes WHERE id = ?").run(p.quote_id);
  }
  return demoTickers.length;
});
console.log(`removed ${clear()} simulated ladder(s) and ${simPositions.length} simulated position(s)`);
if (REMOVE) process.exit(0);

const real = new Set((db.prepare("SELECT ticker FROM ladders WHERE demo = 0").all() as { ticker: string }[]).map((r) => r.ticker));
// Never shadow a ladder the recorder really saw. Only the last DAYS go to Replay; the trader uses them all.
const tradable = ladders.filter((l) => !real.has(l.ticker) && l.expiry >= now - RECORD_DAYS * DAY);
const sim = tradable.filter((l) => l.expiry >= now - DAYS * DAY);
db.transaction(() => {
  const insL = db.prepare(
    "INSERT INTO ladders (ticker, series, title, category, template, expiry, contracts_json, first_seen, demo) VALUES (?, ?, ?, ?, 'prices-ladder', ?, ?, ?, 1)",
  );
  const insS = db.prepare("INSERT INTO snapshots (ticker, captured_at, prices_json) VALUES (?, ?, ?)");
  const insO = db.prepare("INSERT INTO outcomes (ticker, resolved_at, settlement_value, sides_json, checked_at) VALUES (?, ?, ?, ?, ?)");
  for (const l of sim) {
    const series = l.asset.category === "Crypto" ? `${l.asset.sym}1H` : l.asset.sym;
    insL.run(l.ticker, series, l.title, l.asset.category, new Date(l.expiry).toISOString(), l.contractsJson, l.listed);
    for (const s of l.snaps) insS.run(l.ticker, s.t, JSON.stringify(s.prices));
    insO.run(l.ticker, new Date(l.expiry + 2 * 60_000).toISOString(), l.settlementValue, JSON.stringify(l.sides), l.expiry + 5 * 60_000);
  }
})();
console.log(`wrote ${sim.length} simulated ladders (${sim.filter((l) => l.hourly).length} hourly), ${sim.reduce((s, l) => s + l.snaps.length, 0)} snapshots`);

// ---------------------------------------------------------------------------------------------------
// The demo trader: about two positions a day, sized $25–$200, on a weak signal of where the price
// ends (correlation ρ with the truth), within about 10% of the market's width.

const RHO = 0.4;
// A fixed seed (the one the demo was tuned on), so the record looks the same whichever wallet it goes to.
const tr = rng("trader:9MKhV3g8zEzJc8sAtsfHQRetE556Szuwv8TwfUxkf1gE");
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(tr() * xs.length)];
const STAKES = [25, 40, 50, 50, 75, 100, 100, 150, 200] as const;
const uuid = (seed: string) => {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const insQ = db.prepare(
  "INSERT INTO quotes (id, ticker, forecast_hash, preimage_json, quote_json, schedule_json, stake_base, expiry_ts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
);
const insP = db.prepare(
  `INSERT INTO positions (pubkey, owner, ticker, quote_id, forecast_hash, state, stake_base, max_payout_base, schedule_json, expiry_ts,
     outcome_bucket, score_bps, payout_base, note, pay_to, created_at, updated_at)
   VALUES (@pubkey, @owner, @ticker, @quote_id, @forecast_hash, 'Settled', @stake_base, @max_payout_base, @schedule_json, @expiry_ts,
     @outcome_bucket, @score_bps, @payout_base, @note, @pay_to, @created_at, @updated_at)`,
);
const insF = db.prepare(
  `INSERT INTO fills (position, symbol, side, strike, qty, price, quoted_price, mode, status, detail_json, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'paper', 'filled', ?, ?)`,
);

const candidates = tradable.filter((l) => tr() < (l.hourly ? 0.14 : 0.24));
let made = 0;
let pnl = 0;
let scoreSum = 0;
db.transaction(() => {
  for (const l of candidates) {
    // Open somewhere between an hour after listing and well before the close (as a person would).
    const lo = l.listed + (l.hourly ? 10 * 60_000 : HOUR);
    const hi = l.expiry - (l.hourly ? 25 * 60_000 : 5 * HOUR);
    const at = lo + tr() * (hi - lo);
    const snap = [...l.snaps].reverse().find((s) => s.t <= at);
    if (!snap) continue;
    const row = { ticker: l.ticker, title: l.title, category: l.asset.category, expiry: new Date(l.expiry).toISOString(), contracts_json: l.contractsJson };
    let ladder;
    try {
      ladder = normalizeEvent(recordedEvent(row, snap.prices));
    } catch {
      continue;
    }
    if (!ladder.cuts) continue;
    // Where the price really ended, in market standard deviations from where it stood: the trader sees it through noise.
    const sigma = l.asset.vol * Math.sqrt((l.expiry - snap.t) / YEAR);
    const z = Math.log(l.final / priceAt(l.asset.sym, snap.t)) / sigma;
    const shift = Math.max(-1.1, Math.min(1.1, 0.6 * (RHO * z + Math.sqrt(1 - RHO * RHO) * gauss(tr))));
    const widthScale = 0.9 + 0.2 * tr();
    const confidence = Math.round((0.35 + 0.45 * tr()) * 100) / 100;
    const stakeUsd = pick(STAKES);
    const belief = fromMarket(ladder, shift * marketMoments(ladder).sd, widthScale);
    const quote = compile({ ladder, belief, confidence, stakeUsd });
    if (quote.advice !== "trade" || !quote.legs.length) continue;
    const escrow = escrowTerms(quote);
    if (escrow.stakeBase <= 0) continue;
    const o = outcomeBucket(ladder, recordedEvent({ ...row, settlement_value: l.settlementValue }, snap.prices, l.sides));
    if (!o || !o.consistent || o.bucket < 0) continue;

    const quoteId = uuid(`sim-quote:${l.ticker}:${OWNER}`);
    const capturedAt = new Date(snap.t).toISOString();
    const preimage = { ticker: ladder.eventTicker, marketProb: ladder.marketProb, belief, confidence, quoteId, capturedAt };
    const hash = forecastHash(preimage);
    const openedAt = Math.round(at);
    const { raw, ...rest } = quote;
    const stored: StoredQuote = {
      quoteId,
      ticker: ladder.eventTicker,
      title: ladder.title,
      forecastHash: hash,
      marketIdHex: marketIdHex(ladder.eventTicker),
      scheduleBaseUnits: escrow.scheduleBase.map(String),
      stakeBaseUnits: String(escrow.stakeBase),
      keptBaseUnits: String(escrow.keptBase),
      expiryTs: Math.floor(l.expiry / 1000),
      validUntil: openedAt + config.quoteTtlMs,
      capturedAt,
      preimage,
      quote: { ...rest, iterations: raw.iterations },
      marketProb: ladder.marketProb,
      bucketLabels: ladder.bucketLabels,
      crossedStrikes: ladder.instruments.filter((_, i) => ladder.crossed[i]).map((i) => i.label),
    };
    insQ.run(quoteId, stored.ticker, hash, JSON.stringify(preimage), JSON.stringify(stored), JSON.stringify(stored.scheduleBaseUnits), stored.stakeBaseUnits, stored.expiryTs, openedAt - 6_000);

    const score = scoreBps(belief, ladder.marketProb, o.bucket);
    const payout = escrow.scheduleBase[o.bucket];
    const pubkey = new PublicKey(createHash("sha256").update(`demo-sim:${quoteId}`).digest()).toBase58();
    insP.run({
      pubkey,
      owner: OWNER,
      ticker: l.ticker,
      quote_id: quoteId,
      forecast_hash: hash,
      stake_base: String(escrow.stakeBase),
      max_payout_base: String(Math.max(...escrow.scheduleBase)),
      schedule_json: JSON.stringify(stored.scheduleBaseUnits),
      expiry_ts: stored.expiryTs,
      outcome_bucket: o.bucket,
      score_bps: score,
      payout_base: String(payout),
      note: `Outcome: ${ladder.bucketLabels[o.bucket]} · settled at ${l.settlementValue}. ${SIM_NOTE}`,
      pay_to: config.payTo || null,
      created_at: openedAt,
      updated_at: l.expiry + 90_000,
    });
    for (const leg of quote.legs) {
      const detail = { label: leg.label, simulated: true, quote: { capturedAt, buy: { [leg.side]: leg.price.toFixed(2) } }, fee: leg.fee };
      insF.run(pubkey, leg.symbol, leg.side, leg.strike, leg.qty, leg.price, leg.price, JSON.stringify(detail), openedAt + 2_000);
    }
    made++;
    pnl += (payout - escrow.stakeBase) / 1e6;
    scoreSum += score / 1e4;
  }
})();
console.log(
  `demo record for ${OWNER}: ${made} settled positions · mean score ${made ? (scoreSum / made).toFixed(3) : "—"} · settled P&L ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)}`,
);
