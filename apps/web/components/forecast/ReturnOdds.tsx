"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { paysIn, type Ladder, type Quote } from "@contour/core";
import { ScenarioTable } from "./ScenarioTable";
import { COLORS } from "@/components/charts/common";
import { GAIN } from "@/components/charts/ProfitChart";
import { isWin } from "@/lib/outcomes";
import type { Spread } from "@/lib/spread";
import { usd } from "@/lib/format";

/**
 * How likely each result is, for this hedge and for putting the whole stake on the single best
 * contract, as a dropdown. Built on two common ways of showing a range of outcomes:
 * - Frequency framing ("out of 100 bets like this"), the icon-array format risk-communication
 *   research finds lay readers judge most accurately. Each dot is filled by the money it brings
 *   back (a quantile dotplot), so "lose some" shows how much is kept, not just that it's a loss.
 * - A probability-of-return distribution, the view brokers put behind their P&L charts.
 * Everything is on the full stake for both bets, in dollars, so they compare like for like, and by
 * the market's odds. It leads with the profit or loss in every outcome; the dots are a tap away.
 */

type Q = Omit<Quote, "raw">;
type Cls = "win" | "some" | "all";

/** Losing this much or more counts as losing everything (a lost contract still returns rounding cash). */
const LOSE_ALL = -0.9;
const ORDER: Cls[] = ["win", "some", "all"];
const CLASS: Record<Cls, { label: string; short: string; color: string }> = {
  win: { label: "Make money", short: "make money", color: GAIN },
  some: { label: "Lose some: the fill is what's left", short: "lose some", color: COLORS.smoke },
  // An empty ring: nothing comes back. Reads the same in light and dark themes.
  all: { label: "Lose (nearly) everything", short: "lose it all", color: COLORS.slate },
};

/** Return bins, as upper edges on the return (−0.9 = 10% of the stake back). */
const EDGES = [LOSE_ALL, -0.5, -0.25, 0, 0.25, 0.5, 1, 2, 4, Infinity];
const binOf = (r: number) => EDGES.findIndex((hi) => r <= hi + 1e-9);

const money = (x: number) => {
  const a = Math.abs(x);
  const s = a >= 10 || Math.abs(a - Math.round(a)) < 0.005 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2);
  return `${x < -0.004 ? "−" : ""}$${s}`;
};
/** For sentences: rounding cash left over from a lost contract reads as nothing, not "$0.01". */
const left = (x: number) => (x < 0.5 ? "nothing" : money(x));
const leftShort = (x: number) => (x < 0.5 ? "$0" : money(x));
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

interface DotSpec {
  cls: Cls;
  /** Share of the stake that comes back, 0–1 (wins are drawn full). */
  fill: number;
}

interface Profile {
  /** Out of 100, per class (sums to 100). */
  counts: Record<Cls, number>;
  /** 100 bets, best first: each dot drawn by what it brings back. */
  dots: DotSpec[];
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

  // Within each class, share its dots among its outcomes by their odds, best outcome first.
  const dots: DotSpec[] = [];
  for (const k of ORDER) {
    const js = payout.map((_, j) => j).filter((j) => clsOf(j) === k && probs[j] > 0).sort((a, b) => payout[b] - payout[a]);
    if (!counts[k] || !js.length) continue;
    const n = outOf(js.map((j) => probs[j]), counts[k]);
    js.forEach((j, i) => {
      for (let m = 0; m < n[i]; m++) dots.push({ cls: k, fill: k === "win" ? 1 : Math.max(0, Math.min(1, payout[j] / stake)) });
    });
  }

