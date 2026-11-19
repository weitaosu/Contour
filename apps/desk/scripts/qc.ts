/**
 * QC sweep: run every rule in packages/core/src/qc.ts over every market Contour would list right now.
 *
 *   pnpm --filter @contour/desk qc                         all active markets, order books checked
 *   pnpm --filter @contour/desk qc -- --no-books           skip the order-book check (faster)
 *   pnpm --filter @contour/desk qc -- --only <TICKER,...>  just these markets
 *
 * Prints a summary, writes the full results to data/qc/qc-<time>.json with an HTML report beside it
 * (data/qc/qc-<time>.html, open it in a browser), and exits 1 when any
 * error-level rule fails (so it can gate a deploy or run on a schedule).
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { anyViewTrades, QC_RULE, QC_RULES, qcLadder, tryNormalize, type Finding, type QcResult } from "@contour/core";
import { GeminiPublicClient, type RawEvent } from "@contour/gemini";
import { config } from "../src/config";
import { CLOSE_BUFFER_MS, MarketService, NO_VIEW_REASON } from "../src/markets";
import { renderQcReport } from "./qc-report";

const args = process.argv.slice(2);
const books = !args.includes("--no-books");
const onlyArg = args.indexOf("--only");
const only = onlyArg >= 0 ? new Set(args[onlyArg + 1]?.split(",").map((s) => s.trim())) : null;

const client = new GeminiPublicClient(config.geminiBase);
const startedAt = new Date();

// 1. Every active event, the same way the desk lists them.
let categories = config.marketCategories;
if (categories.includes("*")) categories = (await client.getCategories()).categories;
const events: RawEvent[] = [];
const seen = new Set<string>();
if (only) {
  for (const t of only) events.push(await client.getEvent(t));
} else {
  for (const category of categories) {
    try {
      for (const e of await client.listAllEvents({ status: "active", category }, 100, 5)) {
        if (seen.has(e.ticker)) continue;
        seen.add(e.ticker);
        events.push(e);
      }
    } catch (err) {
      console.warn(`[qc] ${category}: ${(err as Error).message}`);
    }
  }
}

// 2. Normalize; the rejected ones are counted by reason (they never reach a user).
const rejected = new Map<string, number>();
const results: (QcResult & { volume: number | null; volume24h: number | null; spot: number | null })[] = [];
const listable = events.filter((e) => only || new Date(e.expiryDate).getTime() >= Date.now() + CLOSE_BUFFER_MS);
console.log(`[qc] ${events.length} active events, ${listable.length} not about to close; checking...`);
let n = 0;
for (const e of listable) {
  const r = tryNormalize(e, { categoricalAllowlist: config.categoricalAllowlist });
  if (!("ladder" in r)) {
    rejected.set(r.reason, (rejected.get(r.reason) ?? 0) + 1);
    continue;
  }
  // The desk doesn't list markets where no view trades (see anyViewTrades); check what users see.
  if (!anyViewTrades(r.ladder)) {
    rejected.set(NO_VIEW_REASON, (rejected.get(NO_VIEW_REASON) ?? 0) + 1);
    continue;
  }
  // Crypto outlooks are relative to the live spot price, as on the forecast screen.
  let spot: number | null = null;
  const pair = MarketService.spotPair(e);
  if (pair) {
    try {
      const t = await client.getTicker(pair);
      spot = Number(t.close) > 0 ? Number(t.close) : null;
    } catch {
      spot = null;
    }
  }
  const res = qcLadder(r.ladder, { anchor: spot });

  // 3. Order books: can the YES legs the outlooks use actually be bought at the quoted ask?
  if (books) {
    const legs = new Map<string, { label: string; price: number; outlooks: Set<string> }>();
    for (const run of res.runs)
      for (const g of run.legs) {
        if (g.side !== "yes") continue;
        const k = g.symbol;
        if (!legs.has(k)) legs.set(k, { label: g.label, price: g.price, outlooks: new Set() });
        legs.get(k)!.outlooks.add(run.outlook);
      }
    for (const [symbol, g] of legs) {
      try {
        const b = await client.getBook(symbol, 10);
        const avail = b.asks.filter((a) => Number(a.price) <= g.price + 1e-9).reduce((s, a) => s + Number(a.amount), 0);
        if (avail <= 0) {
          const f: Finding = {
            rule: "unfillable-leg",
            severity: QC_RULE["unfillable-leg"].severity,
            detail: `YES "${g.label}" at ${Math.round(g.price * 100)}¢: no sellers at or below that price (used by ${[...g.outlooks].join(", ")}).`,
          };
          res.findings.push(f);
        }
      } catch (err) {
        console.warn(`[qc] book ${symbol}: ${(err as Error).message}`);
      }
    }
  }
  results.push({ ...res, volume: e.volume ? Number(e.volume) : null, volume24h: e.volume24h ? Number(e.volume24h) : null, spot });
  if (++n % 10 === 0) console.log(`[qc] ${n} markets checked`);
}

// 4. Summary.
const sevRank = { error: 0, warn: 1, info: 2 } as const;
const worst = (r: QcResult) => r.findings.reduce<keyof typeof sevRank | "ok">((w, f) => (w === "ok" || sevRank[f.severity] < sevRank[w] ? f.severity : w), "ok");
const byRule = new Map<string, string[]>();
for (const r of results) for (const id of new Set(r.findings.map((f) => f.rule))) byRule.set(id, [...(byRule.get(id) ?? []), r.ticker]);
const counts = { ok: 0, error: 0, warn: 0, info: 0 };
for (const r of results) counts[worst(r)]++;

console.log(`\n=== Contour QC · ${startedAt.toISOString()} ===`);
console.log(`${results.length} listed markets: ${counts.error} with errors, ${counts.warn} with warnings only, ${counts.info + counts.ok} clean (${counts.info} with notes).`);
console.log(`${[...rejected.values()].reduce((a, b) => a + b, 0)} events not listed:`);
for (const [reason, c] of [...rejected].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${reason}`);
console.log("\nRule                       Severity  Markets");
for (const rule of QC_RULES) {
  const hits = byRule.get(rule.id) ?? [];
  console.log(`${rule.id.padEnd(26)} ${rule.severity.padEnd(9)} ${String(hits.length).padStart(4)}`);
}
console.log("\nMarkets with errors:");
for (const r of results.filter((x) => worst(x) === "error")) {
  const ids = [...new Set(r.findings.filter((f) => f.severity === "error").map((f) => f.rule))];
  console.log(`  ${r.ticker.padEnd(34)} ${r.title.slice(0, 48).padEnd(48)} ${ids.join(", ")}`);
}

const dir = resolve(import.meta.dirname, "../../../data/qc");
mkdirSync(dir, { recursive: true });
const file = resolve(dir, `qc-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
const out = { startedAt: startedAt.toISOString(), books, rules: QC_RULES, rejected: Object.fromEntries(rejected), results };
writeFileSync(file, JSON.stringify(out, null, 1));
const html = file.replace(/\.json$/, ".html");
writeFileSync(html, renderQcReport(out));
console.log(`\nFull results: ${file}\nReport: ${html}`);
process.exit(counts.error > 0 ? 1 : 0);
