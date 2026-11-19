"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { blend, compile, type Ladder, type PositionShape } from "@contour/core";
import { Slider } from "@/components/ui/Slider";
import { pct, usd } from "@/lib/format";
import { isWin } from "@/lib/outcomes";

const QUICK = [0.5, 0.75, 1];

/**
 * Custom confidence, shown as the mechanism it really is: Contour never trades on the user's curve
 * alone. It blends it with the market's, odds = c × yours + (1 − c) × market's, and sizes a
 * growth-optimal (Kelly) position against those blended odds. The chart draws all three curves, so
 * dragging c visibly slides the curve the solver uses between the market's and the user's.
 */
export function ConfidenceDialog({
  open,
  onOpenChange,
  ladder,
  belief,
  stake,
  shape = "free",
  value,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ladder: Ladder;
  belief: number[];
  stake: number;
  /** The kind of position the screen builds ("range" for Stays near), so the preview matches it. */
  shape?: PositionShape;
  value: number;
  onApply: (c: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const c = useDeferredValue(draft);
  const market = ladder.marketProb;
  const used = useMemo(() => blend(belief, market, c), [belief, market, c]);
  const quote = useMemo(() => compile({ ladder, belief, confidence: c, stakeUsd: Math.max(1, stake), maxIter: 20_000, shape }), [ladder, belief, c, stake, shape]);
  const wins = quote.payoutByBucket.map((p) => isWin(p, stake));
  const chance = market.reduce((s, q, j) => s + (wins[j] ? q : 0), 0);
  const contracts = quote.legs.reduce((a, l) => a + l.usd, 0);
  // How far the odds Contour trades on sit from the market's (total variation distance, in points).
  const gap = 50 * used.reduce((s, p, j) => s + Math.abs(p - market[j]), 0);
  const noTrade = quote.advice === "no_edge";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fade-in fixed inset-0 z-40 bg-inkstone/40" />
        <Dialog.Content className="fade-up fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-y-auto rounded-t-[32px] bg-porcelain px-6 pb-8 pt-6 md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[min(620px,calc(100vw-32px))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[36px] md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Custom confidence</p>
              <Dialog.Title className="mt-1 text-[24px] font-bold leading-tight text-inkstone">How much should your view count?</Dialog.Title>
            </div>
            <Dialog.Close className="rounded-full p-2 text-slate hover:bg-cloud" aria-label="Close">
              <X size={20} />
            </Dialog.Close>
          </div>

          <Dialog.Description className="mt-3 text-[15px] text-slate">
            Contour never trades on your view alone. It blends your view with the market&apos;s, then sizes the position that grows your money fastest on
            average if those blended odds are right (the Kelly rule). Confidence is the weight your view gets in that blend.
          </Dialog.Description>

          {/* the formula, with the live weights */}
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[18px] bg-cloud px-4 py-3 text-[15px] text-inkstone">
            <span className="font-bold">Odds Contour trades on</span>
            <span className="text-slate">=</span>
            <span className="tnum rounded-full bg-signal-violet px-2.5 py-0.5 font-bold text-white">{pct(draft)}</span>
            <span>× your view</span>
            <span className="text-slate">+</span>
            <span className="tnum rounded-full bg-mist px-2.5 py-0.5 font-bold">{pct(1 - draft)}</span>
            <span>× the market&apos;s</span>
          </div>

          <BlendChart market={market} yours={belief} used={used} labels={ladder.cutLabels.length === market.length - 1 ? ladder.cutLabels : null} />

          <div className="mt-5">
            <Slider
              label="Your view's weight"
              value={draft}
              min={0.05}
              max={1}
              step={0.01}
              onChange={(v) => setDraft(Math.round(v * 100) / 100)}
              display={pct(draft)}
              valueText={`${Math.round(draft * 100)} percent weight on your view`}
              ends={["Trust the market", "Trust my view"]}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK.map((q) => (
                <button key={q} type="button" onClick={() => setDraft(q)} className={`tag tnum ${Math.abs(draft - q) < 1e-9 ? "tag-active" : ""}`}>
                  {pct(q)}
                </button>
              ))}
            </div>
          </div>

          {/* what this setting does to the position */}
          <div className="mt-6 border-t border-mist pt-5" aria-live="polite">
            <p className="stat-label">At {pct(c)} on a {usd(stake, 0)} position</p>
            {noTrade ? (
              <p className="mt-2 text-inkstone">The blended odds sit too close to the market&apos;s to beat fees and spreads, so everything stays in cash.</p>
            ) : (
              <div className="mt-3 grid grid-cols-3 gap-3">
                <Effect label="Really at risk" value={usd(stake - quote.minPayout)} />
                <Effect label="Best case" value={<span className="text-gain">+{usd(quote.maxPayout - stake)}</span>} />
                <Effect label="Chance of profit" value={pct(chance)} sub="by the market's odds" />
              </div>
            )}
            <ul className="mt-4 flex flex-col gap-1.5 text-[14px] text-slate">
              <li>
                The odds Contour trades on differ from the market&apos;s by <b className="tnum text-inkstone">{gap.toFixed(1)} points</b>. That gap is the edge it
                thinks it has; it bets only when the gap beats Gemini&apos;s fees and spreads.
              </li>
              <li>
                The Kelly rule puts <b className="tnum text-inkstone">{pct(contracts / stake)}</b> of your stake into contracts ({usd(contracts)}) and keeps the rest as
                cash. Higher weight, bigger gap, bigger bet: and a bigger loss if your view is wrong.
              </li>
            </ul>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
            <button
              type="button"
              className="btn btn-primary sm:flex-1"
              onClick={() => {
                onApply(draft);
                onOpenChange(false);
              }}
            >
              Use {pct(draft)}
            </button>
            <Dialog.Close className="btn btn-quiet sm:flex-1">Cancel</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Effect({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-[16px] bg-cloud px-4 py-3">
      <p className="text-[13px] text-slate">{label}</p>
      <p className="tnum text-[20px] font-bold leading-tight text-inkstone">{value}</p>
      {sub && <p className="text-[12px] text-smoke">{sub}</p>}
    </div>
  );
}

/** Market (dashed), yours (thin violet) and the blend Contour trades on (bold, filled). */
function BlendChart({ market, yours, used, labels }: { market: number[]; yours: number[]; used: number[]; labels: string[] | null }) {
  const W = 560;
  const H = 170;
  const pad = { l: 8, r: 8, t: 12, b: labels ? 22 : 8 };
  const n = market.length;
  // Open-ended tail outcomes ("below $65") pool a lot of probability and would flatten the rest of the
  // curve, so scale to the interior outcomes and clip the tails, labelling their real value.
  const interior = n > 4 ? [market, yours, used].flatMap((s) => s.slice(1, -1)) : [...market, ...yours, ...used];
  const ymax = Math.max(...interior) * 1.15 || 1;
  const x = (j: number) => pad.l + ((j + 0.5) / n) * (W - pad.l - pad.r);
  const y = (p: number) => H - pad.b - (Math.min(p, ymax) / ymax) * (H - pad.t - pad.b);
  const clipped = n > 4 ? [0, n - 1].filter((j) => used[j] > ymax) : [];
  const line = (ps: number[]) => ps.map((p, j) => `${j ? "L" : "M"}${x(j).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  const area = (ps: number[]) => `${line(ps)} L${x(n - 1).toFixed(1)},${H - pad.b} L${x(0).toFixed(1)},${H - pad.b} Z`;
  const stride = labels ? Math.max(1, Math.ceil(labels.length / 6)) : 1;
  return (
    <div className="mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="The market's odds, your view, and the blend Contour trades on">
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--color-ash)" />
        <path d={area(used)} fill="rgba(89,79,244,0.10)" style={{ transition: "d 200ms ease" }} />
        <path d={line(market)} fill="none" stroke="var(--color-smoke)" strokeWidth={1.5} strokeDasharray="4 4" />
        <path d={line(yours)} fill="none" stroke="var(--color-signal-violet)" strokeWidth={1.5} strokeOpacity={0.55} />
        <path d={line(used)} fill="none" stroke="var(--color-signal-violet)" strokeWidth={3} strokeLinejoin="round" style={{ transition: "d 200ms ease" }} />
        {clipped.map((j) => (
          <text key={j} x={x(j)} y={pad.t + 2} dy="0.7em" textAnchor={j === 0 ? "start" : "end"} fontSize={11} fontWeight={700} fill="var(--color-signal-violet)" className="tnum">
            {j === 0 ? "↑ " : ""}
            {Math.round(used[j] * 100)}%{j === 0 ? "" : " ↑"}
          </text>
        ))}
        {labels?.map((l, i) =>
          i % stride === 0 ? (
            <text key={i} x={(x(i) + x(i + 1)) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-smoke)" className="tnum">
              {l}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-slate">
        <span className="inline-flex items-center gap-2">
          <span className="h-0 w-4 border-t-[1.5px] border-dashed border-smoke" /> Market&apos;s odds
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-[2px] w-4 rounded-full bg-signal-violet opacity-55" /> Your view
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-[3px] w-4 rounded-full bg-signal-violet" /> What Contour trades on
        </span>
      </div>
    </div>
  );
}
