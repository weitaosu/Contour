import { compile, fromMarket, marketMoments, normalizeEvent, outcomeBucket, type EventLike } from "@contour/core";
import type { DB } from "./db";

/**
 * Replay (BUILD_PLAN 6.7). For each recorded ladder that has settled, take the snapshot from a fixed time
 * before expiry, apply a fixed set of test forecasts, and compare the return of the Contour position with
 * the single best contract for the same forecast. This is an illustration over a small sample, not proof.
 */
export const FORECASTS = [
  { id: "up", label: "Market shifted up ½ sd", shift: 0.5, scale: 1 },
  { id: "down", label: "Market shifted down ½ sd", shift: -0.5, scale: 1 },
  { id: "narrow", label: "Market narrowed to 0.6× width", shift: 0, scale: 0.6 },
] as const;
const CONFIDENCE = 0.5;
const STAKE = 100;

export function horizonMs(ticker: string, title: string, category: string, lifeMs: number) {
  if (/today/i.test(title)) return 30 * 60_000; // hourly ladders
  if (category === "Weather") return 6 * 3600_000;
  if (lifeMs > 3 * 86_400_000) return 24 * 3600_000; // weekly / monthly
  return 6 * 3600_000; // daily
}

interface LadderRow {
  ticker: string;
  title: string;
  category: string;
  expiry: string;
  contracts_json: string;
  first_seen: number;
  sides_json: string;
  settlement_value: string | null;
  demo: number;
}

/**
 * A recorded ladder as an event: its static contract fields, one snapshot's prices
 * ({symbol: [yesAsk, noAsk, bestBid, bestAsk]}) and, once settled, each contract's resolution side.
 */
export function recordedEvent(
  r: Pick<LadderRow, "ticker" | "title" | "category" | "expiry" | "contracts_json"> & { settlement_value?: string | null },
  prices: Record<string, (number | null)[]>,
  sides: Record<string, "yes" | "no"> = {},
): EventLike & { settlement: { value?: string } } {
  const statics = JSON.parse(r.contracts_json) as Record<string, EventLike["contracts"][number]>;
  const s = (v: number | null) => (v === null ? undefined : String(v));
  const contracts = Object.entries(prices).map(([sym, p]) => ({
    ...statics[sym],
    instrumentSymbol: sym,
    prices: { buy: { yes: s(p[0]), no: s(p[1]) }, bestBid: s(p[2]) ?? null, bestAsk: s(p[3]) ?? null },
    resolutionSide: sides[sym],
  }));
  return {
    ticker: r.ticker,
    title: r.title,
    category: r.category,
    expiryDate: r.expiry,
    contracts,
    settlement: { value: r.settlement_value ?? undefined },
  };
}

export function computeReplay(db: DB) {
  const rows = db
    .prepare(
      `SELECT l.ticker, l.title, l.category, l.expiry, l.contracts_json, l.first_seen, l.demo, o.sides_json, o.settlement_value
       FROM ladders l JOIN outcomes o ON o.ticker = l.ticker ORDER BY l.expiry`,
    )
    .all() as LadderRow[];
  const snapStmt = db.prepare(
    "SELECT captured_at, prices_json FROM snapshots WHERE ticker = ? AND captured_at <= ? ORDER BY captured_at DESC LIMIT 1",
  );
  const firstStmt = db.prepare("SELECT MIN(captured_at) AS t FROM snapshots WHERE ticker = ?");
  const results: Record<string, { t: string; ticker: string; contour: number; single: number }[]> = {};
  for (const f of FORECASTS) results[f.id] = [];
  let used = 0;
  let simulated = 0;
  let skipped = 0;
  for (const r of rows) {
    const expiry = new Date(r.expiry).getTime();
    const first = (firstStmt.get(r.ticker) as { t: number }).t;
    const h = horizonMs(r.ticker, r.title, r.category, expiry - first);
    const target = expiry - h;
    const snap = snapStmt.get(r.ticker, target) as { captured_at: number; prices_json: string } | undefined;
    if (!snap || target - snap.captured_at > 20 * 60_000) {
      skipped++;
      continue;
    }
    const ev = recordedEvent(r, JSON.parse(snap.prices_json), JSON.parse(r.sides_json));
    let ladder;
    try {
      ladder = normalizeEvent(ev);
    } catch {
      skipped++;
      continue;
    }
    if (!ladder.cuts) {
      skipped++;
      continue;
    }
    const o = outcomeBucket(ladder, ev);
    if (!o || !o.consistent || o.bucket < 0) {
      skipped++;
      continue;
    }
    used++;
    if (r.demo) simulated++;
    marketMoments(ladder);
    for (const f of FORECASTS) {
      const sd = marketMoments(ladder).sd;
      const belief = fromMarket(ladder, f.shift * sd, f.scale);
      const q = compile({ ladder, belief, confidence: CONFIDENCE, stakeUsd: STAKE, maxIter: 20_000 });
      const contour = q.payoutByBucket[o.bucket] / STAKE - 1;
      let single = 0;
      if (q.comparison) {
        const c = q.comparison;
        const ins = ladder.instruments.findIndex((x) => x.symbol === c.symbol);
        const yesWins = ladder.kind === "threshold" ? o.bucket >= ins + 1 : o.bucket === ins;
        const wins = c.side === "yes" ? yesWins : !yesWins;
        single = wins ? (c.qty * 1) / STAKE - 1 : -1;
      }
      results[f.id].push({ t: r.expiry, ticker: r.ticker, contour, single });
    }
  }
  const stats = (xs: number[]) => {
    const n = xs.length;
    const mean = n ? xs.reduce((a, b) => a + b, 0) / n : 0;
    const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
    return { n, mean, sd, worst: n ? Math.min(...xs) : 0, best: n ? Math.max(...xs) : 0, shareProfit: n ? xs.filter((x) => x > 1e-9).length / n : 0 };
  };
  const strategies = FORECASTS.flatMap((f) => [
    { name: "Contour position", forecast: f.label, kind: "contour" as const, ...stats(results[f.id].map((p) => p.contour)) },
    { name: "Single best contract", forecast: f.label, kind: "single" as const, ...stats(results[f.id].map((p) => p.single)) },
  ]);
  return {
    sampleSize: used,
    /** How many of the ladders used are simulated demo data (scripts/seed-sim.ts) rather than recorded from Gemini. */
    simulated,
    ladders: rows.length,
    skipped,
    horizonNote: "Snapshot 30 min before expiry for hourly ladders, 6 h for daily and weather, 24 h for weekly and monthly.",
    generatedAt: new Date().toISOString(),
    confidence: CONFIDENCE,
    stakeUsd: STAKE,
    strategies,
    series: FORECASTS.map((f) => ({ forecast: f.label, points: results[f.id] })),
    note: "Returns per $1 staked at quoted asks, before fees. The test forecasts carry no information, so this compares the shape of outcomes (variance, worst case), not skill. Small sample: an illustration, not proof.",
  };
}
