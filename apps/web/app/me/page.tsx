"use client";

import { PageTransition } from "@/components/PageTransition";
import { DemoPortfolioScreen } from "@/components/portfolio/DemoPortfolioScreen";

/**
 * The Portfolio tab, "Your wallet": every position, valued live and tradable (buy more, sell). Ones paid
 * for on Solana carry their transaction; the demo history and positions tagged Demo are sample data.
 */
export default function PortfolioPage() {
  return (
    <PageTransition>
      <DemoPortfolioScreen />
    </PageTransition>
  );
}
