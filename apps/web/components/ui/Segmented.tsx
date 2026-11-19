"use client";

import { useSlidingPill } from "./SlidingPill";

/**
 * A choice among a few options as one control, matching the page switch in the nav: a grey track,
 * the current option a white pill. Every option has the same box, so nothing shifts on selection.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const { track, pill } = useSlidingPill(value);
  return (
    <div role="radiogroup" aria-label={label} ref={track} className="relative inline-flex flex-wrap items-center gap-0.5 rounded-[18px] bg-cloud p-1">
      {pill}
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            data-active={on}
            onClick={() => onChange(o.value)}
            className={`ease relative rounded-full px-3 py-1.5 text-[13px] font-bold leading-none ${on ? "text-inkstone" : "text-slate hover:text-inkstone"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
