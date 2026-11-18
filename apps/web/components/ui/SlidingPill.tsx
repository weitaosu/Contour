"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * The white "selected" pill of a segmented control, sliding to whichever child is marked
 * data-active="true" on a damped spring (it overshoots a touch and settles) instead of jumping.
 * Put `track` on the control (position: relative) and render `pill` first inside it.
 */
export function useSlidingPill(active: unknown) {
  const track = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [ready, setReady] = useState(false); // no slide on first placement, only on changes
  const measure = () => {
    const el = track.current?.querySelector<HTMLElement>('[data-active="true"]');
    setBox(el ? { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight } : null);
  };
  useLayoutEffect(measure, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = track.current;
    if (!t) return;
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!box || ready) return;
    const r = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(r);
  }, [box, ready]);
  const style: CSSProperties | undefined = box
    ? {
        transform: `translate(${box.x}px, ${box.y}px)`,
        width: box.w,
        height: box.h,
        transition: ready ? "transform var(--spring-ms) var(--spring), width var(--spring-ms) var(--spring), height var(--spring-ms) var(--spring)" : "none",
      }
    : undefined;
  const pill = box ? (
    <span aria-hidden="true" className="pointer-events-none absolute left-0 top-0 rounded-full bg-porcelain shadow-[0_1px_3px_rgba(31,31,31,0.12)]" style={style} />
  ) : null;
  return { track, pill };
}
