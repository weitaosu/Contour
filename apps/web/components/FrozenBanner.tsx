import { FlaskConical, Snowflake } from "lucide-react";

/** Marks a made-up demo market, so nobody mistakes its prices for a real exchange's. */
export function SampleBanner({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  if (compact)
    return (
      <div role="status" className={`flex items-center gap-2.5 rounded-[16px] border border-dashed border-ash bg-cloud px-4 py-2 text-[13.5px] text-inkstone ${className}`}>
        <FlaskConical size={16} strokeWidth={1.75} className="shrink-0 text-signal-violet" aria-hidden="true" />
        <p className="min-w-0">
          <b>Sample market with made-up prices.</b>{" "}
          <span className="text-slate">Modeled on the Fed rate-decision markets exchanges list before each FOMC meeting; it can&apos;t be traded.</span>
        </p>
      </div>
    );
  return (
    <div role="status" className={`flex items-start gap-3 rounded-[20px] border border-dashed border-ash bg-cloud px-5 py-4 text-left text-[15px] text-inkstone ${className}`}>
      <FlaskConical size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-signal-violet" aria-hidden="true" />
      <p>
        <b>Sample market with made-up prices.</b>{" "}
        <span className="text-slate">
          It&apos;s modeled on the Fed rate-decision markets that exchanges list before each FOMC meeting, so you can try a race with several outcomes. The prices
          aren&apos;t real quotes, and it can&apos;t be traded.
        </span>
      </p>
    </div>
  );
}

/** Says plainly that the prices on screen are a saved copy, not live, and what that means for the user. */
export function FrozenBanner({ at, className = "" }: { at: number | string; className?: string }) {
  const when = new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
  return (
    <div role="status" className={`flex items-start gap-3 rounded-[20px] border border-mist bg-cloud px-5 py-4 text-left text-[15px] text-inkstone ${className}`}>
      <Snowflake size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-signal-violet" aria-hidden="true" />
      <p>
        <b>Frozen prices from {when} ET.</b> <span className="text-slate">Gemini&apos;s live market data isn&apos;t responding, so you&apos;re exploring a saved copy. Everything works for looking around, but prices won&apos;t move and positions can&apos;t be opened until it&apos;s back.</span>
      </p>
    </div>
  );
}
