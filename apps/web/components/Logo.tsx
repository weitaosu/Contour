/** Contour mark: nested contour lines in a violet tile. Monoline, single color. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--color-signal-violet)" />
      <path d="M6 22c3-7 6-11 10-11s7 4 10 11" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M10.5 22c2-4 3.6-6 5.5-6s3.5 2 5.5 6" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-3">
      <LogoMark />
      <span className="text-[20px] font-bold tracking-[0.04em] text-inkstone">Contour</span>
    </span>
  );
}
