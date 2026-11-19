"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

/**
 * Runs in <head> before the page paints, so it never flashes the wrong theme: a saved choice wins,
 * otherwise the system setting (followed live until the user picks one).
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{var m=window.matchMedia("(prefers-color-scheme: dark)");var apply=function(){var s=localStorage.getItem("theme");d.dataset.theme=(s?s==="dark":m.matches)?"dark":"light";};apply();m.addEventListener("change",function(){if(!localStorage.getItem("theme"))apply();});}catch(e){d.dataset.theme="light";}})();`;

/** Light / dark switch for the header. Colors ease across instead of flashing. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    const d = document.documentElement;
    const read = () => setTheme(d.dataset.theme === "dark" ? "dark" : "light");
    read();
    // The system setting can change it too (until the user picks one).
    const mo = new MutationObserver(read);
    mo.observe(d, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const toggle = () => {
    const d = document.documentElement;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) d.classList.add("theme-switching");
    d.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    if (!reduce) window.setTimeout(() => d.classList.remove("theme-switching"), 360);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme ? `Switch to ${next} mode` : "Switch theme"}
      title={theme ? `Switch to ${next} mode` : undefined}
      className="ease relative inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cloud text-slate hover:text-inkstone"
    >
      {/* Both icons stay mounted and trade places with a spring, so the swap reads as one motion. */}
      <Sun
        size={18}
        strokeWidth={2}
        aria-hidden="true"
        className="absolute"
        style={{
          transition: "rotate var(--spring-ms) var(--spring), scale var(--spring-ms) var(--spring), opacity 220ms ease",
          rotate: theme === "dark" ? "0deg" : "-90deg",
          scale: theme === "dark" ? "1" : "0.4",
          opacity: theme === "dark" ? 1 : 0,
        }}
      />
      <Moon
        size={17}
        strokeWidth={2}
        aria-hidden="true"
        className="absolute"
        style={{
          transition: "rotate var(--spring-ms) var(--spring), scale var(--spring-ms) var(--spring), opacity 220ms ease",
          rotate: theme === "dark" ? "90deg" : "0deg",
          scale: theme === "dark" ? "0.4" : "1",
          opacity: theme === "light" ? 1 : 0,
        }}
      />
    </button>
  );
}
