"use client";

import { useState } from "react";
import { Slider as RSlider } from "radix-ui";

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  display,
  ends,
  valueText,
  caption,
  compact = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display?: React.ReactNode;
  ends?: [string, string];
  valueText?: string;
  /** One short line under the track (compact sliders use it instead of end labels). */
  caption?: React.ReactNode;
  compact?: boolean;
}) {
  // While a pointer holds it the thumb follows the hand exactly; when the value is set from outside
  // (picking an outlook), thumb and fill glide there on the spring.
  const [held, setHeld] = useState(false);
  return (
    <div className={`flex flex-col ${compact ? "gap-1" : "gap-3"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="stat-label">{label}</span>
        {display !== undefined && (
          <span className={`tnum rounded-full px-3 py-0.5 font-bold ${compact ? "bg-signal-violet/10 text-[14px] text-signal-violet" : "bg-porcelain text-inkstone"}`}>{display}</span>
        )}
      </div>
      <RSlider.Root
        className={`relative flex h-6 w-full touch-none items-center ${held ? "" : "slider-glide"}`}
        onPointerDown={() => setHeld(true)}
        onPointerUp={() => setHeld(false)}
        onLostPointerCapture={() => setHeld(false)}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        aria-label={label}
      >
        <RSlider.Track className="relative h-[6px] grow cursor-pointer rounded-full bg-mist">
          <RSlider.Range className="slider-range absolute h-full rounded-full bg-signal-violet" />
        </RSlider.Track>
        <RSlider.Thumb
          aria-valuetext={valueText}
          className="block h-6 w-6 cursor-grab rounded-full border-[2.5px] border-signal-violet bg-porcelain shadow-[0_0_0_0_rgba(89,79,244,0.18)] transition-[box-shadow,transform] duration-150 hover:scale-110 hover:shadow-[0_0_0_7px_rgba(89,79,244,0.14)] focus-visible:outline-none focus-visible:shadow-[0_0_0_7px_rgba(89,79,244,0.22)] active:cursor-grabbing active:scale-115 active:shadow-[0_0_0_10px_rgba(89,79,244,0.16)]"
        />
      </RSlider.Root>
      {caption && <p className="tnum text-[12.5px] leading-snug text-slate">{caption}</p>}
      {ends && (
        <div className="flex justify-between text-[14px] text-smoke">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}
