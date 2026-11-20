import Image from "next/image";
import Link from "next/link";
import { ArrowLeftRight, ArrowRight, ShieldCheck, Target } from "lucide-react";
import { PageTransition } from "@/components/PageTransition";
import { StepSelector } from "@/components/landing/StepSelector";
import { ConfidenceVisual, OutcomesVisual, TradeoffVisual, ViewVisual } from "@/components/landing/FeatureVisuals";
import { s } from "@/components/landing/styles";
import { fontVars } from "@/components/landing/fonts";
import marketShot from "@/public/landing/market-view.png";

/** Every position starts from a market, so the calls to action open the market browser. */
const MARKETS_HREF = "/markets";

/** The kinds of view a yes/no contract can't hold on its own. */
const VIEWS = [
  { Icon: Target, title: "A range", body: "it lands between two values" },
  { Icon: ArrowLeftRight, title: "A big move", body: "far from today, either way" },
  { Icon: ShieldCheck, title: "A loss cap", body: "known before you trade" },
];

const POINTS = [
  {
    title: "Trade the middle ground",
    body: "Bet that an outcome lands in a range, or that it moves a lot either way. Contour picks the contracts and sizes them for you.",
    Visual: ViewVisual,
  },
  {
    title: "Know your worst case",
    body: "See the most you can make and the most you can lose before you trade, and choose how much you're willing to risk.",
    Visual: TradeoffVisual,
  },
  {
    title: "See every outcome",
    body: "Your payout at every result updates as you drag your curve, next to what a single all-or-nothing contract would pay.",
    Visual: OutcomesVisual,
  },
  {
    title: "Lean in as far as you like",
    body: "Follow your view fully, or lean on the market's odds and put less at risk. The choice is yours on every trade.",
    Visual: ConfidenceVisual,
  },
];

