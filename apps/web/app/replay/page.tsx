"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { desk } from "@/lib/desk";
import { ReplayChart } from "@/components/charts/ReplayChart";
import { pct, signed } from "@/lib/format";

export default function ReplayPage() {
  const q = useQuery({ queryKey: ["replay"], queryFn: desk.replay, refetchInterval: 5 * 60_000 });
  const [which, setWhich] = useState(0);
  const d = q.data;
  const series = d?.series[which];
  return (
    <div className="page pb-8 pt-10 md:pt-14">
      <p className="eyebrow">Replay · recorded Gemini ladders</p>
      <h1 className="title mt-2">One contract versus the whole view</h1>
      <div className="mt-6 inline-flex flex-wrap items-baseline gap-3 rounded-[16px] bg-cloud px-6 py-4">
        <span className="stat-value">{d ? d.sampleSize : "—"}</span>
        <span className="text-slate">settled ladders in this sample{d?.generatedAt ? ` · computed ${new Date(d.generatedAt).toLocaleString("en-US")}` : ""}</span>
      </div>
      <p className="mt-5 max-w-3xl text-slate">
        For every ladder the recorder saw settle, we take a snapshot before expiry ({(d?.horizonNote ?? "fixed horizon per series").replace(/\.$/, "")}), apply the same test
        forecasts, and compare a $100 Contour position with the single best contract for that forecast. {d?.note}
      </p>

      <section className="card mt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="card-title">Cumulative return per $1 staked</h2>
          <div className="flex flex-wrap gap-2">
            {d?.series.map((s, i) => (
              <button key={s.forecast} className={`tag ${i === which ? "tag-active" : "tag-white"}`} onClick={() => setWhich(i)}>
                {s.forecast}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex gap-5 text-[14px] text-slate">
          <span className="inline-flex items-center gap-2">
            <span className="h-[3px] w-4 rounded-full bg-signal-violet" /> Contour position
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-[2px] w-4 rounded-full bg-inkstone" /> Single best contract
          </span>
        </div>
        {series && series.points.length > 0 ? (
          <ReplayChart points={series.points} />
        ) : (
          <p className="py-16 text-center text-slate">{q.isLoading ? "Computing…" : "No settled ladders recorded yet. The recorder snapshots every 5 minutes; hourly ladders settle on the hour."}</p>
        )}
      </section>

      <section className="card mt-6 overflow-x-auto">
        <h2 className="card-title">By strategy</h2>
        <table className="mt-4 w-full min-w-[720px] text-[15px]">
          <thead>
            <tr className="text-left text-[14px] text-smoke">
              <th className="pb-3 font-medium">Forecast</th>
              <th className="pb-3 font-medium">Strategy</th>
              <th className="pb-3 text-right font-medium">Ladders</th>
              <th className="pb-3 text-right font-medium">Mean</th>
              <th className="pb-3 text-right font-medium">Std dev</th>
              <th className="pb-3 text-right font-medium">Worst</th>
              <th className="pb-3 text-right font-medium">Profitable</th>
            </tr>
          </thead>
          <tbody>
            {d?.strategies.map((s) => (
              <tr key={`${s.forecast}-${s.kind}`} className="border-t border-mist">
                <td className="py-3 text-slate">{s.forecast}</td>
                <td className={`py-3 font-bold ${s.kind === "contour" ? "text-signal-violet" : ""}`}>{s.name}</td>
                <td className="tnum py-3 text-right">{s.n}</td>
                <td className="tnum py-3 text-right">{signed(s.mean * 100, 1)}%</td>
                <td className="tnum py-3 text-right">{(s.sd * 100).toFixed(1)}%</td>
                <td className="tnum py-3 text-right">{signed(s.worst * 100, 1)}%</td>
                <td className="tnum py-3 text-right">{pct(s.shareProfit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-[14px] text-smoke">Returns at quoted asks before fees. Sample size is stated above; treat this as an illustration, not proof.</p>
      </section>
    </div>
  );
}
