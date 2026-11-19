/**
 * Demo records for one wallet, built from real data: each position reuses a quote the desk really
 * made (its market snapshot, forecast, legs and payout schedule), its hedge is recorded the way the
 * paper executor records fills, and positions on markets Gemini has settled are settled at Gemini's
 * actual result, scored exactly as the scheduler would. Positions whose markets haven't settled stay
 * Active. No transactions are invented: the signature fields stay empty.
 *
 *   pnpm --filter @contour/desk exec env DOTENV_CONFIG_PATH=.env.localnet tsx scripts/seed-demo.ts [--owner <wallet>] [--remove]
 *
 * Seeded rows are keyed by sha256("demo-seed:" + quoteId), so re-running replaces them and --remove
 * deletes exactly them.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { normalizeEvent, outcomeBucket, scoreBps } from "@contour/core";
import { GeminiPublicClient } from "@contour/gemini";
import { config } from "../src/config";
import { openDb } from "../src/db";
import type { StoredQuote } from "../src/markets";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const OWNER = arg("--owner") ?? "3nhsSAEBwnA3ch95U1vmuJJ6h32Fbf2uFjfSgWrNRfDm";
const REMOVE = process.argv.includes("--remove");

/**
 * A spread of markets (crypto, oil, NBA and NHL totals, weather) with wins and losses, plus a few
 * still running or under review. Each entry names which of that market's tradable quotes to use
 * (oldest first). Left out on purpose: markets whose quotes contradict each other (copper) or whose
 * bucket prices don't add up (college totals), where the payout and the score disagree.
 */
const PICKS: [ticker: string, quote: number][] = [
  ["BTC2611182200", 1],
  ["ETH2611182200", 0],
  ["WTI2611182200", 0],
  ["BTC2611190500", 0],
  ["NBA-2611190000-MEM-CLE-T", 0],
  ["NBA-2611190000-PHI-ORL-T", 0],
  ["NBA-2611190100-ATL-OKC-T", 0],
  ["NBA-2611190230-BOS-DEN-T", 0],
  ["NHL-2611190300-COL-UTA-T", 0],
  ["WXHIGH-PHX-2611190459", 0],
  ["SOL2611192200", 0],
  ["ETH2611192200", 0],
];

const db = openDb();
const idFor = (quoteId: string) => new PublicKey(createHash("sha256").update(`demo-seed:${quoteId}`).digest()).toBase58();

// Remove anything seeded before (any owner), so a re-run replaces rather than duplicates.
const quoteIds = (db.prepare("SELECT id FROM quotes").all() as { id: string }[]).map((r) => r.id);
const seeded = quoteIds.map(idFor).filter((pk) => db.prepare("SELECT 1 FROM positions WHERE pubkey = ?").get(pk));
for (const pk of seeded) {
  db.prepare("DELETE FROM fills WHERE position = ?").run(pk);
  db.prepare("DELETE FROM positions WHERE pubkey = ?").run(pk);
}
console.log(`removed ${seeded.length} seeded position(s)`);
if (REMOVE) process.exit(0);

const gemini = new GeminiPublicClient();
const insPos = db.prepare(
  `INSERT INTO positions (pubkey, owner, ticker, quote_id, forecast_hash, state, stake_base, max_payout_base, schedule_json, expiry_ts,
     outcome_bucket, score_bps, payout_base, note, pay_to, created_at, updated_at)
   VALUES (@pubkey, @owner, @ticker, @quote_id, @forecast_hash, @state, @stake_base, @max_payout_base, @schedule_json, @expiry_ts,
     @outcome_bucket, @score_bps, @payout_base, @note, @pay_to, @created_at, @updated_at)`,
);
const insFill = db.prepare(
  `INSERT INTO fills (position, symbol, side, strike, qty, price, quoted_price, mode, status, detail_json, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 'paper', 'filled', ?, ?)`,
);

