"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { paysIn, type Ladder, type Quote } from "@contour/core";
import { ScenarioTable } from "./ScenarioTable";
import { isWin } from "@/lib/outcomes";
import type { Spread } from "@/lib/spread";
import { usd } from "@/lib/format";

/**
 * "Why Contour": this position against putting the whole stake on the single best contract, by the
 * market's odds and on the full stake for both. A dropdown whose header carries the takeaway (how
 * often each makes money, and what is kept when it goes wrong); open, the profit or loss in every outcome.
 */

type Q = Omit<Quote, "raw">;
type Cls = "win" | "some" | "all";

/** Losing this much or more counts as losing everything (a lost contract still returns rounding cash). */
const LOSE_ALL = -0.9;
const ORDER: Cls[] = ["win", "some", "all"];

/** Return bins, as upper edges on the return (−0.9 = 10% of the stake back). */
const EDGES = [LOSE_ALL, -0.5, -0.25, 0, 0.25, 0.5, 1, 2, 4, Infinity];
const binOf = (r: number) => EDGES.findIndex((hi) => r <= hi + 1e-9);

const money = (x: number) => {
  const a = Math.abs(x);
  const s = a >= 10 || Math.abs(a - Math.round(a)) < 0.005 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2);
  return `${x < -0.004 ? "−" : ""}$${s}`;
};
const times = (a: number, b: number) => {
  const t = a / b;
  return t >= 2.95 ? `${Math.round(t)}×` : `${t.toFixed(1)}×`;
};

