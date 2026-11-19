"use client";

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * The market page's controls, in a reusable form for the zone test page: outlook-style choice cards,
 * the rounded segmented selector used for confidence, and the "$ … USDC" amount box.
 */

/** Outlook-style cards (see OutlookPicker): title, icon, and one line under it. */
export function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; title: string; sub: string; icon: LucideIcon }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`ease flex min-w-0 flex-col rounded-[14px] border bg-porcelain px-3 py-1.5 text-left hover:-translate-y-0.5 ${
              on ? "border-signal-violet shadow-[0_0_0_3px_rgba(89,79,244,0.14)]" : "border-mist hover:border-ash"
            }`}
          >
            <span className="flex items-center justify-between gap-1.5">
              <span className={`truncate text-[15px] font-bold leading-tight ${on ? "text-signal-violet" : "text-inkstone"}`}>{o.title}</span>
              <Icon size={18} strokeWidth={2} className={`shrink-0 ${on ? "text-signal-violet" : "text-slate"}`} aria-hidden="true" />
            </span>
            <span className="tnum mt-0.5 block truncate text-[12.5px] text-slate">{o.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The confidence selector's look: a grey pill track, the chosen option a violet pill. */
export function PillChoice<T extends string | number>({
  options,
  value,
  onChange,
  label,
  small = false,
}: {
  options: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-full bg-mist p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`tnum truncate rounded-full font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-violet disabled:opacity-40 ${
              small ? "px-1 py-1 text-[12px]" : "py-1.5 text-[14px]"
            } ${on ? "bg-signal-violet text-white shadow-sm" : "text-slate hover:bg-porcelain hover:text-inkstone"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const AMOUNTS = [25, 50, 100, 250];

/** The market page's amount picker: quick amounts, then a big "$ … USDC" box. */
export function AmountField({ label, value, onChange, note, max = 500 }: { label: string; value: number; onChange: (n: number) => void; note?: string; max?: number }) {
  const [text, setText] = useState(String(value));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.activeElement !== input.current) setText(String(value));
  }, [value]);
  return (
    <div className="flex flex-col gap-2.5">
      <label className="font-bold text-inkstone" htmlFor="zone-amount">
        {label}
      </label>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Quick amounts">
        {AMOUNTS.map((a) => {
          const on = value === a;
          return (
            <button
              key={a}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(a)}
              className={`ease tnum rounded-full border py-1.5 text-[14px] font-bold ${
                on ? "border-signal-violet bg-signal-violet text-white" : "border-mist bg-porcelain text-inkstone hover:border-ash"
              }`}
            >
              ${a}
            </button>
          );
        })}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[18px] font-bold text-slate">$</span>
        <input
          id="zone-amount"
          ref={input}
          className="input tnum !py-2.5 !pl-9 !pr-16 text-[18px] font-bold"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const t = e.target.value.replace(/[^0-9.]/g, "");
            setText(t);
            const n = Number(t);
            if (n > 0) onChange(Math.min(max, Math.round(n * 100) / 100));
          }}
          onBlur={() => setText(String(value))}
        />
        <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate">USDC</span>
      </div>
      {note && <p className="text-[13px] text-smoke">{note}</p>}
    </div>
  );
}
