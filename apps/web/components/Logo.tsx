/** Contour mark: nested contour lines in a violet tile. Monoline, single color. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {/* The brand violet, fixed: pages that restyle --color-signal-violet don't recolor the logo. */}
      <rect width="32" height="32" rx="9" fill="#594ff4" />
      <path d="M6 22c3-7 6-11 10-11s7 4 10 11" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M10.5 22c2-4 3.6-6 5.5-6s3.5 2 5.5 6" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-3">
      <LogoMark />
      {/* Inter bold, also inside the landing styles (which set their own fonts). */}
      <span className="font-[family-name:var(--font-inter)] text-[20px] font-bold tracking-[0.04em] text-[#0b0b12]">Contour</span>
    </span>
  );
}
