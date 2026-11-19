import { PageTransition } from "@/components/PageTransition";
import { ZoneScreen } from "@/components/zone/ZoneScreen";

// Test page for win-zone bets. Optional ?t=TICKER opens a specific market.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return (
    <PageTransition>
      <ZoneScreen initialTicker={typeof sp.t === "string" ? sp.t : undefined} />
    </PageTransition>
  );
}
