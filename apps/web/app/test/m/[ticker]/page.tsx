import { PageTransition } from "@/components/PageTransition";
import { ForecastScreen } from "@/components/forecast/ForecastScreen";

const num = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

// Test copy of the market page that also draws the regular payout (the whole stake on the single best
// contract) as a line on the payout chart. Same presets as /m/[ticker].
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  const sp = await searchParams;
  return (
    <PageTransition>
      <ForecastScreen ticker={decodeURIComponent(ticker)} preset={{ c: num(sp.c), w: num(sp.w), x: num(sp.x), s: num(sp.s) }} regular />
    </PageTransition>
  );
}
