"use client";

import { usePathname } from "next/navigation";
import { LandingNav } from "./landing/LandingNav";
import { s } from "./landing/styles";
import { fontVars } from "./landing/fonts";

/** Which top-level page a path belongs to: market pages sit under Markets, positions under Portfolio. */
function activeFor(path: string) {
  if (path.startsWith("/markets") || path.startsWith("/m/")) return "/markets";
  if (path.startsWith("/me") || path.startsWith("/portfolio") || path.startsWith("/p/")) return "/me";
  return undefined;
}

/**
 * The app's top bar: the landing page's white nav on every page, with the current page marked and the
 * wallet on the right. The landing page renders its own (with "Try the demo" instead of the wallet).
 */
export function Nav() {
  const path = usePathname();
  if (path === "/") return null;
  return (
    <LandingNav
      app
      active={activeFor(path)}
      // The landing root, its fonts, and the app layer (so the wallet button is the same dark pill everywhere).
      className={`${s.root} ${s.app} ${fontVars}`}
      // Named, so page transitions leave it in place: the content moves, the bar stays.
      style={{ viewTransitionName: "site-header" }}
    />
  );
}