let pnl = 0;
for (const [ticker, pick] of PICKS) {
  const row = db
    .prepare(
      `SELECT id, quote_json, created_at FROM quotes WHERE ticker = ?
         AND json_array_length(json_extract(quote_json, '$.quote.legs')) > 0 AND json_extract(quote_json, '$.quote.advice') = 'trade'
       ORDER BY rowid LIMIT 1 OFFSET ?`,
    )
    .get(ticker, pick) as { id: string; quote_json: string; created_at: number } | undefined;
  if (!row) {
    console.log(`skip ${ticker}: no tradable quote stored`);
    continue;
  }
  const q = JSON.parse(row.quote_json) as StoredQuote;
  const schedule = q.scheduleBaseUnits.map(Number);
  const stake = Number(q.stakeBaseUnits);
  const pubkey = idFor(row.id);
  const opened = row.created_at + 4_000 + Math.floor(Math.random() * 6_000); // paid a few seconds after quoting

  // Gemini's real result, read the same way the settlement scheduler reads it.
  let settled: { bucket: number; score: number; note: string } | null = null;
  let status = "unknown";
  try {
    const ev = await gemini.getEvent(ticker);
    status = ev.status ?? "unknown";
    if (ev.status === "settled") {
      const ladder = normalizeEvent(ev, { allowUnquoted: true, categoricalAllowlist: config.categoricalAllowlist });
      const o = outcomeBucket(ladder, ev);
      // Match the outcome by its label: Gemini may list the ladder's outcomes differently now.
      const j = o && o.consistent && o.bucket >= 0 ? q.bucketLabels.indexOf(ladder.bucketLabels[o.bucket]) : -1;
      if (o && j >= 0) {
        settled = {
          bucket: j,
          score: scoreBps(q.preimage.belief, q.preimage.marketProb, j),
          note: `Outcome: ${q.bucketLabels[j]} · ${o.detail}${o.settlementValue !== null && o.settlementValue !== undefined ? ` · Gemini settlement ${o.settlementValue}` : ""}.`,
        };
      }
    }
  } catch (e) {
    console.log(`  ${ticker}: Gemini unavailable (${(e as Error).message.slice(0, 60)}); left Active`);
  }

  const settledAt = settled ? Math.max(opened + 60_000, q.expiryTs * 1000 + 90_000) : null;
  insPos.run({
    pubkey,
    owner: OWNER,
    ticker,
    quote_id: row.id,
    forecast_hash: q.forecastHash,
    state: settled ? "Settled" : "Active",
    stake_base: String(stake),
    max_payout_base: String(Math.max(...schedule)),
    schedule_json: JSON.stringify(q.scheduleBaseUnits),
    expiry_ts: q.expiryTs,
    outcome_bucket: settled?.bucket ?? null,
    score_bps: settled?.score ?? null,
    payout_base: settled ? String(schedule[settled.bucket]) : null,
    note: settled?.note ?? (status === "under_review" ? "Gemini is reviewing the result; this settles once it's final." : null),
    pay_to: config.payTo || null,
    created_at: opened,
    updated_at: settledAt ?? opened + 5_000,
  });
  for (const l of q.quote.legs) {
    const detail = { label: l.label, simulated: true, quote: { capturedAt: q.capturedAt, buy: { [l.side]: l.price.toFixed(2) } }, fee: l.fee };
    insFill.run(pubkey, l.symbol, l.side, l.strike, l.qty, l.price, l.price, JSON.stringify(detail), opened + 2_000);
  }
  const payout = settled ? schedule[settled.bucket] : null;
  if (payout !== null) pnl += (payout - stake) / 1e6;
  console.log(
    `${settled ? "settled" : "active "} ${ticker.padEnd(28)} paid $${(stake / 1e6).toFixed(2).padStart(7)}` +
      (settled ? ` → $${(payout! / 1e6).toFixed(2).padStart(7)} (${q.bucketLabels[settled.bucket]}) score ${(settled.score / 1e4).toFixed(3)}` : `  [Gemini: ${status}]`),
  );
}
console.log(`settled P&L ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(2)} · owner ${OWNER}`);
