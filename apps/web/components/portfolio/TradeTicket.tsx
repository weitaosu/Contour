"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { escrowTerms, tradingFeeUsd } from "@contour/core";
import { desk, type PaperPositionDetail, type StoredQuote } from "@/lib/desk";
import { pct, usd } from "@/lib/format";
import { Segmented } from "@/components/ui/Segmented";
import { signedUsd, tone } from "./PortfolioScreen";

const AMOUNTS = [25, 50, 100, 250];
const FRACTIONS = [
  { value: "0.25", label: "25%" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "All" },
] as const;

/** Contracts sold for a fraction of a leg, as the desk rounds it: everything for "All", else down to 0.01. */
const sellQty = (qty: number, f: number) => (f >= 0.999 ? qty : Math.floor(qty * f * 100 + 1e-9) / 100);

/**
 * Buy more of the same view, or sell part of the position, like the order ticket on a brokerage's
 * position page. Buying re-quotes the position's own view at today's prices; selling previews what
 * the bids would fetch after fees. The desk re-checks both, and refuses if prices moved in between.
 */
export function TradeTicket({ account, position: d, onDone }: { account: string; position: PaperPositionDetail; onDone: (message: string) => void }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const open = d.status === "open";

  if (!open)
    return (
      <aside className="card flex flex-col gap-4">
        <p className="eyebrow">Trade</p>
        <p className="card-title">{d.status === "settled" ? "This position has settled" : "This position is closed"}</p>
        <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
          <dt className="text-slate">Put in</dt>
          <dd className="tnum text-right font-bold text-inkstone">{usd(d.investedUsd)}</dd>
          <dt className="text-slate">{d.status === "settled" ? "Paid back" : "Sold for"}</dt>
          <dd className="tnum text-right font-bold text-inkstone">{usd(d.returnedUsd)}</dd>
          <dt className="text-slate">Return</dt>
          <dd className={`tnum text-right font-bold ${tone(d.realizedUsd)}`}>{signedUsd(d.realizedUsd)}</dd>
        </dl>
        {d.demo ? (
          <a href="/markets" className="btn btn-primary btn-block">
            Browse live markets
          </a>
        ) : (
          <a href={`/m/${encodeURIComponent(d.ticker)}`} className="btn btn-primary btn-block">
            Trade this market again
          </a>
        )}
      </aside>
    );

  return (
    <aside className="card flex flex-col gap-6" aria-label="Trade this position">
      <div className="flex items-center justify-between gap-3">
        <p className="card-title">Trade</p>
        <Segmented
          label="Buy or sell"
          value={side}
          onChange={setSide}
          options={[
            { value: "buy", label: "Buy more" },
            { value: "sell", label: "Sell" },
          ]}
        />
      </div>
      {side === "buy" ? <BuyMore account={account} d={d} onDone={onDone} /> : <Sell account={account} d={d} onDone={onDone} />}
      <p className="border-t border-mist pt-4 text-[13px] text-smoke">
        Paper cash <b className="tnum text-inkstone">{usd(d.accountCashUsd)}</b> · fills at Gemini&apos;s live prices, no real money moves.
      </p>
    </aside>
  );
}

