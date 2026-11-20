"use client";

import { PageTransition } from "@/components/PageTransition";
import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, ViewTransition } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { compile, fromMarket, likelyRange, marketMoments, type Ladder } from "@contour/core";
import { ArrowRight, Search } from "lucide-react";
import { desk, type CategorySection, type MarketSummary } from "@/lib/desk";
import exampleLadder from "@/lib/example-ladder.json";
import { MarketCard } from "@/components/MarketCard";
import { s as lp } from "@/components/landing/styles";
import { fontVars } from "@/components/landing/fonts";
import { STEPS } from "@/components/landing/steps";
import { BackToTop } from "@/components/BackToTop";
import { FrozenBanner } from "@/components/FrozenBanner";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { ProfitChart } from "@/components/charts/ProfitChart";
import { oneIn } from "@/components/forecast/ProfitCard";
import { Fill, StepBadge } from "@/components/forecast/Panel";
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
 * The SOL Nov 20 ladder frozen on Nov 17 (fixtures/sol_calm.json, a calm-week example).
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
  Economics: "Where the S&P and NASDAQ will close.",
  Tech: "Which company comes out on top?",
  Business: "Deals, IPOs and company milestones.",
  Crypto: "Where will the price land? Each ladder is one price at a set time.",
  Sports: "Game totals, quarter totals and season win totals.",
  Culture: "Awards, reviews and box office.",
  Commodities: "Where will gold, oil, gas, silver or copper close?",
  Midterms: "The 2026 US House and Senate races.",
  Weather: "How hot will it get? Each outcome is a temperature range.",
};

