export const usd = (x: number, digits = 2) =>
  `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
export const usd0 = (x: number) => usd(x, x >= 1000 ? 0 : x % 1 === 0 ? 0 : 2);
export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
export const cents = (p: number) => `${Math.round(p * 100)}¢`;
export const signed = (x: number, digits = 2) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(digits)}`;
export const qty = (q: number) => q.toLocaleString("en-US", { maximumFractionDigits: 2 });
export const short = (s: string, n = 4) => (s.length <= 2 * n + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`);

const ET = "America/New_York";
export function settleLabel(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: ET });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET });
  return `${day}, ${time} ET`;
}
export function untilLabel(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "expired";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}
