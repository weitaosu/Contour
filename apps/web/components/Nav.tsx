"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";
import { desk } from "@/lib/desk";

const links = [
  { href: "/", label: "Markets" },
  { href: "/me", label: "Record" },
  { href: "/replay", label: "Replay" },
];

export function Nav() {
  const path = usePathname();
  const cfg = useQuery({ queryKey: ["config"], queryFn: desk.config, staleTime: 60_000 });
  const mode = cfg.data?.executionMode ?? "paper";
  return (
    <header className="sticky top-0 z-30 border-b border-mist bg-porcelain">
      <div className="page flex h-[72px] items-center gap-6">
        <Link href="/" aria-label="Contour home">
          <Logo />
        </Link>
        <nav className="hidden flex-1 items-center justify-center gap-1 md:flex">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" || path.startsWith("/m/") : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-4 py-2 ${active ? "text-inkstone" : "text-slate hover:text-inkstone"}`}
                aria-current={active ? "page" : undefined}
              >
                {l.label}
                {active && <span className="mx-auto mt-1 block h-[2px] w-5 rounded-full bg-signal-violet" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 md:ml-0">
          <span className="tag hidden sm:inline-flex" title="Fills are simulated at live Gemini quotes">
            {mode === "paper" ? "Paper mode" : mode === "sandbox" ? "Sandbox" : "Live"}
          </span>
          <WalletButton />
        </div>
      </div>
      <nav className="page flex gap-1 pb-2 md:hidden">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={`tag ${path === l.href ? "tag-active" : "tag-white"}`}>
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
