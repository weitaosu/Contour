"use client";

import { ViewTransition, type ReactNode } from "react";

/**
 * Wraps a page so navigating to or from it animates: opening a market slides forward ("nav-forward"
 * on the link), coming back slides back ("nav-back"), and every other navigation fades and rises in.
 * Updates within a page (live prices, filters) don't animate the page itself (default "none").
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const kinds = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page-fade" };
  return (
    <ViewTransition enter={kinds} exit={kinds} default="none">
      {children}
    </ViewTransition>
  );
}
