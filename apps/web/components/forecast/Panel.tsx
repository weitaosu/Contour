"use client";

import type { ReactNode } from "react";
import { useSize } from "@/components/charts/useSize";

/** The numbered steps that walk a newcomer through the workspace: outlook, shape, result, order. */
export function StepBadge({ n }: { n: number }) {
  return (
    <span className="tnum flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-signal-violet text-[12px] font-bold text-white" aria-hidden="true">
      {n}
    </span>
  );
}

/**
 * One panel of the forecast workspace. On wide screens the panels tile a single screen (a trading
 * panel: everything in view at once) and each scrolls on its own if it must; on phones they stack.
 */
export function Panel({
  id,
  step,
  title,
  hint,
  right,
  className = "",
  bodyClassName = "",
  tone = "plain",
  children,
}: {
  id?: string;
  step?: number;
  title: ReactNode;
  /** One plain line under the title: what this panel is for, or what to do here. */
  hint?: ReactNode;
  /** Small things at the header's right: a legend, a source note. */
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** "focus": the panels you work in (your view, what it makes), lifted off the page so the eye goes there first. */
  tone?: "plain" | "focus";
  children: ReactNode;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={`flex min-h-0 min-w-0 scroll-mt-24 flex-col rounded-[24px] p-4 ${
        tone === "focus" ? "bg-porcelain shadow-[0_0_0_1.5px_rgba(89,79,244,0.28),0_12px_32px_-14px_rgba(89,79,244,0.45)]" : "bg-cloud"
      } ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 id={headingId} className="flex items-center gap-2 text-[16px] font-bold leading-tight text-inkstone">
            {step !== undefined && <StepBadge n={step} />}
            {title}
          </h2>
          {hint && <p className="mt-1 text-[13px] leading-snug text-slate">{hint}</p>}
        </div>
        {right && <div className="flex shrink-0 items-center gap-4 pt-0.5 text-[13px] text-slate">{right}</div>}
      </header>
      <div className={`mt-3 flex min-h-0 flex-1 flex-col ${bodyClassName}`}>{children}</div>
    </section>
  );
}

/**
 * Hands a chart the height its panel leaves free, so charts grow and shrink with the screen.
 * The chart sits absolutely inside, so it never props its own box open: the box's size comes only
 * from the layout (its min-height and the space beside it), and can shrink back as well as grow.
 * `className` sets the size on screens where panels stack.
 */
export function Fill({ fallback, className = "", children }: { fallback: number; className?: string; children: (height: number) => ReactNode }) {
  const { ref, height } = useSize<HTMLDivElement>();
  return (
    <div ref={ref} className={`relative min-h-0 ${className}`}>
      <div className="absolute inset-0 overflow-hidden">{children(Math.max(120, Math.floor(height) || fallback))}</div>
    </div>
  );
}

/** The white, violet-ringed style of the panels you work in, for any page that highlights one. */
export const FOCUS_PANEL = "bg-porcelain shadow-[0_0_0_1.5px_rgba(89,79,244,0.28),0_12px_32px_-14px_rgba(89,79,244,0.45)]";
