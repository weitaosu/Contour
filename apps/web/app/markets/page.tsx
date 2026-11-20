"use client";

import { smoothScrollToElement } from "@/lib/scroll";
import { PageTransition } from "@/components/PageTransition";
import { startTransition, useDeferredValue, useEffect, useMemo, useState, ViewTransition } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { compile, fromMarket, likelyRange, marketMoments, type Ladder } from "@contour/core";
import { ArrowDown, ArrowRight, LineChart, Lock, Search, SlidersHorizontal } from "lucide-react";
import { desk, type CategorySection, type MarketSummary } from "@/lib/desk";
import exampleLadder from "@/lib/example-ladder.json";
import { MarketCard } from "@/components/MarketCard";
import { BackToTop } from "@/components/BackToTop";
import { FrozenBanner } from "@/components/FrozenBanner";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { ProfitChart } from "@/components/charts/ProfitChart";
import { oneIn, Tile } from "@/components/forecast/ProfitCard";
import { Fill, Panel, StepBadge } from "@/components/forecast/Panel";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { pct, usd0 } from "@/lib/format";
import { isWin, runs, whenPhrase } from "@/lib/outcomes";

const VIEWS = [
  { label: "A tighter view", shift: 0, scale: 0.6 },
  { label: "A bullish view", shift: 0.6, scale: 0.8 },
  { label: "A tighter view", shift: 0, scale: 0.6 },
  { label: "A bearish view", shift: -0.6, scale: 0.8 },
];

/**
 * The SOL Nov 20 ladder frozen on Nov 17 (fixtures/sol_calm.json, the FAQ's calm-week example).
 * Shown when live market data can't be loaded, so the preview is never blank.
 */
