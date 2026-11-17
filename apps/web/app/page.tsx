"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { compile, fromMarket, marketMoments, type Ladder } from "@contour/core";

const VIEWS = [
  { label: "A tighter view", shift: 0, scale: 0.6 },
  { label: "A bullish view", shift: 0.6, scale: 0.8 },
  { label: "A tighter view", shift: 0, scale: 0.6 },
  { label: "A bearish view", shift: -0.6, scale: 0.8 },
];
import { LineChart, Lock, SlidersHorizontal, Search } from "lucide-react";
import { desk, type MarketSummary } from "@/lib/desk";
import { MarketCard } from "@/components/MarketCard";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { PayoutChart } from "@/components/charts/PayoutChart";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { pct, usd0 } from "@/lib/format";

function pickFeatured(ms: MarketSummary[]): MarketSummary | undefined {
  const dayAhead = Date.now() + 24 * 3600_000;
  const sol = ms.filter((m) => m.kind === "threshold" && m.ticker.startsWith("SOL") && new Date(m.expiry).getTime() > dayAhead);
  sol.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return sol[0] ?? ms.find((m) => m.kind === "threshold");
}

function HeroMockup({ ticker }: { ticker: string }) {
  const q = useQuery({ queryKey: ["ladder", ticker], queryFn: () => desk.ladder(ticker), refetchInterval: 30_000 });
  const [hover, setHover] = useState<number | null>(null);
  // Gently cycle through views so visitors see the curve and payouts reshape before they touch anything.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (hover !== null || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const i = setInterval(() => setPhase((p) => (p + 1) % VIEWS.length), 2600);
    return () => clearInterval(i);
  }, [hover]);
  const viewSpec = VIEWS[phase];
  const view = useMemo(() => {
    if (!q.data) return null;
    const ladder: Ladder = q.data.ladder;
    const sd = marketMoments(ladder).sd;
    const belief = fromMarket(ladder, viewSpec.shift * sd, viewSpec.scale);
    const quote = compile({ ladder, belief, confidence: 0.5, stakeUsd: 100 });
    return { ladder, belief, quote };
  }, [q.data, viewSpec]);

  if (!view) return <div className="h-[460px] rounded-[16px] bg-cloud" />;
  const { ladder, belief, quote } = view;
  return (
    <div className="relative mx-auto max-w-[1040px] pb-10 md:pb-32">
      {/* code panel, back right */}
      <div className="absolute -right-12 -top-24 hidden w-[300px] rounded-[16px] bg-inkstone p-5 font-mono text-[12.5px] leading-relaxed text-ash [box-shadow:var(--shadow-xl)] lg:block">
        <div className="mb-2 text-smoke">// PositionOpened · devnet</div>
        <div>
          <span className="text-porcelain">stake</span>: {quote.stakeBase.toLocaleString("en-US")}
        </div>
        <div>
          <span className="text-porcelain">schedule</span>: [{quote.scheduleBase.slice(0, 3).map((x) => (x / 1e6).toFixed(0)).join(", ")}, …]
        </div>
        <div>
          <span className="text-porcelain">max_payout</span>: {(quote.maxPayout).toFixed(2)}
        </div>
        <div>
          <span className="text-porcelain">state</span>: <span className="text-[#a9a3ff]">Active</span>
        </div>
      </div>
      {/* dashboard panel */}
      <div className="relative rounded-[16px] border border-mist bg-porcelain p-6 [box-shadow:var(--shadow-xl)] md:mr-16 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="eyebrow">Live · {ladder.category}</p>
            <p className="card-title mt-1">{ladder.title}</p>
          </div>
          <div className="flex items-center gap-4 text-[14px] text-slate">
            <span className="inline-flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm bg-mist ring-1 ring-smoke" /> Market
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-[3px] w-4 rounded-full bg-signal-violet" /> <span className="tnum">{viewSpec.label}</span>
            </span>
          </div>
        </div>
        <div className="mt-4">
          <ProbabilityChart bucketLabels={ladder.bucketLabels} cutLabels={ladder.cutLabels} cuts={ladder.cuts} market={ladder.marketProb} you={belief} hover={hover} onHover={setHover} height={240} />
          <PayoutChart payouts={quote.payoutByBucket} stake={100} hover={hover} onHover={setHover} height={140} bucketLabels={ladder.bucketLabels} />
        </div>
      </div>
      {/* stats panel, front left */}
      <div className="absolute -bottom-4 -left-10 hidden w-[250px] rounded-[16px] border border-mist bg-porcelain p-5 [box-shadow:var(--shadow-xl)] md:block">
        <p className="eyebrow">$100 position</p>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <div>
            <p className="text-[14px] text-smoke">Worst</p>
            <p className="text-[20px] font-bold"><AnimatedNumber value={quote.minPayout} format={usd0} /></p>
          </div>
          <div>
            <p className="text-[14px] text-smoke">Best</p>
            <p className="text-[20px] font-bold"><AnimatedNumber value={quote.maxPayout} format={usd0} /></p>
          </div>
          <div className="col-span-2">
            <p className="text-[14px] text-smoke">Profit if you&apos;re right</p>
            <p className="text-[20px] font-bold text-signal-violet"><AnimatedNumber value={quote.probProfitBelief} format={(n) => pct(n)} /></p>
          </div>
        </div>
      </div>
    </div>
  );
}