function BuyMore({ account, d, onDone }: { account: string; d: PaperPositionDetail; onDone: (m: string) => void }) {
  const qc = useQueryClient();
  const protecting = d.strategy === "protect" && !!d.request.protect;
  const [amount, setAmount] = useState(50);
  const [text, setText] = useState("50");
  const [units, setUnits] = useState(() => d.request.protect?.units ?? 1);
  const [quote, setQuote] = useState<{ key: string; q: StoredQuote } | null>(null);
  const [qErr, setQErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const key = JSON.stringify([d.id, protecting ? units : amount]);

  // Re-quote the position's own view at today's prices: on every change, and every 20 s while it sits.
  useEffect(() => {
    if (!d.canBuyMore) return;
    if (protecting ? !(units > 0) : !(amount >= 1)) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      desk
        .quote(
          {
            ticker: d.ticker,
            belief: d.request.belief,
            confidence: d.request.confidence,
            stakeUsd: protecting ? 1 : amount,
            ...(protecting ? { protect: { ...d.request.protect!, units } } : {}),
            ...(d.request.spread ? { spread: d.request.spread } : {}),
            ...(d.request.shape ? { shape: d.request.shape } : {}),
          },
          ac.signal,
        )
        .then((q) => {
          setQuote({ key, q });
          setQErr(null);
        })
        .catch((e: Error) => e.name !== "AbortError" && setQErr(e.message));
    }, 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [key, tick, d.canBuyMore]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const i = setInterval(() => setTick((x) => x + 1), 20_000);
    return () => clearInterval(i);
  }, []);

  const fresh = quote && quote.key === key ? quote.q : null;
  const terms = fresh ? escrowTerms(fresh.quote) : null;
  const cost = fresh ? Number(fresh.stakeBaseUnits) / 1e6 : null;
  const kept = terms ? terms.keptBase / 1e6 : 0;
  const added = fresh ? fresh.quote.legs.reduce((s, l) => s + l.qty, 0) : 0;
  const nothing = !!fresh && (fresh.quote.legs.length === 0 || (!protecting && fresh.quote.advice === "no_edge"));
  const next = fresh ? d.schedule.map((s, j) => s + fresh.quote.payoutByBucket[j] - kept) : null;
  const short = cost !== null && cost > d.accountCashUsd;

  if (!d.canBuyMore)
    return (
      <p className="rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-inkstone">
        {d.awaiting
          ? "The market has closed, so nothing more can be bought. It settles on Gemini's result."
          : d.pricing !== "live"
            ? "Prices aren't live right now (Gemini is offline), so buying is paused."
            : "This market settles in a few minutes, so it's closed for new buying."}
      </p>
    );

  async function buy() {
    if (!fresh) return;
    setBusy(true);
    setErr(null);
    try {
      await desk.paperAdd(account, d.id, fresh.quoteId);
      await qc.invalidateQueries({ queryKey: ["paper", account] });
      onDone(`Bought more: ${added.toLocaleString("en-US", { maximumFractionDigits: 2 })} contracts filled for ${usd(cost ?? 0)}.`);
      setTick((x) => x + 1);
    } catch (e) {
      setErr((e as Error).message);
      setTick((x) => x + 1); // re-quote at the new prices
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] text-slate">
        {protecting
          ? "Protect more of your holding with the same floor, priced now."
          : "Adds to this position with the same view it was opened with, solved again at today's prices."}
      </p>
      {protecting ? (
        <label className="flex flex-col gap-2">
          <span className="stat-label">How much more to protect</span>
          <input
            className="input tnum text-[20px] font-bold"
            inputMode="decimal"
            value={units}
            onChange={(e) => {
              const n = Number(e.target.value.replace(/[^0-9.]/g, ""));
              if (Number.isFinite(n)) setUnits(n);
            }}
          />
        </label>
      ) : (
        <div className="flex flex-col gap-3">
          <span className="stat-label">Amount to add</span>
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Quick amounts">
            {AMOUNTS.map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={amount === a}
                onClick={() => {
                  setAmount(a);
                  setText(String(a));
                }}
                className={`ease tnum rounded-full border py-1.5 text-[14px] font-bold ${amount === a ? "border-signal-violet bg-signal-violet text-white" : "border-mist bg-porcelain text-inkstone hover:border-ash"}`}
              >
                ${a}
              </button>
            ))}
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] font-bold text-slate">$</span>
            <input
              ref={input}
              className="input tnum !pl-9 text-[20px] font-bold"
              inputMode="decimal"
              aria-label="Amount to add"
              value={text}
              onChange={(e) => {
                const t = e.target.value.replace(/[^0-9.]/g, "");
                setText(t);
                const n = Number(t);
                if (n > 0) setAmount(Math.round(n * 100) / 100);
              }}
              onBlur={() => setText(String(amount))}
            />
          </div>
        </div>
      )}

      <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
        <dt className="text-slate">You pay</dt>
        <dd className="tnum text-right font-bold text-inkstone">{cost !== null ? usd(cost) : "…"}</dd>
        <dt className="text-slate">Adds</dt>
        <dd className="tnum text-right text-inkstone">{fresh ? `${added.toLocaleString("en-US", { maximumFractionDigits: 2 })} contracts` : "…"}</dd>
        <dt className="text-slate">Gemini fees (included)</dt>
        <dd className="tnum text-right text-inkstone">{fresh ? usd(fresh.quote.feesUsd) : "…"}</dd>
        <dt className="text-slate">Pays if it settles</dt>
        <dd className="tnum text-right font-bold text-inkstone">
          {next ? `${usd(Math.min(...next), 0)}–${usd(Math.max(...next), 0)}` : "…"}
        </dd>
      </dl>
      {!protecting && kept >= 0.5 && fresh && <p className="-mt-3 text-[13px] text-smoke">{usd(kept)} of the {usd(amount, 0)} isn&apos;t needed, so it stays in your cash.</p>}
      {nothing && <p className="rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-inkstone">At today&apos;s prices this view has no edge left, so there&apos;s nothing worth buying.</p>}
      {qErr && <p className="text-[14px] text-inkstone">Quote failed: {qErr}</p>}
      {err && <p className="rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-inkstone">{err}</p>}
      <button type="button" className="btn btn-primary btn-block" disabled={!fresh || nothing || short || busy} onClick={buy}>
        {busy ? "Filling…" : short ? "Not enough paper cash" : fresh ? `Buy more · ${usd(cost ?? 0)}` : "Getting a quote…"}
      </button>
    </div>
  );
}

