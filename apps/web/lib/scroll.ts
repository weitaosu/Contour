/**
 * A smooth page scroll that feels the same everywhere: a gentle ease-in-out (sine) glide, slow
 * enough that the page visibly shifts rather than jumps (peak speed about 1 px/ms), with a duration
 * that grows with the distance. It's driven by requestAnimationFrame, hands control back the moment
 * the user scrolls, drags or presses a key, and jumps instantly for reduced-motion users.
 */
const easeInOutSine = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;

let cancelCurrent: (() => void) | null = null;

export function smoothScrollTo(top: number) {
  cancelCurrent?.();
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const to = Math.max(0, Math.min(max, top));
  const from = window.scrollY;
  const dist = to - from;
  if (Math.abs(dist) < 1) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    window.scrollTo({ top: to, behavior: "instant" });
    return;
  }
  const duration = Math.min(1500, Math.max(850, 600 + Math.abs(dist) * 0.5));
  const start = performance.now();
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.removeEventListener(ev, stop);
    cancelCurrent = null;
  };
  for (const ev of ["wheel", "touchstart", "keydown", "mousedown"]) window.addEventListener(ev, stop, { passive: true });
  cancelCurrent = stop;
  // Each frame asks for an instant scroll, so CSS smooth scrolling can't fight the per-frame position
  // (changing the root's scroll-behavior instead would restyle the whole page and drop a frame).
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    window.scrollTo({ top: from + dist * easeInOutSine(t), behavior: "instant" });
    if (t < 1) raf = requestAnimationFrame(step);
    else stop();
  };
  raf = requestAnimationFrame(step);
}

/** Smooth-scroll to an element, honouring its CSS scroll-margin-top (e.g. room for a sticky header). */
export function smoothScrollToElement(el: Element) {
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  smoothScrollTo(el.getBoundingClientRect().top + window.scrollY - margin);
}
