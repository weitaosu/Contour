"use client";

import { usePathname } from "next/navigation";
import { LandingFooter } from "./landing/LandingFooter";
import { s } from "./landing/styles";
import { fontVars } from "./landing/fonts";

/** The app's footer: the landing page's light directory on every page. The landing page renders its own. */
export function Footer() {
  const path = usePathname();
  if (path === "/") return null;
  return (
    <div className={`${s.root} ${fontVars}`}>
      <LandingFooter />
    </div>
  );
}
