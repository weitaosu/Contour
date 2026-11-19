"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { usd } from "@/lib/format";
import { COLORS } from "./common";
import { GAIN } from "./ProfitChart";

const EASE = "cubic-bezier(.65,0,.35,1)";
const signed = (v: number) => `${v > 0.004 ? "+" : v < -0.004 ? "−" : ""}${usd(Math.abs(v))}`;

/**
 * Profit or loss if each named outcome wins, as horizontal bars from a zero line: names stay
 * readable however many outcomes there are (no rotated or truncated axis labels). Ranked the same
 * way as the odds list, favorites first; longshots fold away.
 */
export function OutcomeBars({
  labels,
  pl,
  wins,
  order,
  hover,
  onHover,
  first = 8,
}: {
  labels: string[];
  pl: number[];
  wins: boolean[];
  /** Outcome indices, top to bottom. */
  order: number[];
  hover: number | null;
  onHover: (i: number | null) => void;
  /** Rows shown before "Show more" (outcomes you profit on always show). */
  first?: number;
}) {
  const [all, setAll] = useState(false);
  const rows = all ? order : order.filter((i, k) => k < first || wins[i] || i === hover);
  const hidden = order.length - rows.length;
  const lo = Math.min(0, ...pl);
  const hi = Math.max(0, ...pl);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  const zero = pos(0);

  return (
    // Fills whatever height it's given, the rows spread evenly down it.
    <div className="flex h-full flex-col">
      <ul className="flex flex-1 flex-col justify-evenly" aria-label="Profit or loss if each outcome wins">
        {rows.map((i) => {
          const v = pl[i];
          const left = Math.min(zero, pos(v));
          const width = Math.max(0.8, Math.abs(pos(v) - zero));
          const on = hover === i;
          return (
            <li
              key={i}
              onMouseEnter={() => onHover(i)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onHover(i)}
              className={`ease grid cursor-default grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.75rem] items-center gap-3 rounded-[12px] px-2 py-1.5 ${on ? "bg-porcelain" : ""}`}
            >
              <span className={`truncate text-[14px] ${wins[i] ? "font-bold text-inkstone" : "text-slate"}`} title={labels[i]}>
                {labels[i]}
              </span>
              <span className="relative block h-5">
                <span className="absolute inset-y-0 w-[1.5px] bg-inkstone" style={{ left: `${zero}%` }} aria-hidden="true" />
                <span
                  className="absolute inset-y-[3px] rounded-[4px]"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: wins[i] ? GAIN : on ? COLORS.slate : COLORS.ash,
                    transition: `left 480ms ${EASE}, width 480ms ${EASE}, background-color 240ms ease`,
                  }}
                  aria-hidden="true"
                />
              </span>
              <span className={`tnum text-right text-[14px] font-bold ${wins[i] ? "text-gain" : "text-inkstone"}`}>{signed(v)}</span>
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || all) && (
        <button type="button" onClick={() => setAll((a) => !a)} className="ease mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[14px] font-bold text-signal-violet hover:bg-cloud">
          <ChevronDown size={16} strokeWidth={2} className={`ease ${all ? "rotate-180" : ""}`} aria-hidden="true" />
          {all ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}
