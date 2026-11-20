import { PageTransition } from "@/components/PageTransition";
import { ForecastScreen } from "@/components/forecast/ForecastScreen";
import { s as lp } from "@/components/landing/styles";
import { fontVars } from "@/components/landing/fonts";

const num = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  const sp = await searchParams;
  // Optional presets for demo links: c = confidence, w = width scale, x = center shift in market sds, s = stake.
  // In the landing page's style, like the market browser: its palette, type and controls over the
  // app's own pieces (see .lp-app in landing.css).
  return (
    <div className={`${lp.root} ${lp.app} ${fontVars}`}>
      <PageTransition>
        <ForecastScreen ticker={decodeURIComponent(ticker)} preset={{ c: num(sp.c), w: num(sp.w), x: num(sp.x), s: num(sp.s) }} />
      </PageTransition>
    </div>
  );
}
