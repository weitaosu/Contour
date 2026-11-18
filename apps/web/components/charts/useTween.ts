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

/**
 * Morphs an array of numbers to a new target on one eased timeline (cubic in-out). Starts from
 * whatever is on screen, so interrupting a morph never jumps. Pack every animated value of a chart
 * into one array so bars, scales and axes move in lockstep. Snaps when the length changes or the
 * user prefers reduced motion.
 */
export function useMorph(target: readonly number[], duration = 480): number[] {
  const [value, setValue] = useState<number[]>(() => [...target]);
  const cur = useRef<number[]>([...target]);
  const raf = useRef<number | null>(null);
  // Keyed on the values, not the array: a parent re-rendering with an equal new array (every second,
  // for a countdown) must not restart a morph mid-flight.
  const latest = useRef(target);
  latest.current = target;
  const sig = target.map((v) => Math.round(v * 1e6) / 1e6).join(",");
  useEffect(() => {
    const target = latest.current;
    if (cur.current.length !== target.length || reducedMotion()) {
      cur.current = [...target];
      setValue([...target]);
      return;
    }
    const from = [...cur.current];
    if (from.every((v, i) => Math.abs(v - target[i]) < 1e-9)) return;
    const t0 = performance.now();
    const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    const step = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0) / duration));
      const e = ease(k);
      const next = target.map((to, i) => from[i] + (to - from[i]) * e);
      cur.current = next;
      setValue(next);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else raf.current = null;
    };
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [sig, duration]);
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

/**
 * Like useTweenedArray, but each element starts slightly after its left neighbour, so a change
 * sweeps across the chart from left to right. Eased with a cubic ease-out.
 */
export function useStaggeredArray(target: readonly number[], duration = 520, stagger = 28): number[] {
  const [value, setValue] = useState<number[]>(() => [...target]);
  const cur = useRef<number[]>([...target]);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (cur.current.length !== target.length || reducedMotion()) {
      cur.current = [...target];
      setValue([...target]);
      return;
    }
    const from = [...cur.current];
    if (from.every((v, i) => Math.abs(v - target[i]) < 1e-9)) return;
    const t0 = performance.now();
    const total = duration + stagger * (target.length - 1);
    const step = (now: number) => {
      const t = Math.max(0, now - t0);
      const next = target.map((to, i) => {
        const k = Math.min(1, Math.max(0, (t - i * stagger) / duration));
        const e = 1 - Math.pow(1 - k, 3);
        return from[i] + (to - from[i]) * e;
      });
      cur.current = next;
      setValue(next);
      if (t < total) raf.current = requestAnimationFrame(step);
      else raf.current = null;
    };
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [target, duration, stagger]);
  return value;
}
