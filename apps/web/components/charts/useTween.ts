"use client";

import { useEffect, useRef, useState } from "react";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Eases an array of numbers toward its target every animation frame (exponential approach,
 * frame-rate independent). Snaps when the length changes or the user prefers reduced motion.
 */
export function useTweenedArray(target: readonly number[], speed = 0.2): number[] {
  const [value, setValue] = useState<number[]>(() => [...target]);
  const cur = useRef<number[]>([...target]);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (cur.current.length !== target.length || reducedMotion()) {
      cur.current = [...target];
      setValue([...target]);
      return;
    }
    let last: number | null = null;
    const step = (now: number) => {
      // rAF timestamps can precede performance.now() at scheduling time; never let dt go negative.
      const dt = last === null ? 16.7 : Math.min(64, Math.max(0, now - last));
      last = now;
      const k = Math.min(1, Math.max(0, 1 - Math.pow(1 - speed, dt / 16.7)));
      let maxDiff = 0;
      const next = cur.current.map((c, i) => {
        const d = target[i] - c;
        maxDiff = Math.max(maxDiff, Math.abs(d) / (Math.abs(target[i]) + 1e-6));
        return c + d * k;
      });
      if (maxDiff < 1e-4 || !next.every(Number.isFinite)) {
        cur.current = [...target];
        setValue([...target]);
        raf.current = null;
        return;
      }
      cur.current = next;
      setValue(next);
      raf.current = requestAnimationFrame(step);
    };
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [target, speed]);
  return value;
}

export function useTweenedNumber(target: number, speed = 0.2): number {
  const arr = useTweenedArray(useStableArray(target), speed);
  return arr[0];
}

function useStableArray(v: number) {
  const ref = useRef<number[]>([v]);
  if (ref.current[0] !== v) ref.current = [v];
  return ref.current;
}