function Sell({ account, d, onDone }: { account: string; d: PaperPositionDetail; onDone: (m: string) => void }) {
  const qc = useQueryClient();
  const [fraction, setFraction] = useState<(typeof FRACTIONS)[number]["value"]>("1");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const f = Number(fraction);

  // What the bids would fetch now, rounded as the desk rounds it; the desk re-prices it on submit.
  const plan = useMemo(() => {
    let proceeds = 0;
    let fees = 0;
    let missing = 0;
    for (const l of d.legs) {
      const q = sellQty(l.qty, f);
      if (q <= 0) continue;
      if (l.bid === null) {
        missing++;
        continue;
      }
      const fee = tradingFeeUsd(q, l.bid);
      proceeds += Math.round(q * l.bid * 1e6) / 1e6 - fee;
      fees += fee;
    }
    const cash = f >= 0.999 ? d.cashInPositionUsd : d.cashInPositionUsd * f;
    const basis = f >= 0.999 ? d.costUsd : d.costUsd * f;
    proceeds += cash;
    const atMark = f >= 0.999 ? d.valueUsd : d.valueUsd * f;
    return { proceeds, fees, basis, realized: proceeds - basis, missing, atMark };
  }, [d, f]);

  if (!d.canSell)
    return (
      <p className="rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-inkstone">
        {d.awaiting
          ? "The market has closed, so this can't be sold. It settles on Gemini's result, and winning contracts pay $1 each."
          : d.pricing !== "live"
            ? "Prices aren't live right now (Gemini is offline), so selling is paused."
            : "Nobody is bidding on one of these contracts right now, so it can't be sold. Try again shortly."}
      </p>
    );

  async function sell() {
    setBusy(true);
    setErr(null);
    try {
      const r = await desk.paperSell(account, d.id, { fraction: f, minProceedsUsd: Math.max(0, plan.proceeds) });
      await qc.invalidateQueries({ queryKey: ["paper", account] });
      onDone(`Sold ${f >= 0.999 ? "the whole position" : pct(f)} for ${usd(r.sale.proceedsUsd)} (${signedUsd(r.sale.realizedUsd)} return).`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] text-slate">Sells the same share of every contract at Gemini&apos;s bids, like cashing out early.</p>
      <div className="flex flex-col gap-3">
        <span className="stat-label">How much to sell</span>
        <Segmented label="How much to sell" value={fraction} onChange={setFraction} options={FRACTIONS.map((x) => ({ value: x.value, label: x.label }))} />
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-[15px]">
        <dt className="text-slate">Worth at the mark</dt>
        <dd className="tnum text-right text-inkstone">{usd(plan.atMark)}</dd>
        <dt className="text-slate">You&apos;d receive about</dt>
        <dd className="tnum text-right font-bold text-inkstone">{usd(Math.max(0, plan.proceeds))}</dd>
        <dt className="text-slate">Cost of that share</dt>
        <dd className="tnum text-right text-inkstone">{usd(plan.basis)}</dd>
        <dt className="text-slate">Return you&apos;d book</dt>
        <dd className={`tnum text-right font-bold ${tone(plan.realized)}`}>{signedUsd(plan.realized)}</dd>
        <dt className="text-slate">Gemini sell fees (included)</dt>
        <dd className="tnum text-right text-inkstone">{usd(plan.fees)}</dd>
      </dl>
      <p className="-mt-3 text-[13px] text-smoke">
        A sale fills at the bid, {usd(Math.max(0, plan.atMark - plan.proceeds))} below the mark after the sell fee: that&apos;s the cost of cashing out early instead of holding to the
        result. The desk refuses the sale if the bids drop more than 1% first.
      </p>
      {err && <p className="rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-inkstone">{err}</p>}
      <button type="button" className="btn btn-primary btn-block" disabled={busy || plan.missing > 0} onClick={sell}>
        {busy ? "Selling…" : `Sell ${f >= 0.999 ? "all" : pct(f)} · ${usd(Math.max(0, plan.proceeds))}`}
      </button>
    </div>
  );
}