  const real = payout.filter((_, j) => probs[j] >= 0.005);
  const rounded = new Set(real.map((p) => Math.round(p)));
  return {
    counts,
    dots,
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
  const [focus, setFocus] = useState<Cls | null>(null);
  const dotsId = useId();
  // Always the market's odds: what the prices say, not the user's own forecast.
  const { stake, probs, data } = useComparison(ladder, quote);

  const c = quote.comparison;
  const oneName = c ? `All on ${c.side.toUpperCase()} “${c.label}”` : "One contract";
  // Only a spread position is called a hedge; one contract with cash held back is just a smaller bet.
  const mine = sizedDown ? "Your bet" : "This hedge";
  return (
    <section aria-labelledby={`${dotsId}-title`} className={`min-w-0 rounded-[24px] bg-cloud px-4 py-3 transition-opacity duration-300 ${faded ? "opacity-45" : ""} ${className}`}>
      {/* The header is the toggle: its title, the takeaway, and Show / Hide. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={dotsId}
        onClick={() => setOpen((o) => !o)}
        className="ease -mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-4 rounded-[16px] px-2 py-1.5 text-left hover:bg-mist/40"
      >
        <span className="min-w-0">
          <span id={`${dotsId}-title`} className="block text-[16px] font-bold leading-tight text-inkstone">
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
        <div id={dotsId} className="pb-1 pt-2">
          {!data || !c ? (
            <p className="text-[13.5px] text-slate">Once you have a trade, this shows what it and the single best contract would make or lose in every outcome.</p>
          ) : (
            <>
              {/* The comparison as 100 bets first, then the same in dollars for every outcome */}
              <h3 className="text-[14px] font-bold text-inkstone">Out of 100 bets like this</h3>
              <p className="mt-0.5 text-[13px] text-slate">Each dot is one bet by the market&apos;s odds, filled by the money it brings back. Point at a group to pick it out in both.</p>
              <Takeaway>
                {sizedDown ? <SizedTakeaway s={sizedDown} /> : <DotTakeaway stake={stake} hedge={data.hedge} single={data.single} />}
              </Takeaway>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <DotCard title={mine} accent stake={stake} p={data.hedge} focus={focus} onFocus={setFocus} />
                <DotCard title={oneName} stake={stake} p={data.single} focus={focus} onFocus={setFocus} />
              </div>
              <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-slate" aria-label="Legend">
                {ORDER.map((k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <Dot spec={{ cls: k, fill: k === "some" ? 0.5 : k === "win" ? 1 : 0 }} size={12} />
                    {CLASS[k].label}
                  </li>
                ))}
              </ul>

              <h3 className="mt-5 text-[14px] font-bold text-inkstone">Profit or loss at settlement</h3>
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

/** The one line each section leads with: same quiet accent everywhere, so the eye learns where to look. */
function Takeaway({ children }: { children: ReactNode }) {
  return <p className="mt-2 border-l-2 border-signal-violet pl-3 text-[14px] leading-snug text-inkstone">{children}</p>;
}

/** The headline when the money put in can't be spread: say it's one bet, and that the smaller size is the advice. */
function sizedVerdict(s: Spread) {
  return s.kept >= 0.5
    ? `One bet, sized down. These prices don't reward spreading this view across contracts, so Contour recommends putting in ${usd(s.atRisk)} of your ${money(s.stake)} and keeping the rest back.`
    : "One bet. These prices don't reward spreading this view across contracts, so it's all-or-nothing on what you put in.";
}

function SizedTakeaway({ s }: { s: Spread }) {
  return (
    <>
      What comes back when it goes wrong is the <b>{usd(s.kept)}</b> kept back, not a hedge: the <b>{usd(s.atRisk)}</b> you put in is all-or-nothing, like one contract.
      Betting less is how this view stays smooth.
    </>
  );
}

function DotTakeaway({ stake, hedge, single }: { stake: number; hedge: Profile; single: Profile }) {
  const hl = hedge.counts.some + hedge.counts.all;
  const sl = single.counts.some + single.counts.all;
  if (hl === 0) return <>None of these 100 bets loses money with the hedge. With one contract, {sl} do.</>;
  const total = single.counts.all >= sl - 1;
  return (
    <>
      When the hedge loses, you usually keep part of it: on average <b>{money(hedge.lossKeep ?? 0)}</b> of your {money(stake)} comes back ({hl} of 100 bets).{" "}
      {total ? (
        <>
          When one contract loses, it&apos;s everything: <b>{left(single.lossKeep ?? 0)}</b> comes back ({sl} of 100).
        </>
      ) : (
        <>
          When one contract loses, <b>{leftShort(single.lossKeep ?? 0)}</b> comes back on average ({sl} of 100).
        </>
      )}
    </>
  );
}

/** One dot: solid when it makes money, filled from the bottom by what's left when it loses some, empty when nothing is. */
function DotMark({ spec, x, y, r, clip, dim = false }: { spec: DotSpec; x: number; y: number; r: number; clip: string; dim?: boolean }) {
  const style = { opacity: dim ? 0.18 : 1, transition: "opacity 200ms ease" };
  if (spec.cls === "win") return <circle cx={x + r} cy={y + r} r={r} fill={CLASS.win.color} style={style} />;
  if (spec.cls === "all") return <circle cx={x + r} cy={y + r} r={r - 1} fill="none" stroke={CLASS.all.color} strokeWidth={1.75} style={style} />;
  const h = 2 * r * spec.fill;
  return (
    <g transform={`translate(${x} ${y})`} style={style}>
      <g clipPath={`url(#${clip})`}>
        <rect x={0} y={2 * r - h} width={2 * r} height={h} fill={CLASS.some.color} />
      </g>
      <circle cx={r} cy={r} r={r - 0.75} fill="none" stroke={CLASS.some.color} strokeWidth={1.5} />
    </g>
  );
}

function Dot({ spec, size }: { spec: DotSpec; size: number }) {
  const clip = useId().replace(/:/g, "");
  const r = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      <defs>
        <clipPath id={clip}>
          <circle cx={r} cy={r} r={r} />
        </clipPath>
      </defs>
      <DotMark spec={spec} x={0} y={0} r={r} clip={clip} />
    </svg>
  );
}

/** A 10 × 10 icon array beside its three counts; pointing at a count picks out its dots. */
function DotCard({
  title,
  stake,
  p,
  accent = false,
  focus,
  onFocus,
}: {
  title: string;
  stake: number;
  p: Profile;
  accent?: boolean;
  focus: Cls | null;
  onFocus: (c: Cls | null) => void;
}) {
  const clip = useId().replace(/:/g, "");
  const summary = ORDER.map((k) => `${p.counts[k]} ${CLASS[k].short}`).join(", ");
  const note = (k: Cls) => {
    if (k === "win") return null;
    if (!p.counts[k]) return null;
    if (k === "all") return "nothing left";
    const js = p.dots.filter((d) => d.cls === "some");
    const avg = js.reduce((a, d) => a + d.fill, 0) / js.length;
    return `keep ${money(avg * stake)} on average`;
  };
  return (
    <figure className={`rounded-[18px] bg-porcelain p-3 ${accent ? "ring-[1.5px] ring-signal-violet/30" : ""}`}>
      <figcaption className={`truncate text-[13.5px] font-bold ${accent ? "text-signal-violet" : "text-inkstone"}`} title={title}>
        {title}
      </figcaption>
      <div className="mt-2 grid grid-cols-[minmax(0,180px)_1fr] items-center gap-4">
        <svg viewBox="0 0 200 200" role="img" aria-label={`${title}: out of 100 bets, ${summary}`} className="block w-full">
          <defs>
            <clipPath id={clip}>
              <circle cx={8} cy={8} r={8} />
            </clipPath>
          </defs>
          {p.dots.map((d, i) => (
            <DotMark key={i} spec={d} x={(i % 10) * 20 + 2} y={Math.floor(i / 10) * 20 + 2} r={8} clip={clip} dim={focus !== null && focus !== d.cls} />
          ))}
        </svg>
        <ul className="grid gap-1" onMouseLeave={() => onFocus(null)}>
          {ORDER.map((k) => (
            <li key={k}>
              <button
                type="button"
                onMouseEnter={() => onFocus(k)}
                onFocus={() => onFocus(k)}
                onBlur={() => onFocus(null)}
                className={`ease flex w-full items-center gap-2.5 rounded-[12px] px-2 py-1.5 text-left ${focus === k ? "bg-cloud" : ""} ${focus !== null && focus !== k ? "opacity-45" : ""}`}
              >
                <Dot spec={{ cls: k, fill: k === "some" ? 0.5 : k === "win" ? 1 : 0 }} size={11} />
                <span className="tnum w-8 shrink-0 text-[20px] font-bold leading-none text-inkstone">{p.counts[k]}</span>
                <span className="min-w-0 text-[13px] leading-tight text-slate">
                  {CLASS[k].short}
                  {note(k) && <span className="block text-[11.5px] text-smoke">{note(k)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}
