import Image from "next/image";
import Link from "next/link";
import { DM_Sans, Inter } from "next/font/google";
import { PageTransition } from "@/components/PageTransition";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingNav } from "@/components/landing/LandingNav";
import { StepSelector } from "@/components/landing/StepSelector";
import { Crosshair, Eye, Scale, ShieldCheck } from "lucide-react";
import { s } from "@/components/landing/styles";
import marketsShot from "@/public/landing/markets-desktop.png";

// A regular-weight grotesk for display, Inter for everything you read or press.
const display = DM_Sans({ subsets: ["latin"], weight: ["400"], variable: "--font-landing-display", display: "swap" });
const body = Inter({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-landing-body", display: "swap" });

/** Every strategy starts from a market, so the calls to action open the market browser. */
const DEMO_HREF = "/markets";

const POINTS = [
  {
    title: "Increase upside, limit downside",
    body: "Choose the balance between potential returns and protection. See what you could gain, what you could lose, and what the tradeoff costs.",
    icon: Scale,
  },
  {
    title: "Express views more precisely",
    body: "Expect a modest rise, a narrow range, or a big move? Build a position around your forecast, with contracts selected and sized together.",
    icon: Crosshair,
  },
  {
    title: "See every outcome",
    body: "Before you commit, see what you'd make or lose at every price the market could settle at, and how likely each result is.",
    icon: Eye,
  },
  {
    title: "Hedge, don’t guess",
    body: "Add protection to an existing holding. Compare the position alone with the strategy added, and see how the results change across outcomes.",
    icon: ShieldCheck,
  },
];

export default function Landing() {
  return (
    <PageTransition>
      <div className={`${s.root} ${display.variable} ${body.variable} overflow-x-clip`}>
        <LandingNav />

        {/* 1 · The promise beside the real product, lit on a violet stage */}
        {/* Desktop proportions follow the viewport (a ~2.5:1 stage), so the split reads the same at any width. */}
        <section className="grid bg-[#f8f9fc] lg:h-[clamp(560px,40vw,800px)] lg:grid-cols-2">
          <div className="flex items-center px-6 pb-14 pt-16 md:px-10 lg:py-0 lg:pl-[5.4vw] lg:pr-[3vw]">
            <div className="max-w-[560px] lg:max-w-[38vw]">
              <h1 className={`${s.display} text-[44px] leading-[1.1] lg:whitespace-nowrap lg:text-[clamp(44px,3.1vw,64px)]`}>
                Go Beyond <span className="text-[#70707d]">Yes/No.</span>
              </h1>
              <p className="mt-5 text-[17px] leading-[1.5] text-black lg:mt-[clamp(16px,1.3vw,26px)] lg:max-w-[36vw] lg:text-[clamp(16px,1.1vw,21px)]">
                Prediction markets live on a line from zero to one. Contour combines those contracts into a wider range of payoffs—giving you more ways to express what you
                believe.
              </p>
              <Link href={DEMO_HREF} className={`${s.pill} ${s.pillDark} mt-7 lg:mt-[clamp(26px,2vw,40px)]`}>
                Try the demo
              </Link>
            </div>
          </div>

          <div className={`${s.stage} ${s.grain} relative h-[400px] sm:h-[520px] lg:h-auto`}>
            <span className={`${s.haze} left-[30%] top-[18%] h-[260px] w-[420px]`} aria-hidden="true" />
            <span className={`${s.haze} bottom-[-60px] right-[-40px] h-[220px] w-[380px] opacity-70`} aria-hidden="true" />
            {/* the market browser: cut off by the right edge only, with the stage showing beneath it */}
            <div className={`${s.rim} absolute bottom-[18%] left-[10%] top-[11%] flex w-[150%] flex-col rounded-[16px] p-[6px] sm:w-[125%] lg:left-[12%] lg:w-[118%]`}>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[11px] bg-white">
                <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-[rgba(0,0,0,0.06)] px-3" aria-hidden="true">
                  <span className="h-2 w-2 rounded-full bg-[#c9c3ff]" />
                  <span className="h-2 w-2 rounded-full bg-[#c9c3ff]" />
                  <span className="h-2 w-2 rounded-full bg-[#c9c3ff]" />
                  <span className="mx-auto rounded-full bg-[#f3f2ff] px-16 py-0.5 text-[10.5px] text-[#70707d]">Contour · Markets</span>
                </div>
                <div className="relative min-h-0 flex-1">
                  <Image
                    src={marketsShot}
                    alt="Contour's market browser: a live SOL price preview beside the Gemini markets you can trade as one curve."
                    fill
                    sizes="(min-width: 1024px) 60vw, 150vw"
                    fetchPriority="high"
                    loading="eager"
                    className="object-cover object-left-top"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 2 · The four things it lets you do: one symbol each, the words doing the work */}
        <section aria-labelledby="points-title" className="mx-auto max-w-[1200px] px-6 py-20 md:px-10 lg:py-[110px]">
          <h2 id="points-title" className={`${s.display} max-w-[960px] text-[clamp(32px,4vw,42px)] leading-[1.15]`}>
            Express conviction <span className="text-[#70707d]">with precision.</span>
          </h2>
          <p className="mt-5 max-w-[56ch] text-[17px] leading-[1.55] text-[#2e2e3d] md:text-[18px]">
            Turn binary prediction markets into targeted strategies for your outlook, or add downside protection to an existing position.
          </p>
          <ul className="mt-10 grid auto-rows-fr gap-4 md:grid-cols-2 md:gap-6">
            {POINTS.map(({ title, body: text, icon: Icon }) => (
              <li key={title} className="flex flex-col gap-3 rounded-[12px] bg-[#f8f9fc] p-7 md:p-9">
                <Icon size={24} strokeWidth={1.6} className="text-[#010110]" aria-hidden="true" />
                <h3 className="mt-5 text-[20px] font-medium leading-7 tracking-[-0.02em] md:text-[22px]">{title}</h3>
                <p className="max-w-[46ch] text-[15px] font-light leading-[1.6] text-[#2e2e3d] md:text-[16px]">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* 3 · How it works: its own full-width lavender band, so it reads as a new chapter after the cards */}
        <section aria-label="How it works" className={`${s.bandLavender} py-20 lg:py-[110px]`}>
          <span className={`${s.seam} ${s.seamTop}`} aria-hidden="true" />
          <span className={`${s.seam} ${s.seamBottom}`} aria-hidden="true" />
          <div className="relative mx-auto max-w-[1200px] px-6 md:px-10">
            <StepSelector />
          </div>
        </section>

        {/* 4 · The way in */}
        <section aria-labelledby="cta-title" className={`${s.band} px-6 py-[110px] text-center md:py-[130px]`}>
          <span className={`${s.seam} ${s.seamBottom}`} aria-hidden="true" />
          <h2 id="cta-title" className={`${s.display} relative text-[clamp(40px,5.2vw,58px)] leading-[1.1]`}>
            Put your view
            <br />
            <span className="text-[#70707d]">into a position.</span>
          </h2>
          <Link href={DEMO_HREF} className={`${s.pill} ${s.pillDark} relative mt-8`}>
            Build your strategy
          </Link>
        </section>

        <LandingFooter />
      </div>
    </PageTransition>
  );
}
