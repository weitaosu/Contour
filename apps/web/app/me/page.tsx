"use client";

import { PageTransition } from "@/components/PageTransition";
import { PortfolioScreen } from "@/components/portfolio/PortfolioScreen";

/** The Portfolio tab: every position the connected wallet has paid for, open ones valued live. */
export default function PortfolioPage() {
  return (
    <PageTransition>
      <PortfolioScreen />
    </PageTransition>
  );
}
