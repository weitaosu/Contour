import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { env } from "@/lib/env";
import { s } from "./styles";

const GROUPS: { title: string; links: { label: string; href?: string; external?: boolean }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Markets", href: "/markets" },
      { label: "Portfolio", href: "/me" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Source on GitHub", href: env.githubUrl, external: true },
      { label: "Data from the Gemini Prediction Markets API" },
    ],
  },
];

/** A white directory: link groups on the left, identity and the demo's ground rules on the right. */
export function LandingFooter() {
  return (
    <footer className="border-t border-[rgba(0,0,0,0.06)] bg-white">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-6 py-16 md:grid-cols-[1fr_1fr_1.4fr] md:gap-[42px] md:px-10 md:py-20">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="text-[14px] font-medium">{g.title}</p>
            <ul className="mt-3 flex flex-col gap-2 text-[14px] leading-5">
              {g.links.map((l) => (
                <li key={l.label}>
                  {!l.href ? (
                    <span className="text-[#70707d]">{l.label}</span>
                  ) : l.external ? (
                    <a className={s.link} href={l.href} target="_blank" rel="noreferrer">
                      {l.label}
                    </a>
                  ) : (
                    <Link className={s.link} href={l.href}>
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="md:justify-self-end md:text-right">
          <div className="flex items-center gap-2.5 md:justify-end">
            <LogoMark size={28} />
            <span className={`${s.display} text-[22px] tracking-[-0.02em]`}>Contour</span>
          </div>
          <p className="mt-4 text-[13px] text-[#70707d]">Built for UBC 2026. Not investment advice; not insurance.</p>
        </div>
      </div>
    </footer>
  );
}
