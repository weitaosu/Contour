import { ForecastScreen } from "@/components/forecast/ForecastScreen";

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
  return <ForecastScreen ticker={decodeURIComponent(ticker)} preset={{ c: num(sp.c), w: num(sp.w), x: num(sp.x), s: num(sp.s) }} />;
}
