import { PageTransition } from "@/components/PageTransition";
import { RampScreen } from "@/components/zone/RampScreen";

// Test page for ramp bets (a slope down to $0 instead of a cliff). Optional ?t=TICKER.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <PageTransition>
      <RampScreen initialTicker={typeof sp.t === "string" ? sp.t : undefined} />
    </PageTransition>
  );
}