const EXAMPLE = exampleLadder.ladder as unknown as Ladder;
const EXAMPLE_DATE = new Date(exampleLadder.capturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/** The white, violet-ringed style of the panels you work in (as inside a market). */
const FOCUS = "bg-porcelain shadow-[0_0_0_1.5px_rgba(89,79,244,0.28),0_12px_32px_-14px_rgba(89,79,244,0.45)]";

function pickFeatured(ms: MarketSummary[]): MarketSummary | undefined {
  const dayAhead = Date.now() + 24 * 3600_000;
  const sol = ms.filter((m) => m.kind === "threshold" && m.ticker.startsWith("SOL") && new Date(m.expiry).getTime() > dayAhead);
  sol.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return sol[0] ?? ms.find((m) => m.kind === "threshold");
}

/**
 * A live replica of the two panels inside a market ("Shape your view" → "What you make"), built
 * from the same charts, cycling through example views so the curve and payouts reshape on their own.
 */
function LivePreview({ ticker }: { ticker: string | null }) {
  const q = useQuery({ queryKey: ["ladder", ticker], queryFn: () => desk.ladder(ticker!), refetchInterval: 30_000, enabled: ticker !== null });
  // Live when we have it; the saved example when Gemini (or the desk) can't provide one.
  const live = ticker !== null && !!q.data;
  const source: Ladder | null = live ? q.data!.ladder : ticker === null || q.isError ? EXAMPLE : null;
  const frozenDate = live && q.data!.frozen ? new Date(q.data!.capturedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : null;
  const [hover, setHover] = useState<number | null>(null);
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (hover !== null || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const i = setInterval(() => setPhase((p) => (p + 1) % VIEWS.length), 2800);
    return () => clearInterval(i);
  }, [hover]);
  const viewSpec = VIEWS[phase];
  const view = useMemo(() => {
    if (!source) return null;
    const ladder = source;
    const sd = marketMoments(ladder).sd;
    const belief = fromMarket(ladder, viewSpec.shift * sd, viewSpec.scale);
    const quote = compile({ ladder, belief, confidence: 1, stakeUsd: 100 });
    const [a, b] = likelyRange(ladder.marketProb, 0.5);
    return { ladder, belief, quote, likely: { from: a, to: b } };
  }, [source, viewSpec]);

  if (!view) return <div className={`min-h-[420px] rounded-[24px] ${FOCUS}`} />;
  const { ladder, belief, quote, likely } = view;
  const wins = quote.payoutByBucket.map((p) => isWin(p, 100));
  const zones = runs(wins, (w) => w);
  const chance = ladder.marketProb.reduce((s, q, j) => s + (wins[j] ? q : 0), 0);
  return (
    <section aria-label="Live preview" className={`flex min-w-0 flex-col rounded-[24px] p-4 ${FOCUS}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] text-smoke">
            {live && !frozenDate && <span className="live-dot" aria-hidden="true" />}
            {frozenDate ? `Frozen ${frozenDate}` : live ? "Live preview" : `Snapshot from ${EXAMPLE_DATE}`} · {ladder.category}
          </p>
          <p className="mt-0.5 text-[16px] font-bold leading-tight text-inkstone">{ladder.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <span key={phase} className="fade-in tnum rounded-full bg-signal-violet/10 px-3 py-1 text-[13px] font-bold text-signal-violet">
            {viewSpec.label}
          </span>
          {ticker && (
            <Link href={`/m/${ticker}`} className="btn btn-primary !gap-1.5 !px-4 !py-1.5 text-[14px]">
              Open <ArrowRight size={15} strokeWidth={2.25} />
            </Link>
          )}
        </div>
      </header>
      {/* the two panels from inside a market, side by side, with the same "this drives that" arrow */}
      <div className="relative mt-3 grid flex-1 gap-2 md:grid-cols-2">
        <div className="flex min-w-0 flex-col rounded-[18px] bg-cloud p-3">
          <p className="flex items-center gap-2 text-[14px] font-bold text-inkstone">
            <StepBadge n={2} /> Shape your view
          </p>
          <Fill fallback={210} className="mt-2 h-[220px] lg:h-auto lg:min-h-[200px] lg:flex-1">
            {(h) => <ProbabilityChart bucketLabels={ladder.bucketLabels} cutLabels={ladder.cutLabels} cuts={ladder.cuts} market={ladder.marketProb} you={belief} hover={hover} onHover={setHover} height={h} />}
          </Fill>
        </div>
        <div className="flex min-w-0 flex-col rounded-[18px] bg-cloud p-3">
          <p className="flex items-center gap-2 text-[14px] font-bold text-inkstone">
            <StepBadge n={3} /> What you make
          </p>
          <p className="mt-1 truncate text-[13.5px] text-slate">
            {zones.length ? (
              <>
                $100 makes money <span className="font-bold text-signal-violet">{whenPhrase(ladder, zones)}</span>
              </>
            ) : (
              "Too close to the market to trade"
            )}
          </p>
          <Fill fallback={190} className="h-[200px] lg:h-auto lg:min-h-[180px] lg:flex-1">
            {(h) => (
              <ProfitChart
                pl={quote.payoutByBucket.map((p) => p - 100)}
                wins={wins}
                stake={100}
                hover={hover}
                onHover={setHover}
                cutLabels={ladder.cutLabels}
                bucketLabels={ladder.bucketLabels}
                cuts={ladder.cuts}
                likely={likely}
                likelyBracket={false}
                height={h}
              />
            )}
          </Fill>
        </div>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-signal-violet text-white shadow-md ring-4 ring-porcelain md:flex"
        >
          <ArrowRight size={16} strokeWidth={2.5} />
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="rounded-[18px] bg-cloud px-4 py-2.5">
          <p className="text-[11.5px] uppercase tracking-[0.075em] text-smoke">Really at risk</p>
          <p className="tnum text-[19px] font-bold text-inkstone">
            <AnimatedNumber value={100 - quote.minPayout} format={usd0} />
          </p>
        </div>
        <div className="rounded-[18px] bg-cloud px-4 py-2.5">
          <p className="text-[11.5px] uppercase tracking-[0.075em] text-smoke">Most you can make</p>
          <p className="tnum text-[19px] font-bold text-gain">
            +<AnimatedNumber value={quote.maxPayout - 100} format={usd0} />
          </p>
        </div>
        <div className="rounded-[18px] bg-cloud px-4 py-2.5">
          <p className="text-[11.5px] uppercase tracking-[0.075em] text-smoke">Chance of profit</p>
          <p className="tnum text-[19px] font-bold text-inkstone">
            {pct(chance)} <span className="text-[12.5px] font-medium text-slate">{oneIn(chance)}</span>
          </p>
        </div>
      </div>
    </section>
  );
}

const SUBTITLE: Record<string, string> = {
  Politics: "Who will win? Elections and nominations where exactly one candidate can win.",
  Economics: "Fed decisions and where the S&P and NASDAQ will close.",
  Tech: "Which company comes out on top?",
  Business: "Deals, IPOs and company milestones.",
  Crypto: "Where will the price land? Each ladder is one price at a set time.",
  Sports: "Game totals and season races.",
  Culture: "Awards, reviews and box office.",
  Commodities: "Where will gold, oil, gas, silver or copper close?",
  Midterms: "The 2026 US House and Senate races.",
  Weather: "How hot will it get? Each outcome is a temperature range.",
};

/** A group made only of races (one winner among named outcomes) gets race wording, whatever its category. */
function subtitleFor(category: string, ms: MarketSummary[]): string | undefined {
  if (SUBTITLE[category]) return SUBTITLE[category];
  if (ms.length && ms.every((m) => m.kind === "categorical")) return "Which will it be? Exactly one of the outcomes wins.";
  return undefined;
}

/** "$1.5M", "$624k", "$1,050": how much a section trades, at a glance. */
const volumeText = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 10_000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v).toLocaleString("en-US")}`;

const slug = (s: string) => `section-${s.toLowerCase().replace(/[^a-z]+/g, "-")}`;

/** Busiest first: traded in the last 24 hours, then since listing. */
const byActivity = (a: { volume24h?: number | null; volume?: number | null }, b: { volume24h?: number | null; volume?: number | null }) =>
  (b.volume24h ?? 0) - (a.volume24h ?? 0) || (b.volume ?? 0) - (a.volume ?? 0);

/**
 * One section per Gemini category, busiest in the last 24 hours first: every market Contour can
 * trade as one curve (all of them, busiest first), then its most active markets that can't be, and
 * why. Every popular corner of Gemini shows up, even one where nothing can be traded as a curve yet.
 */
function CategoryBlock({ name, section, cards, search }: { name: string; section: CategorySection | undefined; cards: MarketSummary[]; search: string }) {
  const sorted = [...cards].sort(byActivity);
  const popular = (section?.popular ?? []).filter((p) => !search || p.title.toLowerCase().includes(search.toLowerCase()));
  if (!sorted.length && !popular.length) return null;
  const sub = subtitleFor(name, cards);
  return (
    <div id={slug(name)} className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1 px-1 pb-2.5 pt-4">
        <div className="min-w-0">
          <h3 className="text-[20px] font-bold leading-tight text-inkstone">{name}</h3>
          {sub && <p className="mt-0.5 text-[13.5px] text-slate">{sub}</p>}
        </div>
        {section && (
          <p className="tnum text-[13px] text-smoke">
            <b className="font-bold text-inkstone">{volumeText(section.volume24h)}</b> traded in the last 24h · {section.tradable} of {section.events}{" "}
            {section.events === 1 ? "market" : "markets"} tradable as one curve
          </p>
        )}
      </div>
      {sorted.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((m) => (
            <ViewTransition key={m.ticker} enter="card-enter" exit="card-exit" default="none">
              <MarketCard m={m} />
            </ViewTransition>
          ))}
        </div>
      ) : (
        <p className="rounded-[24px] bg-cloud px-4 py-3 text-[14px] text-slate">
          None of these markets form one set of outcomes yet, so there&apos;s nothing to trade as a curve here today.
        </p>
      )}
      {popular.length > 0 && (
        <div className="mt-2 rounded-[24px] border border-mist px-4 py-3">
          <p className="text-[12px] uppercase tracking-[0.075em] text-smoke">Also active here · traded on Gemini, but not as one curve</p>
          <ul className="mt-1 divide-y divide-mist">
            {popular.map((p) => (
              <li key={p.ticker} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[14px] text-inkstone" title={p.title}>
                  {p.title}
                </span>
                <span className="tnum text-[13px] text-smoke" title={`${volumeText(p.volume)} traded since it listed`}>
                  {volumeText(p.volume24h)} in 24h
                </span>
                <span className="rounded-full bg-cloud px-2.5 py-0.5 text-[12.5px] text-slate">{p.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The left-hand panel: search, and every section with a bar for how much it trades. */
function SectionsPanel({
  cats,
  bySection,
  counts,
  cat,
  setCat,
  search,
  setSearch,
  total,
}: {
  cats: string[];
  bySection: Map<string, CategorySection>;
  counts: Map<string, number>;
  cat: string | null;
  setCat: (c: string | null) => void;
  search: string;
  setSearch: (s: string) => void;
  total: number;
}) {
  const max = Math.max(1, ...[...bySection.values()].map((s) => s.volume24h));
  const row = (on: boolean) =>
    `ease flex w-full flex-col gap-1 rounded-[12px] px-2.5 py-1.5 text-left ${on ? "bg-porcelain shadow-[0_0_0_1.5px_rgba(89,79,244,0.28)]" : "hover:bg-porcelain"}`;
  return (
    <aside aria-label="Sections" className="rounded-[24px] bg-cloud p-4 lg:sticky lg:top-[88px]">
      <h2 className="flex items-center gap-2 text-[16px] font-bold leading-tight text-inkstone">
        <StepBadge n={1} /> Pick a market
      </h2>
      <p className="mt-1 text-[13px] leading-snug text-slate">Every section of Gemini, busiest first. Bars show what traded in the last 24 hours.</p>
      <label className="relative mt-3 block">
        <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-smoke" />
        <input
          className="input !rounded-full !py-2 !pl-10 text-[14px]"
          placeholder="Search SOL, Fed, S&P…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search markets"
        />
      </label>
      {/* phones: wrapping chips; wide screens: a list with volume bars */}
      <div className="mt-3 flex flex-wrap gap-1.5 lg:hidden">
        <button className={`tag !text-[13px] ${cat === null ? "tag-active" : "tag-white"}`} onClick={() => setCat(null)}>
          All
        </button>
        {cats.map((c) => (
          <button key={c} className={`tag !text-[13px] ${cat === c ? "tag-active" : "tag-white"}`} onClick={() => setCat(cat === c ? null : c)}>
            {c}
          </button>
        ))}
      </div>
      <nav className="mt-3 hidden flex-col lg:flex">
        <button type="button" className={row(cat === null)} onClick={() => setCat(null)} aria-pressed={cat === null}>
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[14px] font-bold text-inkstone">All sections</span>
            <span className="tnum text-[12.5px] text-smoke">{total} tradable</span>
          </span>
        </button>
        {cats.map((c) => {
          const s = bySection.get(c);
          const on = cat === c;
          return (
            <button key={c} type="button" className={row(on)} onClick={() => setCat(on ? null : c)} aria-pressed={on}>
              <span className="flex items-baseline justify-between gap-2">
                <span className={`text-[14px] font-bold ${on ? "text-signal-violet" : "text-inkstone"}`}>{c}</span>
                <span className="tnum text-[12.5px] text-smoke" title={s ? `${volumeText(s.volume24h)} traded in the last 24 hours · ${volumeText(s.volume)} since its markets listed` : undefined}>
                  {s ? volumeText(s.volume24h) : ""}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {/* square-root scale, so a $1k section still shows next to a $1.5M one; the label has the real figure */}
                <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-mist">
                  {s && <span className={`block h-full rounded-full ${on ? "bg-signal-violet" : "bg-ash"}`} style={{ width: `${Math.max(3, Math.sqrt(s.volume24h / max) * 100)}%` }} />}
                </span>
                <span className="tnum shrink-0 text-[12px] text-slate" title={s ? `${counts.get(c) ?? 0} of ${s.events} markets tradable as one curve` : undefined}>
                  {counts.get(c) ?? 0}
                  {s ? `/${s.events}` : ""} tradable
                </span>
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

const KINDS = [
  { q: "Where will a number land?", ex: "SOL, gold, the S&P at year-end", how: "One yes/no contract per strike or range, read as one curve: say “around $73, give or take $3”." },
  { q: "Which range will it fall in?", ex: "Daily high temperature", how: "Each contract is one range and exactly one happens, so your view is a chance for each." },
  { q: "Who will win?", ex: "2028 nominees, the Fed in December, Best AI", how: "Only when Gemini's rules say exactly one wins and its prices agree. Give each outcome your own odds." },
];

/** Demo direct-payment mode: the answers that would otherwise promise escrow. */
const DIRECT_FAQ: Record<string, string> = {
  "Why is this on a blockchain at all?":
    "In the full design, for the locked payout schedule, the user-side timeouts and a forecast record that cannot be backdated. This demo runs in direct-payment mode: payments go straight to Contour's account, with no escrow.",
  "What is simulated in this demo?":
    "Payments are real transactions with test USDC, sent straight to Contour's account. The desk's hedge on Gemini is simulated at live quotes.",
};

const FAQ: [string, string][] = [
  ["Why not just buy one contract?", "One contract pays only if the outcome lands past one strike. A Contour position pays across the whole range you believe in, with a floor you can see before you sign. On the SOL calm-week example it profits anywhere from $67 to $77 and cannot lose more than $37."],
  ["More legs means more spread paid.", "Yes. The solver optimizes at ask prices, so costs are inside the answer, and the screen shows the expected return if the market is right. When costs exceed your edge it buys nothing and tells you there is no trade."],
  ["Users are overconfident; won't Kelly sizing ruin them?", "Sizing follows the Kelly rule, which only puts in what your view's edge justifies and never charges the part it doesn't need. Unsure? Follow your view less closely and it puts in less. Stake is also capped per position and per day by the Solana program, not the app."],
  ["Why is this on a blockchain at all?", "For the locked payout schedule, the user-side timeouts, and a forecast record that cannot be backdated. The desk's collateral sits in escrow before any hedge is placed."],
  ["The desk is still a trusted party.", "Only for posting the outcome, which is public and checkable against Gemini's settlement data. It cannot change the payout schedule or withhold funds; if it never posts, anyone can unwind after a grace period."],
  ["What is simulated in this demo?", "Escrow, deposits, collateral and payouts are real devnet transactions with test USDC. The desk's hedge fills are simulated at live Gemini quotes and labelled as such."],
];

function HomeContent() {
  const q = useQuery({ queryKey: ["markets"], queryFn: desk.markets, refetchInterval: 60_000 });
  // Demo direct-payment mode: payments go straight to one wallet, so the escrow promises don't apply.
  const payTo = useQuery({ queryKey: ["config"], queryFn: desk.config, staleTime: 60_000 }).data?.payTo ?? null;
  const faq = payTo ? FAQ.map(([qq, a]) => [qq, DIRECT_FAQ[qq] ?? a] as [string, string]) : FAQ;
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const markets = q.data?.markets ?? [];
  const featured = pickFeatured(markets);
  // The desk answered but Gemini gave it nothing (an outage), or the desk itself is down.
  const offline = q.isError || (!!q.data && markets.length === 0);
  // Every Gemini category with markets, busiest first (from the desk's per-category volume); any
  // category the desk didn't report (the demo samples) goes last.
  const sections = q.data?.sections ?? [];
  const bySection = new Map(sections.map((s) => [s.category, s]));
  const cats = [...sections.map((s) => s.category), ...[...new Set(markets.map((m) => m.category))].filter((c) => !bySection.has(c))];
  // A made-up sample race only fills in for a section with no real race of its own.
  const hasRealRace = new Set(markets.filter((m) => !m.sample && m.kind === "categorical").map((m) => m.category));
  const listed = markets.filter((m) => !(m.sample && hasRealRace.has(m.category)));
  // Results follow the search a beat behind the keystrokes, which is what lets cards animate in and out.
  const query = useDeferredValue(search);
  const filtered = listed.filter((m) => !query || `${m.title} ${m.ticker}`.toLowerCase().includes(query.toLowerCase()));
  const counts = new Map(cats.map((c) => [c, listed.filter((m) => m.category === c).length]));
  const shownCats = cats.filter((c) => !cat || c === cat);
  const totalVolume24h = sections.reduce((s, x) => s + x.volume24h, 0);
  const pick = (c: string | null) => {
    // Bring the list's top into view first (instantly: the crossfade below hides the jump), then
    // swap sections inside a transition so the old list fades out as the new one rises in.
    const top = document.getElementById("markets")?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy({ top: top - 80, behavior: "instant" as ScrollBehavior });
    startTransition(() => setCat(c));
  };

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-2 px-4 pb-8 pt-3 md:px-6">
      <BackToTop />
      {q.data?.frozenAt ? <FrozenBanner at={q.data.frozenAt} className="!py-3" /> : null}

      {/* Intro beside a live preview of the panels inside a market */}
      <div className="grid items-stretch gap-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.45fr)]">
        <section className="flex min-w-0 flex-col rounded-[24px] bg-cloud p-5 xl:p-6">
          <p className="text-[12.5px] uppercase tracking-[0.075em] text-smoke">Gemini prediction markets · locked on Solana</p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.05] tracking-[0.01em] text-inkstone xl:text-[42px]">Trade your whole view.</h1>
          <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-slate">
            Draw where you think an outcome will land. Contour buys the set of contracts that pays most where you and the market disagree, and locks the payout on-chain
            before a single trade is placed.
          </p>
          <ol className="mt-5 flex flex-col gap-2.5 text-[14px]">
            {[
              ["Pick a market", "any popular section of Gemini, below"],
              ["Shape your view", "drag a curve, or rate each outcome"],
              ["See what you make", "in every outcome, before you sign"],
              ["Lock it on Solana", "the payouts are fixed before any trade"],
            ].map(([t, d], i) => (
              <li key={t} className="flex items-center gap-2.5">
                <StepBadge n={i + 1} />
                <span>
                  <b className="text-inkstone">{t}</b> <span className="text-slate">· {d}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-2">
            {featured ? (
              <Link href={`/m/${featured.ticker}`} className="btn btn-primary !gap-1.5 !px-5 !py-2.5">
                Open {featured.title.replace(/ price on /, " ")} <ArrowRight size={16} strokeWidth={2.25} />
              </Link>
            ) : (
              <span className="btn btn-primary" aria-disabled="true">
                {offline ? "Live markets are unavailable right now" : "Loading markets…"}
              </span>
            )}
            <a
              href="#markets"
              className="group btn btn-quiet !gap-1.5 !px-5 !py-2.5"
              onClick={(e) => {
                const el = document.getElementById("markets");
                if (!el) return;
                e.preventDefault();
                smoothScrollToElement(el);
                history.replaceState(null, "", "#markets");
              }}
            >
              Browse markets{" "}
              <ArrowDown size={16} strokeWidth={2} className="group-hover:translate-y-0.5" style={{ transition: "translate var(--spring-ms) var(--spring)" }} />
            </a>
          </div>
          <div className="mt-auto grid grid-cols-3 gap-2 pt-6">
            <Tile compact label="Tradable" value={q.data ? listed.length : "…"} sub="as one curve" />
            <Tile compact label="Sections" value={q.data ? sections.length : "…"} sub="of Gemini" />
            <Tile compact label="Traded" value={q.data ? volumeText(totalVolume24h) : "…"} sub="in the last 24h" />
          </div>
        </section>
        {featured || offline ? <LivePreview ticker={featured?.ticker ?? null} /> : <div className={`min-h-[420px] rounded-[24px] ${FOCUS}`} />}
      </div>

      {/* The market browser: sections on the left, their markets on the right */}
      <div id="markets" className="mt-2 grid scroll-mt-20 items-start gap-2 lg:grid-cols-[256px_minmax(0,1fr)]">
        <SectionsPanel cats={cats} bySection={bySection} counts={counts} cat={cat} setCat={pick} search={search} setSearch={setSearch} total={listed.length} />
        <div className="flex min-w-0 flex-col gap-2">
          {q.isError && (
            <p className="rounded-[24px] bg-cloud px-4 py-3 text-slate">
              The desk is not reachable. Start it with <code>pnpm dev:desk</code>.
            </p>
          )}
          {q.data && markets.length === 0 && (
            <p className="rounded-[24px] bg-cloud px-4 py-3 text-slate">
              No markets came back from Gemini. Its prediction-market API isn&apos;t responding right now, so this list will fill in on its own when it recovers.
            </p>
          )}
          {!q.data && !q.isError && (
            <div className="grid gap-2 pt-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="h-[250px] rounded-[24px] bg-cloud" />
              ))}
            </div>
          )}
          <ViewTransition key={cat ?? "all"} enter="list-swap" exit="list-swap" default="none">
            <div className="flex min-w-0 flex-col gap-2">
              {shownCats.map((c) => (
                <CategoryBlock key={c} name={c} section={bySection.get(c)} cards={filtered.filter((m) => m.category === c)} search={query} />
              ))}
            </div>
          </ViewTransition>
          {search &&
            q.data &&
            shownCats.every((c) => !filtered.some((m) => m.category === c) && !(bySection.get(c)?.popular ?? []).some((p) => p.title.toLowerCase().includes(search.toLowerCase()))) && (
              <p className="mt-4 rounded-[24px] bg-cloud px-4 py-3 text-slate">Nothing on Gemini matches &ldquo;{search}&rdquo; right now.</p>
            )}
        </div>
      </div>

      {/* What you can trade, how it works, and the questions people ask: three panels */}
      <div id="how" className="mt-6 grid scroll-mt-20 items-stretch gap-2 lg:grid-cols-3">
        <Panel title="What you can trade" hint="Any Gemini market where the outcomes form one set and exactly one of them happens.">
          <ol className="flex flex-col gap-3">
            {KINDS.map((k, i) => (
              <li key={k.q} className="flex gap-3">
                <StepBadge n={i + 1} />
                <div className="min-w-0 text-[13.5px]">
                  <p className="font-bold text-inkstone">{k.q}</p>
                  <p className="text-smoke">e.g. {k.ex}</p>
                  <p className="mt-0.5 leading-snug text-slate">{k.how}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-mist pt-3 text-[13px] leading-snug text-slate">
            <b className="text-inkstone">Not covered, on purpose:</b> single yes/no questions, markets where several outcomes can come true (“before which date…?”),
            races whose winner may not be listed, spreads and player props. Each section still lists its popular ones, with the reason.
          </p>
        </Panel>
        <Panel title="How it works" hint="One screen, two curves.">
          <ul className="flex flex-col gap-4">
            {[
              { icon: LineChart, t: "Reads the market's forecast", b: "A ladder of yes/no contracts becomes one probability curve, cleaned so it can be read at a glance." },
              { icon: SlidersHorizontal, t: "Compiles your forecast", b: "Set where and how sure. The solver sizes a growth-optimal position across every strike, at real ask prices." },
              payTo
                ? { icon: Lock, t: "Pays on Solana", b: "Your payment goes straight to Contour's account on Solana, with the payout schedule and a hash of your forecast." }
                : { icon: Lock, t: "Holds it on Solana", b: "Your stake and the desk's collateral sit in escrow with the payout schedule and a hash of your forecast." },
            ].map(({ icon: Icon, t, b }) => (
              <li key={t} className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-porcelain text-signal-violet">
                  <Icon size={18} strokeWidth={1.9} />
                </span>
                <div className="text-[13.5px]">
                  <p className="font-bold text-inkstone">{t}</p>
                  <p className="mt-0.5 leading-snug text-slate">{b}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
        <section aria-labelledby="faq-title" className="rounded-[24px] border border-mist p-4">
          <h2 id="faq-title" className="text-[16px] font-bold leading-tight text-inkstone">
            Questions
          </h2>
          <p className="mt-1 text-[13px] text-slate">The ones judges ask.</p>
          <Accordion type="single" collapsible className="mt-3 flex flex-col gap-1.5">
            {faq.map(([qq, a], i) => (
              <AccordionItem key={i} value={`q${i}`} title={qq}>
                {a}
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      </div>
    </div>
  );
}

/** The page, animated in and out on navigation. */
export default function Markets() {
  return (
    <PageTransition>
      <HomeContent />
    </PageTransition>
  );
}