const SUBTITLE: Record<string, string> = {
  Crypto: "Where will the price land? Each ladder is one price at a set time.",
  Commodities: "Where will gold, oil, gas, silver or copper close?",
  Weather: "How hot will it get? Each outcome is a temperature range.",
  Politics: "Who will win? Races where exactly one candidate can win.",
  Economics: "Where will the number land?",
};

function WhatYouCanTrade() {
  const kinds = [
    {
      q: "Where will a number land?",
      ex: "SOL on Nov 20, gold, oil",
      how: "Gemini lists one yes/no contract per strike (“SOL ≥ $70”, “≥ $71”…). Contour reads them as one curve, so you can say “around $73, give or take $3”.",
    },
    {
      q: "Which range will it fall in?",
      ex: "Daily high temperature",
      how: "Each contract is one range (“58–59°F”). Exactly one range happens, so your view is a probability for each.",
    },
    {
      q: "Who will win?",
      ex: "2028 Democratic and Republican nominees",
      how: "Each contract is one candidate and exactly one can win. Give each candidate your own odds; Contour buys more of the ones you rate above the market.",
    },
  ];
  return (
    <div className="mt-8 rounded-[36px] border border-mist p-6 md:p-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="card-title">What you can trade</p>
        <p className="text-[14px] text-slate">Any Gemini market where outcomes form a set and exactly one of them happens.</p>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        {kinds.map((k, i) => (
          <div key={k.q} className="flex flex-col gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-signal-violet text-[14px] font-bold text-porcelain">{i + 1}</span>
            <p className="font-bold text-inkstone">{k.q}</p>
            <p className="text-[14px] text-smoke">e.g. {k.ex}</p>
            <p className="text-[14px] text-slate">{k.how}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 border-t border-mist pt-5 text-[14px] text-slate">
        <b className="text-inkstone">Not covered, on purpose:</b> single yes/no questions (one contract is already the whole view), markets where several outcomes can
        come true at once (“which leaders will leave office in 2026?”), point spreads and player props. For those, the payout schedule could not be guaranteed.
      </p>
    </div>
  );
}

const FAQ: [string, string][] = [
  ["Why not just buy one contract?", "One contract pays only if the outcome lands past one strike. A Contour position pays across the whole range you believe in, with a floor you can see before you sign. On the SOL calm-week example it profits anywhere from $67 to $77 and cannot lose more than $37."],
  ["More legs means more spread paid.", "Yes. The solver optimizes at ask prices, so costs are inside the answer, and the screen shows the expected return if the market is right. When costs exceed your edge it holds cash and tells you there is no trade."],
  ["Users are overconfident; won't Kelly sizing ruin them?", "The confidence dial defaults to one quarter, the log objective keeps every payout above zero, and stake is capped per position and per day by the Solana program, not the app."],
  ["Why is this on a blockchain at all?", "For the locked payout schedule, the user-side timeouts, and a forecast record that cannot be backdated. The desk's collateral sits in escrow before any hedge is placed."],
  ["The desk is still a trusted party.", "Only for posting the outcome, which is public and checkable against Gemini's settlement data. It cannot change the payout schedule or withhold funds; if it never posts, anyone can unwind after a grace period."],
  ["What is simulated in this demo?", "Escrow, deposits, collateral and payouts are real devnet transactions with test USDC. The desk's hedge fills are simulated at live Gemini quotes and labelled as such."],
];

export default function Home() {
  const q = useQuery({ queryKey: ["markets"], queryFn: desk.markets, refetchInterval: 60_000 });
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const markets = q.data?.markets ?? [];
  const featured = pickFeatured(markets);
  const ORDER = ["Crypto", "Commodities", "Weather", "Sports", "Economics", "Finance"];
  const cats = [...new Set(markets.map((m) => m.category))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const filtered = markets.filter(
    (m) => (!cat || m.category === cat) && (!search || `${m.title} ${m.ticker}`.toLowerCase().includes(search.toLowerCase())),
  );
  const groups = cats.map((c) => [c, filtered.filter((m) => m.category === c)] as const).filter(([, ms]) => ms.length > 0);

  return (
    <div>
      <section className="page pt-16 text-center md:pt-24">
        <p className="eyebrow">Gemini prediction markets · locked on Solana</p>
        <h1 className="display-lg mx-auto mt-5 max-w-4xl">Trade your whole view.</h1>
        <p className="mx-auto mt-6 max-w-2xl text-[18px] leading-[1.5] text-slate">
          Draw where you think an outcome will land. Contour buys the set of contracts that pays most where you and the market
          disagree, and locks the payout on-chain before a single trade is placed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {featured ? (
            <Link href={`/m/${featured.ticker}`} className="btn btn-primary">
              Open the {featured.title.replace(/ price on /, " ")} ladder
            </Link>
          ) : (
            <span className="btn btn-primary" aria-disabled="true">Loading markets…</span>
          )}
          <a href="#how" className="btn btn-ghost">How it works</a>
        </div>
      </section>

      <section className="page mt-16 md:mt-20">{featured ? <HeroMockup ticker={featured.ticker} /> : <div className="h-[460px] rounded-[16px] bg-cloud" />}</section>

      <section className="page mt-[112px]" id="markets">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="eyebrow">Markets</p>
            <h2 className="section-title mt-2">Pick a ladder</h2>
            <p className="mt-2 text-slate">
              {q.data ? `${markets.length} ladders can be traded as one curve.` : "Reading Gemini's ladders…"}{" "}
              {q.data?.rejected ? `${q.data.rejected} events skipped because their outcomes are not provably exclusive or too thinly quoted.` : ""}
            </p>
          </div>
          <label className="relative w-full md:w-[340px]">
            <Search size={18} strokeWidth={1.75} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-smoke" />
            <input className="input !rounded-full !pl-12" placeholder="Search SOL, gold, Austin…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search markets" />
          </label>
        </div>
        <WhatYouCanTrade />
        <div className="mt-8 flex flex-wrap gap-2">
          <button className={`tag ${cat === null ? "tag-active" : ""}`} onClick={() => setCat(null)}>All</button>
          {cats.map((c) => (
            <button key={c} className={`tag ${cat === c ? "tag-active" : ""}`} onClick={() => setCat(c)}>
              {c}
            </button>
          ))}
        </div>
        {q.isError && <p className="card mt-8 text-slate">The desk is not reachable. Start it with <code>pnpm dev:desk</code>.</p>}
        {!q.data && !q.isError && (
          <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="card h-[230px]" />)}
          </div>
        )}
        {groups.map(([c, ms]) => (
          <div key={c} className="mt-12">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="eyebrow !text-inkstone">{c}</h3>
              {SUBTITLE[c] && <span className="text-[14px] text-slate">{SUBTITLE[c]}</span>}
            </div>
            <div className="mt-4 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {ms.map((m) => <MarketCard key={m.ticker} m={m} />)}
            </div>
          </div>
        ))}
      </section>

      <section className="page mt-[112px]" id="how">
        <p className="eyebrow text-center">How it works</p>
        <h2 className="section-title mt-2 text-center">One screen, two curves</h2>
        <div className="mt-12 grid gap-10 md:grid-cols-3">
          {[
            { icon: LineChart, t: "Reads the market's forecast", b: "A ladder of yes/no contracts becomes one probability curve, cleaned so it can be read at a glance." },
            { icon: SlidersHorizontal, t: "Compiles your forecast", b: "Set where and how sure. The solver sizes a growth-optimal position across every strike, at real ask prices." },
            { icon: Lock, t: "Holds it on Solana", b: "Your stake and the desk's collateral sit in escrow with the payout schedule and a hash of your forecast." },
          ].map(({ icon: Icon, t, b }) => (
            <div key={t} className="flex flex-col gap-4">
              <Icon size={32} strokeWidth={1.75} className="text-signal-violet" />
              <h3 className="card-title">{t}</h3>
              <p className="text-slate">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="page mt-[112px] max-w-[720px]">
        <p className="eyebrow text-center">Questions</p>
        <h2 className="section-title mt-2 text-center">The ones judges ask</h2>
        <Accordion type="single" collapsible className="mt-10 flex flex-col gap-3">
          {FAQ.map(([qq, a], i) => (
            <AccordionItem key={i} value={`q${i}`} title={qq}>
              {a}
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </div>
  );
}
