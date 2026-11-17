export function Stat({ label, value, sub, large }: { label: string; value: React.ReactNode; sub?: React.ReactNode; large?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${large ? "stat-value-lg" : ""}`}>{value}</span>
      {sub && <span className="text-[14px] text-slate">{sub}</span>}
    </div>
  );
}
