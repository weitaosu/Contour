const SQRT_PI = Math.sqrt(Math.PI);

/** erfc for x >= 0, accurate to ~1e-14 (series for small x, continued fraction for large x). */
function erfcPos(x: number): number {
  if (x < 3) {
    // erf(x) = 2/sqrt(pi) * exp(-x^2) * sum_{n>=0} 2^n x^(2n+1) / (1*3*...*(2n+1))  (all terms positive)
    let term = x;
    let sum = x;
    const x2 = x * x;
    for (let n = 1; n < 200; n++) {
      term *= (2 * x2) / (2 * n + 1);
      sum += term;
      if (term < sum * 1e-17) break;
    }
    return 1 - ((2 / SQRT_PI) * Math.exp(-x2) * sum);
  }
  // Continued fraction (modified Lentz): erfc(x) = exp(-x^2)/sqrt(pi) * 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + ...))))
  const tiny = 1e-300;
  let f = x;
  let C = x;
  let D = 0;
  for (let n = 1; n < 500; n++) {
    const a = n / 2;
    D = x + a * D;
    D = Math.abs(D) < tiny ? tiny : D;
    C = x + a / C;
    C = Math.abs(C) < tiny ? tiny : C;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / SQRT_PI / f;
}

export function erfc(x: number): number {
  if (Number.isNaN(x)) return NaN;
  return x >= 0 ? erfcPos(x) : 2 - erfcPos(-x);
}

/** Standard normal CDF. */
export function normCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/** Upper tail 1 - Phi(z), computed without cancellation. */
export function normSf(z: number): number {
  return 0.5 * erfc(z / Math.SQRT2);
}

export const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function normalize(xs: readonly number[], floor = 0): number[] {
  const f = xs.map((x) => Math.max(floor, Number.isFinite(x) ? x : 0));
  const s = sum(f);
  if (s <= 0) return f.map(() => 1 / f.length);
  return f.map((x) => x / s);
}
