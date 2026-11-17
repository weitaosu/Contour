"use client";

import { useTweenedNumber } from "@/components/charts/useTween";

/** A number that eases to its new value (count-up), formatted by the caller. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const v = useTweenedNumber(value, 0.2);
  return <span className="tnum">{format(v)}</span>;
}
