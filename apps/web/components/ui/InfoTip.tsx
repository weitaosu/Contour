"use client";

import { useState, type ReactNode } from "react";
import { Tooltip } from "radix-ui";
import { Info } from "lucide-react";

/**
 * A small ⓘ beside a label that explains it. Opens on hover or keyboard focus, like any tooltip, and
 * also toggles on tap, since touch screens never hover.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root open={open} onOpenChange={setOpen}>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            onClick={(e) => {
              e.preventDefault();
              setOpen((o) => !o);
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-smoke hover:text-inkstone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-violet"
          >
            <Info size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            className="on-night z-50 max-w-[280px] rounded-[12px] bg-night px-3 py-2 text-[13px] leading-snug text-porcelain shadow-xl"
          >
            {children}
            <Tooltip.Arrow className="fill-[var(--color-night)]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
