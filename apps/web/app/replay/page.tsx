"use client";

import { PageTransition } from "@/components/PageTransition";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { desk, type ReplayView } from "@/lib/desk";
import { ReplayChart } from "@/components/charts/ReplayChart";
import { FOCUS_PANEL, Panel, StepBadge } from "@/components/forecast/Panel";
import { Tile } from "@/components/forecast/ProfitCard";
import { Segmented } from "@/components/ui/Segmented";
import { pct, signed } from "@/lib/format";

type Strategy = ReplayView["strategies"][number];

/** One test forecast: Contour's position against the single best contract, side by side (as inside a market). */
function ForecastCompare({ forecast, contour, single }: { forecast: string; contour?: Strategy; single?: Strategy }) {
  const rows: [string, (s: Strategy) => string, "high" | "low"][] = [
    ["Average return", (s) => `${signed(s.mean * 100, 1)}%`, "high"],
    ["Swing (std dev)", (s) => `${(s.sd * 100).toFixed(1)}%`, "low"],
    ["Worst ladder", (s) => `${signed(s.worst * 100, 1)}%`, "high"],
    ["Profitable", (s) => pct(s.shareProfit), "high"],
  ];
  const n = contour?.n ?? single?.n ?? 0;
  return (
    <div className="flex min-w-0 flex-col rounded-[18px] bg-porcelain p-3">
      <p className="text-[14px] font-bold leading-snug text-inkstone">{forecast}</p>
      <p className="tnum text-[12.5px] text-smoke">
        {n} {n === 1 ? "ladder" : "ladders"}
      </p>
      <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 text-[13.5px]">
        <span />
        <span className="text-right text-[11.5px] uppercase tracking-[0.075em] text-signal-violet">Contour</span>
        <span className="text-right text-[11.5px] uppercase tracking-[0.075em] text-smoke">One contract</span>
        {rows.map(([label, f, better]) => {
          // Bold whichever side does better on this row, once there's data to compare.
          const c = contour ? (label === "Swing (std dev)" ? contour.sd : label === "Profitable" ? contour.shareProfit : label === "Worst ladder" ? contour.worst : contour.mean) : null;
          const s1 = single ? (label === "Swing (std dev)" ? single.sd : label === "Profitable" ? single.shareProfit : label === "Worst ladder" ? single.worst : single.mean) : null;
          const cWins = n > 0 && c !== null && s1 !== null && (better === "high" ? c > s1 : c < s1);
          const sWins = n > 0 && c !== null && s1 !== null && (better === "high" ? s1 > c : s1 < c);
          return (
            <span key={label} className="contents">
              <span className="whitespace-nowrap text-slate">{label}</span>
              <span className={`tnum text-right ${cWins ? "font-bold text-signal-violet" : "text-inkstone"}`}>{contour && n ? f(contour) : "—"}</span>
              <span className={`tnum text-right ${sWins ? "font-bold text-inkstone" : "text-slate"}`}>{single && n ? f(single) : "—"}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function ReplayPageContent() {
  const q = useQuery({ queryKey: ["replay"], queryFn: desk.replay, refetchInterval: 5 * 60_000 });
  const d = q.data;
  const forecasts = d?.series.map((s) => s.forecast) ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const which = picked && forecasts.includes(picked) ? picked : forecasts[0] ?? "";
  const series = d?.series.find((s) => s.forecast === which);
  const at = d?.generatedAt ? new Date(d.generatedAt) : null;
  const computedTime = at ? at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : null;
  const computedDay = at ? at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : null;
  // "Snapshot 30 min before expiry for hourly ladders, …" reads as the step's own description.
  const horizon = (d?.horizonNote ?? "a fixed time before each ladder settles").replace(/\.$/, "").replace(/^Snapshot\s+/i, "");

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-2 px-4 pb-8 pt-3 md:px-6">
      {/* Intro beside the result, as on the front page */}
      <div className="grid items-stretch gap-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.45fr)]">
        <section className="flex min-w-0 flex-col rounded-[24px] bg-cloud p-5 xl:p-6">
          <p className="text-[12.5px] uppercase tracking-[0.075em] text-smoke">Replay · recorded Gemini ladders</p>
          <h1 className="mt-3 text-[34px] font-bold leading-[1.05] tracking-[0.01em] text-inkstone xl:text-[42px]">One contract versus the whole view</h1>
          <p className="mt-3 max-w-[520px] text-[15px] leading-relaxed text-slate">
            Past Gemini ladders, replayed: the same test forecasts placed as a $100 Contour position and as the single best contract for that forecast, then settled
            against what actually happened.
          </p>
          <ol className="mt-5 flex flex-col gap-2.5 text-[14px]">
            {[
              ["Snapshot", horizon],
              ["Same forecast, two ways", "a Contour position and one contract"],
              ["Settle", "against the real outcome, at quoted asks before fees"],
            ].map(([t, x], i) => (
              <li key={t} className="flex gap-2.5">
                <StepBadge n={i + 1} />
                <span>
                  <b className="text-inkstone">{t}</b> <span className="text-slate">· {x}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/" className="btn btn-primary !gap-1.5 !px-5 !py-2.5">
              Try a live market <ArrowRight size={16} strokeWidth={2.25} />
            </Link>
          </div>
          <div className="mt-auto grid grid-cols-3 gap-2 pt-6">
            <Tile compact label="Ladders" value={d ? d.sampleSize : "…"} sub="settled in the sample" />
            <Tile compact label="Forecasts" value={d ? forecasts.length : "…"} sub="tested on each" />
            <Tile compact label="Computed" value={computedTime ?? "…"} sub={computedDay ? `${computedDay} · ET` : "ET"} />
          </div>
        </section>

        <section aria-label="Cumulative return" className={`flex min-w-0 flex-col rounded-[24px] p-4 ${FOCUS_PANEL}`}>
          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div>
              <p className="text-[16px] font-bold leading-tight text-inkstone">Cumulative return per $1 staked</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-[3px] w-4 rounded-full bg-signal-violet" /> Contour position
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-[2px] w-4 rounded-full bg-inkstone" /> Single best contract
                </span>
              </p>
            </div>
            {forecasts.length > 0 && <Segmented label="Test forecast" options={forecasts.map((f) => ({ value: f, label: f }))} value={which} onChange={setPicked} />}
          </header>
          <div className="mt-3 flex min-h-[280px] flex-1 flex-col justify-center rounded-[18px] bg-cloud p-3">
            {series && series.points.length > 0 ? (
              <ReplayChart points={series.points} height={280} />
            ) : (
              <p className="mx-auto max-w-[440px] text-center text-[14px] text-slate">
                {q.isLoading
                  ? "Computing…"
                  : "No settled ladders recorded yet. The recorder snapshots every 5 minutes, and hourly ladders settle on the hour, so this fills in on its own."}
              </p>
            )}
          </div>
        </section>
      </div>

      <Panel
        title="By forecast"
        hint="Each test forecast, placed both ways. The better side of each row is in bold."
        right={<span className="text-smoke">Returns at quoted asks before fees</span>}
      >
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {forecasts.map((f) => (
            <ForecastCompare
              key={f}
              forecast={f}
              contour={d?.strategies.find((s) => s.forecast === f && s.kind === "contour")}
              single={d?.strategies.find((s) => s.forecast === f && s.kind === "single")}
            />
          ))}
          {!forecasts.length && <p className="rounded-[16px] bg-porcelain px-4 py-3 text-[14px] text-slate">{q.isLoading ? "Computing…" : "No forecasts to compare yet."}</p>}
        </div>
        <p className="mt-3 text-[13px] leading-snug text-slate">
          {d?.note ?? "The test forecasts carry no information, so this compares the shape of outcomes (how much they swing, the worst case), not skill."}
        </p>
      </Panel>
    </div>
  );
}

/** The page, animated in and out on navigation. */
export default function ReplayPage() {
  return (
    <PageTransition>
      <ReplayPageContent />
    </PageTransition>
  );
}
