import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { s } from "./styles";

const LINKS = [
  { href: "/markets", label: "Markets" },
  { href: "/me", label: "Portfolio" },
];

/** A plain white bar: identity left, the app's pages in the middle, one outlined way in on the right. */
export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[rgba(0,0,0,0.06)] bg-white/90 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-8 px-6 md:px-10">
        <Link href="/" aria-label="Contour home" className="flex items-center gap-2.5">
          <LogoMark size={28} />
          <span className={`${s.display} text-[20px] tracking-[-0.02em]`}>Contour</span>
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="rounded-full px-3 py-2 text-[14px] font-medium text-[#111827] transition-colors hover:bg-[#f8f9fc]">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/markets" className={`${s.pill} ${s.pillLine} ml-auto`}>
          Try the demo
        </Link>
      </nav>
    </header>
  );
}
