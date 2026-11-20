"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, LayoutGrid } from "lucide-react";
import { useSlidingPill } from "./ui/SlidingPill";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";
import { desk } from "@/lib/desk";

const links = [
  { href: "/markets", label: "Markets", icon: LayoutGrid, hint: "Every market you can trade as one curve" },
  { href: "/me", label: "Portfolio", icon: Briefcase, hint: "Your wallet's positions, valued live" },
];

// Position pages (/p/<pubkey>, and paper ones at /portfolio/<id>) live under the Portfolio tab.
const isActive = (href: string, path: string) =>
  href === "/markets" ? path.startsWith("/markets") || path.startsWith("/m/") : href === "/me" ? path.startsWith("/me") || path.startsWith("/portfolio") || path.startsWith("/p/") : path.startsWith(href);

/**
 * The pages as one segmented control, like the pickers inside the app: a grey track, the
 * current page a white pill. Every item has the same box, so nothing shifts when it's selected.
 */
function PageSwitch({ path, full = false }: { path: string; full?: boolean }) {
  const current = links.find((l) => isActive(l.href, path))?.href ?? null;
  const { track, pill } = useSlidingPill(current);
  return (
    <nav aria-label="Pages" ref={track} className={`relative ${full ? "grid grid-cols-2" : "flex"} items-center gap-0.5 rounded-full bg-cloud p-1`}>
      {pill}
      {links.map(({ href, label, icon: Icon, hint }) => {
        const on = isActive(href, path);
        return (
          <Link
            key={href}
            href={href}
            title={hint}
            aria-current={on ? "page" : undefined}
            data-active={on}
            className={`ease relative inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[14px] font-bold leading-none ${
              on ? "text-inkstone" : "text-slate hover:text-inkstone"
            }`}
          >
            <Icon size={15} strokeWidth={2.1} className={on ? "text-signal-violet" : ""} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Nav() {
  const path = usePathname();
  const cfg = useQuery({ queryKey: ["config"], queryFn: desk.config, staleTime: 60_000 });
  const mode = cfg.data?.executionMode ?? "paper";
  // The front page and market pages are full-width workspaces; the bar lines up with them there.
  // The landing page at / renders its own nav.
  if (path === "/") return null;
  const wide = path.startsWith("/markets") || path.startsWith("/m/") || path.startsWith("/me") || path.startsWith("/portfolio") || path.startsWith("/p/");
  return (
    // Named, so page transitions leave it in place: the content moves, the bar stays.
    <header className="sticky top-0 z-30 border-b border-mist bg-canvas/90 backdrop-blur-md" style={{ viewTransitionName: "site-header" }}>
      {/* Market pages are a full-width workspace; the bar lines up with it there. */}
      <div className={`flex h-[72px] items-center gap-6 ${wide ? "mx-auto max-w-[1680px] px-4 md:px-6" : "page"}`}>
        <Link href="/" aria-label="Contour home">
          <Logo />
        </Link>
        <div className="hidden md:block">
          <PageSwitch path={path} />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="tag hidden sm:inline-flex" title="Fills are simulated at live Gemini quotes">
            {mode === "paper" ? "Paper mode" : mode === "sandbox" ? "Sandbox" : "Live"}
          </span>
          <WalletButton />
        </div>
      </div>
      <div className={`pb-2 md:hidden ${wide ? "px-4" : "page"}`}>
        <PageSwitch path={path} full />
      </div>
    </header>
  );
}