/** Whole counts out of `total` that keep the shares' sum exact (largest remainder). */
function outOf(shares: number[], total: number) {
  const sum = shares.reduce((a, b) => a + b, 0) || 1;
  const raw = shares.map((s) => (s / sum) * total);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  raw
    .map((v, i) => [v - Math.floor(v), i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => {
      if (left-- > 0) out[i]++;
    });
  return out;
}

interface Profile {
  /** Out of 100, per class (sums to 100). */
  counts: Record<Cls, number>;
  /** Chance of not making money, and the average money back when that happens. */
  lossChance: number;
  lossKeep: number | null;
  /** Chance of each return bin. */
  bins: number[];
  best: number;
  /** Range of results with a real chance (≥ 1 in 200), and how many distinct ones there are. */
  low: number;
  high: number;
  distinct: number;
}

function profile(payout: number[], stake: number, probs: number[]): Profile {
  const clsOf = (j: number): Cls => (isWin(payout[j], stake) ? "win" : payout[j] / stake - 1 <= LOSE_ALL + 1e-9 ? "all" : "some");
  const shares: Record<Cls, number> = { win: 0, some: 0, all: 0 };
  const bins = new Array<number>(EDGES.length).fill(0);
  let lossChance = 0;
  let lossMoney = 0;
  payout.forEach((p, j) => {
    const c = clsOf(j);
    shares[c] += probs[j];
    bins[binOf(p / stake - 1)] += probs[j];
    if (c !== "win") {
      lossChance += probs[j];
      lossMoney += probs[j] * p;
    }
  });
  const [win, some, all] = outOf(ORDER.map((k) => shares[k]), 100);
  const counts = { win, some, all };


  const real = payout.filter((_, j) => probs[j] >= 0.005);
  const rounded = new Set(real.map((p) => Math.round(p)));
  return {
    counts,
    lossChance,
    lossKeep: lossChance > 0.0005 ? lossMoney / lossChance : null,
    bins,
    best: Math.max(...payout),
    low: real.length ? Math.min(...real) : Math.min(...payout),
    high: real.length ? Math.max(...real) : Math.max(...payout),
    distinct: rounded.size,
  };
}

/** What the comparison contract pays in each bucket: its contracts if it lands, plus the cash it couldn't spend. */
function singlePayout(ladder: Ladder, quote: Q, stake: number): number[] | null {
  const c = quote.comparison;
  if (!c) return null;
  const idx = ladder.instruments.findIndex((i) => i.symbol === c.symbol);
  if (idx < 0) return null;
  const left = Math.max(0, stake - c.qty * c.price - c.fee);
  return ladder.bucketLabels.map((_, j) => (paysIn(ladder, idx, c.side, j) ? c.qty : 0) + left);
}

/** One plain-language line on what the comparison says, true to the numbers whichever way they fall. */
function verdict(h: Profile, s: Profile, stake: number) {
  const smaller = h.best < s.best - 0.005;
  const hw = h.counts.win;
  const sw = s.counts.win;
  const level = Math.abs(hw - sw) <= 2;
  const winsMore = hw > sw + 2;
  // The softer landing: what the hedge leaves you when it loses, against what one contract leaves.
  const keeps = h.lossKeep !== null && s.lossKeep !== null && h.lossKeep > s.lossKeep + 1;
  const landing = h.lossKeep === null ? "and it never loses money" : keeps ? `and when it goes wrong you still keep about ${money(h.lossKeep)} of your ${money(stake)}` : null;

  let lead: string;
  // The multiple always comes with its counts, so "11× as often" can't hide that it's 21 against 2.
  if (winsMore) lead = `${smaller ? "Smaller wins, but you" : "You"} make money ${sw > 0 ? `${times(hw, sw)} as often (${hw} vs ${sw} in 100)` : `in ${hw} of 100 where one contract never does`}`;
  else if (level) lead = `${smaller ? "Smaller wins, about" : "About"} as likely to make money (${hw} vs ${sw} in 100)`;
  else lead = `One contract makes money more often here (${sw} vs ${hw} in 100)`;
  if (!landing) return `${lead}.`;
  return winsMore || level ? `${lead}, ${landing}.` : `${lead}, but with the hedge, when it goes wrong you still keep about ${money(h.lossKeep ?? 0)} of your ${money(stake)}.`;
}

/** This position against all of it on the single best contract, both on the full stake, by the market's odds. */
function useComparison(ladder: Ladder, quote: Q) {
  const stake = quote.stakeBase / 1e6;
  const probs = ladder.marketProb;
  const data = useMemo(() => {
    const single = singlePayout(ladder, quote, stake);
    if (!single || !quote.legs.length) return null;
    return { hedge: profile(quote.payoutByBucket, stake, probs), single: profile(single, stake, probs) };
  }, [ladder, quote, stake, probs]);
  return { stake, probs, data };
}

/**
 * "Why Contour", under the charts: one dropdown, closed by default, its header carrying the takeaway.
 * Open, it shows what each position makes or loses at settlement, then out of 100 bets like this. All
 * by the market's odds, and always against putting the whole stake on the single best contract.
 */
export function ReturnOdds({
  ladder,
  quote,
  sizedDown = null,
  faded = false,
  className = "",
}: {
  ladder: Ladder;
  quote: Q;
  /** Set when the money put in has little to no spread: one bet with cash held back, which isn't a hedge. */
  sizedDown?: Spread | null;
  /** While the numbers are being re-quoted. */
  faded?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // Always the market's odds: what the prices say, not the user's own forecast.
  const { stake, probs, data } = useComparison(ladder, quote);

  const c = quote.comparison;
  return (
    <section aria-labelledby={`${panelId}-title`} className={`min-w-0 rounded-[24px] bg-cloud px-4 py-3 transition-opacity duration-300 ${faded ? "opacity-45" : ""} ${className}`}>
      {/* The header is the toggle: its title, the takeaway, and Show / Hide. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="ease -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-4 rounded-[16px] px-2 py-1.5 text-left hover:bg-mist/40"
      >
        <span className="min-w-0">
          <span id={`${panelId}-title`} className="block text-[16px] font-bold leading-tight text-inkstone">
            Why Contour
          </span>
          <span className={`mt-0.5 block text-[14px] leading-snug text-slate ${open ? "" : "truncate"}`}>
            {data ? (sizedDown ? sizedVerdict(sizedDown) : verdict(data.hedge, data.single, stake)) : "Your position against putting everything on one contract."}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-[13.5px] font-bold text-signal-violet">
          {open ? "Hide" : "Show"}
          <ChevronDown size={18} strokeWidth={2.25} aria-hidden="true" className={`ease ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open && (
        <div id={panelId} className="pb-1 pt-2">
          {!data || !c ? (
            <p className="text-[13.5px] text-slate">Once you have a trade, this shows what it and the single best contract would make or lose in every outcome.</p>
          ) : (
            <>
              <h3 className="text-[14px] font-bold text-inkstone">Profit or loss at settlement</h3>
              <p className="mt-0.5 text-[13px] text-slate">What each position would make or lose, for every final outcome.</p>
              <div className="mt-2 rounded-[18px] bg-porcelain p-3">
                <ScenarioTable ladder={ladder} quote={quote} stake={stake} probs={probs} />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** The headline when the money put in can't be spread: say it's one bet, and that the smaller size is the advice. */
function sizedVerdict(s: Spread) {
  return s.kept >= 0.5
    ? `One bet, sized down. These prices don't reward spreading this view across contracts, so Contour recommends putting in ${usd(s.atRisk)} of your ${money(s.stake)} and keeping the rest back.`
    : "One bet. These prices don't reward spreading this view across contracts, so it's all-or-nothing on what you put in.";
}