/** A section's one-line description, when it has one. */
const subtitleFor = (category: string): string | undefined => SUBTITLE[category];

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
  const sub = subtitleFor(name);
  return (
    <div id={slug(name)} className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1 px-1 pb-2.5 pt-4">
        <div className="min-w-0">
          <h3 className="text-[24px] leading-tight text-inkstone">{name}</h3>
          {sub && <p className="mt-0.5 text-[13.5px] text-slate">{sub}</p>}
        </div>
        {section && (
          <p className="tnum text-[13px] text-smoke">
            <b className="font-bold text-inkstone">{volumeText(section.volume24h)}</b> traded in the last 24h · {sorted.length}{" "}
            {sorted.length === 1 ? "market" : "markets"} tradable as one curve
          </p>
        )}
      </div>
      {sorted.length > 0 ? (
        <PagedGrid cards={sorted} resetKey={search} />
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

/** How many market cards a page shows: eight rows of three on wide screens. */
const PAGE_SIZE = 24;

/** Page numbers to show: the first, the last, and the current page with its neighbours; gaps become "…". */
function pageList(page: number, pages: number): (number | "gap")[] {
  const keep = new Set([0, pages - 1, page - 1, page, page + 1].filter((p) => p >= 0 && p < pages));
  const out: (number | "gap")[] = [];
  [...keep]
    .sort((a, b) => a - b)
    .forEach((p, i, arr) => {
      if (i > 0 && p - arr[i - 1] > 1) out.push("gap");
      out.push(p);
    });
  return out;
}

/**
 * Market cards, a page at a time, with a pager under them. Back to the first page whenever the list
 * changes (a new search); changing page brings the top of the list back into view.
 */
function PagedGrid({ cards, resetKey }: { cards: MarketSummary[]; resetKey: string }) {
  const [page, setPage] = useState(0);
  const top = useRef<HTMLDivElement>(null);
  const pages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  useEffect(() => setPage(0), [resetKey]);
  const current = Math.min(page, pages - 1);
  // After a page change has rendered, bring the top of the list back under the nav if it's above it.
  const turned = useRef(false);
  useEffect(() => {
    if (!turned.current) return;
    turned.current = false;
    const y = top.current?.getBoundingClientRect().top ?? 0;
    if (y < 100) window.scrollBy({ top: y - 140, behavior: "instant" as ScrollBehavior });
  }, [page]);
  const go = (p: number) => {
    turned.current = true;
    setPage(p);
  };
  const shown = cards.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const pill = (on: boolean) =>
    `tnum flex h-9 min-w-9 items-center justify-center rounded-full px-3 text-[14px] font-medium transition-colors ${
      on ? "bg-inkstone text-porcelain" : "text-inkstone hover:bg-cloud"
    }`;
  return (
    <div ref={top}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((m) => (
          <ViewTransition key={m.ticker} enter="card-enter" exit="card-exit" default="none">
            <MarketCard m={m} />
          </ViewTransition>
        ))}
      </div>
      {pages > 1 && (
        <nav aria-label="Pages of markets" className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="tnum text-[13px] text-smoke">
            {current * PAGE_SIZE + 1}–{current * PAGE_SIZE + shown.length} of {cards.length}
          </p>
          <div className="flex items-center gap-1">
            <button type="button" className={`${pill(false)} disabled:opacity-35`} disabled={current === 0} onClick={() => go(current - 1)} aria-label="Previous page">
              <ArrowRight size={16} strokeWidth={2} className="rotate-180" aria-hidden="true" />
            </button>
            {pageList(current, pages).map((p, i) =>
              p === "gap" ? (
                <span key={`gap-${i}`} className="px-1 text-smoke" aria-hidden="true">
                  …
                </span>
              ) : (
                <button key={p} type="button" className={pill(p === current)} aria-current={p === current ? "page" : undefined} onClick={() => go(p)}>
                  {p + 1}
                </button>
              ),
            )}
            <button type="button" className={`${pill(false)} disabled:opacity-35`} disabled={current === pages - 1} onClick={() => go(current + 1)} aria-label="Next page">
              <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}

/** All sections at once: every tradable market in one list, busiest in the last 24 hours first. */
function AllMarkets({ cards, total, search }: { cards: MarketSummary[]; total: number; search: string }) {
  if (!cards.length) return null;
  const sorted = [...cards].sort(byActivity);
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1 px-1 pb-2.5 pt-4">
        <div className="min-w-0">
          <h3 className="text-[24px] leading-tight text-inkstone">All markets</h3>
          <p className="mt-0.5 text-[13.5px] text-slate">Every section, busiest in the last 24 hours first.</p>
        </div>
        {total > 0 && (
          <p className="tnum text-[13px] text-smoke">
            <b className="font-bold text-inkstone">{volumeText(total)}</b> traded in the last 24h · {sorted.length} tradable as one curve
          </p>
        )}
      </div>
      <PagedGrid cards={sorted} resetKey={search} />
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
                <span className="tnum shrink-0 text-[12px] text-slate" title={`${counts.get(c) ?? 0} markets tradable as one curve`}>
                  {counts.get(c) ?? 0} tradable
                </span>
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function HomeContent() {
  const q = useQuery({ queryKey: ["markets"], queryFn: desk.markets, refetchInterval: 60_000 });
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
  // Only markets that read as one curve or one set of ranges: "who will win" (categorical) markets
  // aren't listed. A section left with nothing to show drops out of the list.
  const listed = markets.filter((m) => m.kind !== "categorical");
  const cats = [...sections.map((s) => s.category), ...[...new Set(markets.map((m) => m.category))].filter((c) => !bySection.has(c))].filter((c) =>
    listed.some((m) => m.category === c),
  );
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
          <h1 className="text-[36px] leading-[1.08] text-inkstone xl:text-[46px]">
            Trade your whole <span className="text-slate">view.</span>
          </h1>
          <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-slate">
            Say where you think a market will land. Contour turns that view into one trade built from Gemini&apos;s YES/NO contracts, with the payout locked on Solana.
          </p>
          {/* The same four steps as the landing page's "How it works" (steps.ts), in their short form. */}
          <ol className="mt-5 flex flex-col gap-2.5 text-[14px]">
            {STEPS.map(({ title, short }, i) => (
              <li key={title} className="flex items-start gap-2.5">
                {/* pinned to the first line, so a step that wraps keeps its number beside the title */}
                <span className="shrink-0">
                  <StepBadge n={i + 1} />
                </span>
                <span>
                  <b className="text-inkstone">{title}</b> <span className="text-slate">· {short}</span>
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
              {cat === null ? (
                // All sections: one list of every tradable market, busiest in the last 24 hours first.
                <AllMarkets cards={filtered} total={totalVolume24h} search={query} />
              ) : (
                shownCats.map((c) => <CategoryBlock key={c} name={c} section={bySection.get(c)} cards={filtered.filter((m) => m.category === c)} search={query} />)
              )}
            </div>
          </ViewTransition>
          {search &&
            q.data &&
            (cat === null ? filtered.length === 0 : shownCats.every((c) => !filtered.some((m) => m.category === c) && !(bySection.get(c)?.popular ?? []).some((p) => p.title.toLowerCase().includes(search.toLowerCase())))) && (
              <p className="mt-4 rounded-[24px] bg-cloud px-4 py-3 text-slate">Nothing on Gemini matches &ldquo;{search}&rdquo; right now.</p>
            )}
        </div>
      </div>
    </div>
  );
}

/** The page, animated in and out on navigation. */
/**
 * The page, animated in and out on navigation, in the landing page's style: (the nav and footer are the app's global ones),
 * and the same palette, type and controls over the app's own pieces (see .lp-app in landing.css).
 */
export default function Markets() {
  return (
    <div className={`${lp.root} ${lp.app} ${fontVars} overflow-x-clip`}>
      <PageTransition>
        <HomeContent />
      </PageTransition>
    </div>
  );
}
