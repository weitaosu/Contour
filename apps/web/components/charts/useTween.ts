"use client";

import { useEffect, useRef, useState } from "react";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Eases an array of numbers toward its target every animation frame (exponential approach,
 * frame-rate independent). Snaps when the length changes or the user prefers reduced motion, and
 * follows the target exactly while `immediate` is on (direct manipulation: the curve stays under the
 * pointer), so switching it off never jumps.
 */
export function useTweenedArray(target: readonly number[], speed = 0.2, immediate = false): number[] {
  const [value, setValue] = useState<number[]>(() => [...target]);
  const cur = useRef<number[]>([...target]);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (cur.current.length !== target.length || immediate || reducedMotion()) {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
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
  }, [target, speed, immediate]);
  return immediate ? (target as number[]) : value;
}

/**
 * Morphs an array of numbers to its target on a critically damped spring (no overshoot), settling
 * in about `duration` ms. A new target mid-flight keeps the current velocity instead of restarting
 * from rest, so a stream of targets (a curve being dragged) reads as one fluid motion rather than a
 * stutter of restarts. Every element shares the same spring, so bars, scales and axes packed into
 * one array move in lockstep. Snaps when the length changes or the user prefers reduced motion.
 */
export function useMorph(target: readonly number[], duration = 480): number[] {
  const [value, setValue] = useState<number[]>(() => [...target]);
  const cur = useRef<number[]>([...target]);
  const vel = useRef<number[]>(target.map(() => 0));
  const goal = useRef<readonly number[]>(target);
  const raf = useRef<number | null>(null);
  // Keyed on the values, not the array: a parent re-rendering with an equal new array (every second,
  // for a countdown) must not disturb a morph mid-flight.
  const latest = useRef(target);
  latest.current = target;
  const sig = target.map((v) => Math.round(v * 1e6) / 1e6).join(",");
  // Half-way after ~28% of `duration`, within ~2% at `duration` (ω·t = 6).
  const omega = 6000 / Math.max(1, duration);
  useEffect(() => {
    const target = latest.current;
    goal.current = target;
    if (cur.current.length !== target.length || reducedMotion()) {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      cur.current = [...target];
      vel.current = target.map(() => 0);
      setValue([...target]);
      return;
    }
    if (raf.current !== null) return; // already running: it picks up the new goal next frame
    if (cur.current.every((v, i) => Math.abs(v - target[i]) < 1e-9)) return;
    let last: number | null = null;
    const step = (now: number) => {
      const g = goal.current;
      // Seconds since the last frame, capped so a background tab doesn't teleport on return.
      const dt = last === null ? 1 / 60 : Math.min(0.064, Math.max(0, (now - last) / 1000));
      last = now;
      const decay = Math.exp(-omega * dt);
      let settled = true;
      const x = cur.current.map((c, i) => {
        // Exact critically damped step: d(t) = (d0 + (v0 + ω·d0)·t)·e^(−ωt), stable at any frame rate.
        const d0 = c - g[i];
        const v0 = vel.current[i];
        const b = v0 + omega * d0;
        const d = (d0 + b * dt) * decay;
        vel.current[i] = (v0 - omega * b * dt) * decay;
        const tol = 1e-4 * (1 + Math.abs(g[i]));
        if (Math.abs(d) > tol || Math.abs(vel.current[i]) > tol * omega) settled = false;
        return g[i] + d;
      });
      if (settled || !x.every(Number.isFinite)) {
        cur.current = [...g];
        vel.current = g.map(() => 0);
        setValue([...g]);
        raf.current = null;
        return;
      }
      cur.current = x;
      setValue(x);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [sig, omega]);
  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    },
    [],
  );
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
