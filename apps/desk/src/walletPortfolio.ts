import { paysIn, tradingFeeUsd, type Ladder } from "@contour/core";
import type { RawContract, RawEvent } from "@contour/gemini";
import type { DB } from "./db";
import type { StoredQuote } from "./markets";
import { markPrice, sellPrice, type PaperMarkets, type PositionSummary } from "./paper";

/**
 * A wallet's portfolio: every position it paid for (the `positions` table), in the same shape as the
 * paper portfolio so the same screen shows it. Open positions are valued live at Gemini's marks, like
 * paper ones; settled ones at what they paid out.
 *
 * The position is a payout schedule, backed by the quote's contracts plus the quote's cash. So its value
 * now is that cash (less the part that never left the wallet) plus each contract at the mark.
 *
 * Account totals: "paid in" is everything the wallet has paid for positions; the account's value is
 * what settled positions paid back plus what open ones are worth now. Value minus paid in is the
 * all-time result.
 */

interface Row {
  pubkey: string;
  ticker: string | null;
  state: string;
  stake_base: string | null;
  schedule_json: string | null;
  expiry_ts: number | null;
  outcome_bucket: number | null;
  payout_base: string | null;
  created_at: number;
  updated_at: number;
  quote_json: string | null;
}

type Fill = { symbol: string; side: "yes" | "no"; label: string; qty: number; price: number; feeUsd: number };
interface Trade {
  id: number;
  position: string;
  title: string;
  kind: "open" | "settle";
  cashUsd: number;
  realizedUsd: number;
  fraction: null;
  outcome: string | null;
  fills: Fill[];
  at: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export async function walletPortfolio(db: DB, markets: PaperMarkets, owner: string) {
  const rows = db
    .prepare(
      `SELECT p.pubkey, p.ticker, p.state, p.stake_base, p.schedule_json, p.expiry_ts, p.outcome_bucket, p.payout_base, p.created_at, p.updated_at, q.quote_json
       FROM positions p LEFT JOIN quotes q ON q.id = p.quote_id WHERE p.owner = ? ORDER BY p.created_at DESC`,
    )
    .all(owner) as Row[];

  // One live event per market, for the open positions.
  const events = new Map<string, RawEvent | null>();
  async function eventFor(ticker: string) {
    if (!events.has(ticker)) {
      try {
        events.set(ticker, await markets.getEvent(ticker, 5_000));
      } catch {
        events.set(ticker, null);
      }
    }
    return events.get(ticker) ?? null;
  }

  const positions: (PositionSummary & { href: string })[] = [];
  const trades: Omit<Trade, "id">[] = [];
  for (const r of rows) {
    const q = r.quote_json ? (JSON.parse(r.quote_json) as StoredQuote) : null;
    const legs = q?.quote.legs ?? [];
    const title = q?.title ?? r.ticker ?? "Position";
    const ticker = q?.ticker ?? r.ticker ?? "";
    const stake = Number(r.stake_base ?? 0) / 1e6;
    const schedule = (r.schedule_json ? (JSON.parse(r.schedule_json) as string[]) : []).map((x) => Number(x) / 1e6);
    const fees = legs.reduce((s, l) => s + l.fee, 0);
    const kept = Number(q?.keptBaseUnits ?? 0) / 1e6;
    const cashIn = Math.max(0, (q?.quote.cashUsd ?? 0) - kept); // the quote's cash that was paid in, returned in every outcome
    const expiry = new Date((r.expiry_ts ?? 0) * 1000).toISOString();
    const status: PositionSummary["status"] = r.state === "Settled" ? "settled" : r.state === "Unwound" || r.state === "Cancelled" ? "closed" : "open";
    const strategy: PositionSummary["strategy"] = q?.preimage.protect ? "protect" : q?.preimage.spread ? "spread" : "view";
    const fills: Fill[] = legs.map((l) => ({ symbol: l.symbol, side: l.side, label: l.label, qty: l.qty, price: l.price, feeUsd: l.fee }));

    let valueUsd = stake;
    let cashOutUsd: number | null = null;
    let pricing: PositionSummary["pricing"] = "final";
    let payoutUsd: number | null = null;
    let outcomeLabel: string | null = null;
    let results: PositionSummary["results"];
    let closedAt: number | null = null;

    if (status === "open") {
      const ev = ticker ? await eventFor(ticker) : null;
      const bySym = new Map<string, RawContract>((ev?.contracts ?? []).map((c) => [c.instrumentSymbol, c]));
      let value = cashIn;
      let cashOut: number | null = cashIn;
      let priced = ev !== null && legs.length > 0;
      for (const l of legs) {
        const c = bySym.get(l.symbol);
        const m = markPrice(c, l.side);
        const bid = sellPrice(c, l.side);
        if (m === null) priced = false;
        else value += l.qty * m;
        cashOut = cashOut === null || bid === null ? null : cashOut + l.qty * bid - tradingFeeUsd(l.qty, bid);
      }
      valueUsd = priced ? value : stake;
      cashOutUsd = priced && cashOut !== null ? cashOut : null;
      pricing = priced ? (markets.isFrozen?.(ticker) ? "frozen" : "live") : "none";
    } else if (status === "settled") {
      payoutUsd = Number(r.payout_base ?? 0) / 1e6;
      valueUsd = payoutUsd;
      closedAt = r.updated_at;
      const b = r.outcome_bucket;
      outcomeLabel = b !== null && q ? (q.bucketLabels[b] ?? null) : null;
      if (b !== null)
        results = legs.map((l) => {
          // Strike contracts are threshold ladders ("$X or above"); the rest are named outcomes.
          const won = paysIn({ kind: l.strike !== null ? "threshold" : "categorical" } as Ladder, l.instrumentIndex, l.side, b);
          return { label: l.label, side: l.side, result: won ? ("won" as const) : ("lost" as const), pnlUsd: round2((won ? l.qty : 0) - l.usd - l.fee) };
        });
    } else {
      // Unwound or cancelled: the stake came back.
      payoutUsd = stake;
      valueUsd = stake;
      closedAt = r.updated_at;
      outcomeLabel = "Refunded";
    }

    const realizedUsd = status === "open" ? 0 : (payoutUsd ?? 0) - stake;
    // Worth at the asks when bought is the stake less fees: fees are the entry cost, the rest is the market's move.
    const entryValue = stake - fees;
    positions.push({
      id: r.pubkey,
      href: `/p/${r.pubkey}`,
      ticker,
      title,
      category: null,
      strategy,
      viewLabel: null,
      status,
      awaiting: status === "open" && (r.expiry_ts ?? 0) * 1000 <= Date.now(),
      expiry,
      openedAt: r.created_at,
      closedAt,
      costUsd: stake,
      valueUsd,
      cashOutUsd,
      feesPaidUsd: fees,
      pricing,
      unrealizedUsd: status === "open" ? valueUsd - stake : 0,
      entryCostUsd: status === "open" ? fees : 0,
      moveUsd: status === "open" ? valueUsd - entryValue : 0,
      realizedUsd,
      schedule: schedule.map(round2),
      payoutUsd,
      outcomeLabel,
      contracts: legs.reduce((s, l) => s + l.qty, 0),
      investedUsd: stake,
      returnedUsd: status === "open" ? 0 : (payoutUsd ?? 0),
      demo: false,
      ...(results ? { results } : {}),
    });

    trades.push({ position: r.pubkey, title, kind: "open", cashUsd: -stake, realizedUsd: 0, fraction: null, outcome: null, fills, at: r.created_at });
    if (status !== "open") {
      const settleFills = results ? fills.map((f, i) => ({ ...f, price: results![i].result === "won" ? 1 : 0, feeUsd: 0 })) : [];
      trades.push({ position: r.pubkey, title, kind: "settle", cashUsd: payoutUsd ?? 0, realizedUsd, fraction: null, outcome: outcomeLabel, fills: settleFills, at: closedAt ?? r.updated_at });
    }
  }

  const open = positions.filter((p) => p.status === "open");
  const paidIn = positions.reduce((s, p) => s + p.investedUsd, 0);
  const paidOut = positions.reduce((s, p) => s + p.returnedUsd, 0);
  const positionsUsd = open.reduce((s, p) => s + p.valueUsd, 0);
  const totals = {
    /** What settled and refunded positions paid back to the wallet. */
    cashUsd: paidOut,
    positionsUsd,
    totalUsd: paidOut + positionsUsd,
    /** Everything the wallet paid for positions. */
    startUsd: paidIn,
    cashOutUsd: open.reduce((s, p) => s + (p.cashOutUsd ?? p.valueUsd), 0),
    unrealizedUsd: open.reduce((s, p) => s + p.unrealizedUsd, 0),
    realizedUsd: positions.reduce((s, p) => s + p.realizedUsd, 0),
    openCount: open.length,
  };

  // Value history: the account's all-time result over time (open positions at cost until they settle),
  // drawn against everything paid in, so the last point is the value now.
  const now = Date.now();
  const steps = trades.filter((t) => t.kind === "settle").map((t) => ({ at: t.at, pnl: t.realizedUsd }));
  steps.sort((a, b) => a.at - b.at);
  const first = rows.length ? Math.min(...rows.map((r) => r.created_at)) : now;
  const history: { at: number; valueUsd: number }[] = [{ at: first, valueUsd: paidIn }];
  let pnl = 0;
  for (const s of steps) {
    pnl += s.pnl;
    history.push({ at: s.at, valueUsd: round2(paidIn + pnl) });
  }
  history.push({ at: Math.max(now, history[history.length - 1].at), valueUsd: round2(totals.totalUsd) });

  trades.sort((a, b) => b.at - a.at);
  return {
    account: owner,
    createdAt: first,
    demoAt: null,
    totals,
    positions,
    history,
    trades: trades.map((t, i) => ({ ...t, id: trades.length - i })),
  };
}
