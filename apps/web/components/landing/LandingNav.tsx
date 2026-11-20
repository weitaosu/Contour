import type { CSSProperties } from "react";
import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { WalletButton } from "@/components/WalletButton";
import { s } from "./styles";

const LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/me", label: "Portfolio" },
];

/**
 * A plain white bar: identity left, the app's pages in the middle, one way in on the right. On the
 * landing page that's "Try the demo"; inside the app (`app`) it's the wallet, the current page is
 * marked, and the page links stay visible on phones.
 */
export function LandingNav({
  app = false,
  active,
  className = "",
  style,
}: {
  app?: boolean;
  active?: string;
  /** Extra classes on the bar itself (the app adds the landing root and fonts here, so they ride along with sticky). */
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <header className={`sticky top-0 z-40 border-b border-[rgba(0,0,0,0.06)] bg-white/90 backdrop-blur-md ${className}`} style={style}>
      <nav aria-label="Main" className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-3 px-4 sm:gap-8 sm:px-6 md:px-10">
        <Link href="/" aria-label="Contour home" className="flex shrink-0 items-center gap-2.5">
          <LogoMark size={28} />
          <span className={`${s.display} text-[20px] tracking-[-0.02em] ${app ? "hidden sm:inline" : ""}`}>Contour</span>
        </Link>
        <ul className={`${app ? "flex" : "hidden md:flex"} items-center gap-1`}>
          {LINKS.map((l) => {
            const on = active === l.href;
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={on ? "page" : undefined}
                  className={`rounded-full px-3 py-2 text-[14px] font-medium transition-colors ${on ? "bg-[#f8f9fc] text-[#010110]" : "text-[#111827] hover:bg-[#f8f9fc]"}`}
                >
                  {l.label}
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="ml-auto shrink-0">
          {app ? (
            <WalletButton />
          ) : (
            <Link href="/markets" className={`${s.pill} ${s.pillLine}`}>
              Try the demo
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
