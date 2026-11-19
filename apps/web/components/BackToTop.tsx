"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * A "back to top" pill for long pages: it fades in once you're about a screen and a half down and
 * takes you back up smoothly (instantly for reduced-motion users).
 */
export function BackToTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 1.5);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const toTop = () => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };
  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Back to top"
      tabIndex={shown ? 0 : -1}
      aria-hidden={shown ? undefined : true}
      style={{ transition: "opacity 220ms ease, translate var(--spring-ms) var(--spring)" }}
      className={`group fixed bottom-5 right-5 z-30 inline-flex items-center gap-1.5 rounded-full bg-porcelain py-2.5 pl-3 pr-4 text-[14px] font-bold text-inkstone shadow-[0_0_0_1.5px_rgba(89,79,244,0.28),0_12px_32px_-14px_rgba(89,79,244,0.55)] hover:-translate-y-0.5 md:bottom-6 md:right-6 ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-signal-violet text-white group-hover:-translate-y-0.5" style={{ transition: "translate var(--spring-ms) var(--spring)" }}>
        <ArrowUp size={14} strokeWidth={2.5} aria-hidden="true" />
      </span>
      Top
    </button>
  );
}