export default function Landing() {
  return (
    <PageTransition>
      {/* The market browser's look (lp-app) and its full-width grid, so this page reads as part of the app. */}
      <div className={`${s.root} ${s.app} ${fontVars} overflow-x-clip`}>
        <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-2 px-4 pb-8 pt-3 md:px-6">
          {/* 1 · The promise beside the product. Sized to the screen so the next section peeks in below. */}
          <div className="grid gap-2 lg:h-[clamp(540px,calc(100dvh-380px),700px)] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.45fr)]">
            <section className="flex min-w-0 flex-col rounded-[24px] bg-cloud p-6 xl:p-10">
              <p className="flex items-center gap-2 text-[13px] text-smoke">
                <span className="live-dot" aria-hidden="true" />
                Live on Gemini Prediction Markets
              </p>
              <h1 className="mt-4 text-[44px] leading-[1.04] text-inkstone xl:text-[64px]">
                Go beyond
                <br />
                <span className="text-slate">yes or no.</span>
              </h1>
              <p className="mt-5 max-w-[500px] text-[16px] leading-relaxed text-slate xl:text-[17px]">
                Every prediction market bet is all-or-nothing: slightly wrong, and you lose everything you put in. Contour spreads your position across contracts, so you can trade what you
                actually believe and know the most you can lose before you do.
              </p>
              <div className="mt-7 flex flex-wrap gap-2">
                <Link href={MARKETS_HREF} className="btn btn-primary !gap-1.5">
                  Explore markets <ArrowRight size={16} strokeWidth={2.25} aria-hidden="true" />
                </Link>
                <a href="#how" className="btn btn-quiet">
                  How it works
                </a>
              </div>
              <ul className="mt-auto grid grid-cols-1 gap-2 pt-8 sm:grid-cols-3" aria-label="Views you can trade">
                {VIEWS.map(({ Icon, title, body }) => (
                  <li key={title} className="rounded-[18px] bg-porcelain p-3.5">
                    <Icon size={18} strokeWidth={2} className="text-signal-violet" aria-hidden="true" />
                    <p className="mt-2 text-[14px] font-bold leading-tight text-inkstone">{title}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-slate">{body}</p>
                  </li>
                ))}
              </ul>
            </section>

            {/* the real market screen on the violet stage, running off its right and bottom edges */}
            <div className={`${s.stage} ${s.grain} relative h-[380px] overflow-hidden rounded-[24px] sm:h-[520px] lg:h-auto`}>
              <span className={`${s.haze} left-[30%] top-[14%] h-[260px] w-[420px]`} aria-hidden="true" />
              <span className={`${s.haze} bottom-[-60px] right-[-40px] h-[220px] w-[380px] opacity-70`} aria-hidden="true" />
              <div className={`${s.rim} absolute left-[6%] top-[9%] w-[150%] rounded-[16px] p-[6px] sm:w-[125%] lg:w-[112%]`}>
                <div className="overflow-hidden rounded-[11px] bg-white">
                  <div className="flex h-8 items-center gap-1.5 border-b border-[rgba(0,0,0,0.06)] px-3" aria-hidden="true">
                    <span className="h-2 w-2 rounded-full bg-[#c9c3ff]" />
                    <span className="h-2 w-2 rounded-full bg-[#c9c3ff]" />
                    <span className="h-2 w-2 rounded-full bg-[#c9c3ff]" />
                    <span className="mx-auto rounded-full bg-[#f3f2ff] px-16 py-0.5 text-[10.5px] text-[#70707d]">Contour · SOL price on November 30</span>
                  </div>
                  <Image
                    src={marketShot}
                    alt="A Contour market: the market's grey curve, your violet curve dragged over the range you expect, and what you'd make at every price."
                    sizes="(min-width: 1024px) 70vw, 150vw"
                    fetchPriority="high"
                    loading="eager"
                    className="block h-auto w-full"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 2 · What it lets you do */}
          <section aria-labelledby="points-title" className="mt-14 xl:mt-20">
            <div className="px-1 pb-5">
              <h2 id="points-title" className="text-[36px] leading-[1.1] text-inkstone xl:text-[46px]">
                Most beliefs aren&apos;t <span className="text-slate">yes or no.</span>
              </h2>
              <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-slate">
                Plenty of people hold a view without the conviction for an all-or-nothing bet. Contour gives that view a position, with the risk spelled out before you take it.
              </p>
            </div>
            <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {POINTS.map(({ title, body, Visual }) => (
                <li key={title} className="flex flex-col rounded-[24px] bg-cloud p-5 xl:p-6">
                  <div className="flex min-h-[200px] items-center justify-center" aria-hidden="true">
                    <Visual />
                  </div>
                  <h3 className="mt-6 text-[20px] leading-7 text-inkstone xl:text-[22px]">{title}</h3>
                  <p className="mt-1.5 text-[15px] leading-[1.55] text-slate">{body}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* 3 · How it works, on its own lavender panel */}
          <section id="how" aria-label="How it works" className={`${s.bandLavender} mt-14 scroll-mt-24 overflow-hidden rounded-[24px] px-6 py-14 md:px-10 xl:mt-20 xl:px-16 xl:py-20`}>
            <span className={`${s.seam} ${s.seamTop}`} aria-hidden="true" />
            <span className={`${s.seam} ${s.seamBottom}`} aria-hidden="true" />
            <div className="relative mx-auto max-w-[1360px]">
              <StepSelector />
            </div>
          </section>

          {/* 4 · Why it matters, and the way in */}
          <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <section aria-labelledby="why-title" className="rounded-[24px] bg-cloud p-6 xl:p-10">
              <h2 id="why-title" className="text-[32px] leading-[1.12] text-inkstone xl:text-[40px]">
                Markets need liquidity. <span className="text-slate">Caution brings it.</span>
              </h2>
              <p className="mt-4 max-w-[620px] text-[15px] leading-relaxed text-slate xl:text-[16px]">
                Prediction markets have grown fast, and what they need next is liquidity. Contour draws in cautious traders and lets existing bettors put in more without betting it all on one
                outcome. Every position spreads across several contracts, adding depth to each pool it touches.
              </p>
            </section>
            {/* a deeper violet than the hero stage, so white text keeps its contrast across the whole panel */}
            <section
              aria-labelledby="cta-title"
              className={`${s.grain} relative flex flex-col justify-between gap-8 overflow-hidden rounded-[24px] bg-[radial-gradient(70%_90%_at_100%_0%,#9a88fa_0%,rgba(154,136,250,0)_70%),linear-gradient(135deg,#3f26d9_0%,#5a3cf0_55%,#6c55f2_100%)] p-6 xl:p-10`}
            >
              <h2 id="cta-title" className="relative text-[32px] leading-[1.12] !text-white xl:text-[40px]">
                Win more often,
                <br />
                with smaller payouts.
              </h2>
              <div className="relative flex flex-wrap items-center justify-between gap-4">
                <p className="max-w-[340px] text-[15px] leading-relaxed text-white/90">That brings the cautious majority in, and their money brings the liquidity.</p>
                <Link href={MARKETS_HREF} className="btn btn-quiet !gap-1.5 !border-white">
                  Explore markets <ArrowRight size={16} strokeWidth={2.25} aria-hidden="true" />
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
