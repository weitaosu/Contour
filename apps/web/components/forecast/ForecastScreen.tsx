"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, ViewTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  compile,
  formatValue,
  fromBars,
  isTradable,
  likelyRange,
  marketMoments,
  normalBelief,
  floorChoices,
  capChoices,
  protect,
  spread,
  rangeBelief,
  oddsBelief,
  underlyingName,
  paysIn,
  type Ladder,
  type Quote,
} from "@contour/core";
import { ArrowRight, Pencil } from "lucide-react";
import { desk, type StoredQuote } from "@/lib/desk";
import { useChainConfig } from "@/lib/chain";
import { pct, settleLabel, untilLabel, usd } from "@/lib/format";
import { isWin, runs, whenPhrase } from "@/lib/outcomes";
import { ProbabilityChart } from "@/components/charts/ProbabilityChart";
import { Slider } from "@/components/ui/Slider";
import { EvNote, KeyNumbers, MoneySplit, ProfitSummary, type SummaryStatus } from "./ProfitCard";
import { ProtectCard, ProtectControls, ProtectNotes } from "./ProtectCard";
import { MORE_STRATEGIES, MORE_STRATEGIES_ENABLED, type StrategyKey } from "./strategies";
import { CompareMini } from "./ComparisonCard";
import { LegsTable } from "./LegsPanel";
import { Fill, Panel, StepBadge } from "./Panel";
import { CandidateEditor } from "./CandidateEditor";
import { OUTLOOKS, OutlookPicker, SPLIT_OFFSET, type Outlook } from "./OutlookPicker";
import { ReviewDialog } from "./ReviewDialog";
import { ConfidenceDialog } from "./ConfidenceDialog";
import { FrozenBanner, SampleBanner } from "@/components/FrozenBanner";
import { CHART_MS, liveFill, useLive } from "@/lib/live";
import { networkName } from "@/lib/env";
import { LiveDot, LivePrice, TickNumber, spotText } from "./LivePrice";

/** New positions stop this long before a market settles (matches the desk's CLOSE_BUFFER_MS). */
const CLOSE_BUFFER_MS = 10 * 60_000;

type ShownQuote = Omit<Quote, "raw"> & { iterations?: number };

// Confidence is a four-step dial. 0 is left out: with no trust in your own forecast there is nothing to trade.
// Confidence = the weight the user's view gets when blended with the market's (see ConfidenceDialog).
// Three quick levels plus "Other" for any weight; below half rarely clears fees, so it isn't a preset.
const CONFIDENCE_LEVELS = [0.5, 0.75, 1] as const;
const CONFIDENCE_NAMES = ["half and half", "mostly my forecast", "only my forecast"] as const;
const DEFAULT_CONFIDENCE = 0.5;
const presetIndex = (c: number) => CONFIDENCE_LEVELS.findIndex((l) => Math.abs(l - c) < 1e-9);
const confidenceName = (c: number) => {
  const i = presetIndex(c);
  return i >= 0 ? CONFIDENCE_NAMES[i] : c < 0.5 ? "custom · leaning on the market" : "custom";
};

export interface Preset { c?: number; w?: number; x?: number; s?: number }

export function ForecastScreen({ ticker, preset = {} }: { ticker: string; preset?: Preset }) {
  // Slow tier: the full ladder (market odds) only refreshes every CHART_MS; live prices come from useLive.
  const ladderQ = useQuery({ queryKey: ["ladder", ticker], queryFn: () => desk.ladder(ticker), refetchInterval: CHART_MS });
  if (ladderQ.isError)
    return (
      <div className="page py-24">
        <p className="eyebrow">Market</p>
        <h1 className="title mt-2">This ladder can&apos;t be traded</h1>
        <p className="mt-4 max-w-xl text-slate">{(ladderQ.error as Error).message}</p>
      </div>
    );
  if (!ladderQ.data)
    return (
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-3 px-4 pt-4 md:px-6 lg:h-[calc(100dvh-73px)] lg:pb-4">
        <div className="h-4 w-64 rounded-full bg-cloud" />
        <div className="h-8 w-[420px] max-w-full rounded-full bg-cloud" />
        <div className="grid min-h-[560px] flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex flex-col gap-3">
            <div className="h-[88px] rounded-[24px] bg-cloud" />
            <div className="grid flex-1 gap-3 lg:grid-cols-2">
              <div className="rounded-[24px] bg-cloud" />
              <div className="rounded-[24px] bg-cloud" />
            </div>
            <div className="h-[180px] rounded-[24px] bg-cloud" />
          </div>
          <div className="rounded-[24px] bg-cloud" />
        </div>
      </div>
    );
  const d = ladderQ.data;
  return (
    <Screen
      ladder={d.ladder}
      preset={preset}
      offline={!!d.sample || !!d.frozen}
      banner={d.sample ? <SampleBanner compact /> : d.frozen ? <FrozenBanner at={d.capturedAt} className="!py-3" /> : null}
    />
  );
}

function Screen({ ladder, preset, offline, banner }: { ladder: Ladder; preset: Preset; offline: boolean; banner?: React.ReactNode }) {
  const ordered = ladder.cuts !== null;
  // Fast tier: spot price and current asks every few seconds (nothing to stream for samples or frozen data).
  const liveQ = useLive(ladder.eventTicker, !offline);
  const live = offline ? undefined : liveQ.data;
  const spot = live?.spot ?? null;
  const mkt = useMemo(() => (ordered ? marketMoments(ladder) : { mean: 0, sd: 1 }), [ladder, ordered]);
  // A view drawn or fine-tuned by hand sits at fixed prices (centerState). A picked outlook is relative:
  // "Higher" means higher than the price now, so its center follows the anchor below.
  const [centerState, setCenter] = useState<number>(() => mkt.mean + (preset.x ?? 0) * mkt.sd);
  const [range] = useState(() => ({ lo: mkt.mean - 2.5 * mkt.sd, hi: mkt.mean + 2.5 * mkt.sd, sd: mkt.sd }));
  // What the outlooks are relative to: the live price, re-read on the slow tier (every CHART_MS), so
  // the view re-centers with the chart refresh rather than on every tick. Without a live price
  // (commodities, weather, samples), the market's expected price.
  const [anchor, setAnchor] = useState<number | null>(null);
  useEffect(() => {
    if (anchor === null && spot) setAnchor(spot.price);
  }, [anchor, spot]);
  const base = anchor ?? mkt.mean;
  const [scale, setScale] = useState(() => Math.min(1.6, Math.max(0.4, preset.w ?? 1)));
  const [edit, setEdit] = useState(!ordered);
  const [bars, setBars] = useState<number[] | null>(ordered ? null : ladder.marketProb);
  const [draft, setDraft] = useState<number[] | null>(null);
  // Named-outcome markets: your take on each outcome as an odds multiplier against the market's
  // (1 = same as the market), so your view moves with the market like the price outlooks do.
  const [oddsW, setOddsW] = useState<number[]>(() => ladder.marketProb.map(() => 1));
  const takes = oddsW.length === ladder.marketProb.length ? oddsW : ladder.marketProb.map(() => 1);
  const [confidence, setConfidence] = useState<number>(() => Math.min(1, Math.max(0.05, preset.c ?? DEFAULT_CONFIDENCE)));
  const [customOpen, setCustomOpen] = useState(false);
  const [stake, setStake] = useState(() => (preset.s && preset.s > 0 ? preset.s : 100));
  const [hover, setHover] = useState<number | null>(null);
  // The picked outlook; null once the user fine-tunes, drags or draws their own view.
  const [outlook, setOutlook] = useState<Outlook | null>(null);
  // Two humps either side of the center (the "Big move" outlook) instead of one bell.
  const [split, setSplit] = useState(false);
  // Whether the user has expressed any view yet (a preset link counts).
  const [started, setStarted] = useState(() => preset.x !== undefined || preset.w !== undefined);
  const [reviewOpen, setReviewOpen] = useState(false);
  const custom = () => {
    // Freeze a relative outlook at the prices it shows right now before the user reshapes it.
    setCenter(center);
    setOutlook(null);
    setStarted(true);
    // Reshaping the curve by hand leaves Range for a free-form view (protection has no curve to touch).
    setStrategy((s) => (s === "range" ? "outlook" : s));
  };

  const chainCfg = useChainConfig();
  const maxStake = chainCfg.data?.maxStake ?? 500;
  const dragStart = useRef<{ center: number; scale: number; moved: boolean } | null>(null);
  // True while the curve is being dragged: desk quotes and the "what would make it tradable" search
  // wait for the release, so the drag only pays for the one in-browser solve per frame.
  const [dragging, setDragging] = useState(false);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  // "Protect what I hold": price ladders only. The floor defaults to about half a market spread below
  // the expected price, a typical "protect against a meaningful drop" choice.
  const canProtect = ladder.kind === "threshold";
  const floors = useMemo(() => floorChoices(ladder), [ladder]);
  const name = useMemo(() => underlyingName(ladder), [ladder]);
  // What the user is doing: an everyday outlook (the default), protecting a holding, or one of the
  // "More strategies" (range, collar). Each picks how the position is built.
  const [strategy, setStrategy] = useState<"outlook" | "protect" | StrategyKey>("outlook");
  const moreItems = useMemo(() => (MORE_STRATEGIES_ENABLED ? MORE_STRATEGIES.filter((s) => s.available(ladder)) : []), [ladder]);
  const nearest = (xs: number[], target: number) => (xs.length ? xs.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a)) : 0);
  const [units, setUnits] = useState(10);
  const [floor, setFloor] = useState<number>(() => nearest(floors, mkt.mean - 0.5 * mkt.sd));
  const caps = useMemo(() => capChoices(ladder), [ladder]);
  const [cap, setCap] = useState<number>(() => nearest(caps, mkt.mean + 0.75 * mkt.sd));
  // The "holding" family: protect (floor), collar (floor + cap), covered call (cap only). They all
  // value the user's holding and are built from NO contracts by protect().
  const covering = strategy === "covered" && canProtect && caps.length > 0;
  const protecting = ((strategy === "protect" || strategy === "collar") && canProtect && floors.length > 0) || covering;
  const collaring = protecting && strategy === "collar" && caps.length > 0;
  const protectQuote = useMemo(() => {
    if (!protecting) return null;
    try {
      return covering ? protect({ ladder, units, cap }) : protect({ ladder, units, floor, cap: collaring ? cap : undefined });
    } catch {
      return null;
    }
  }, [protecting, covering, collaring, ladder, units, floor, cap]);

  // Spread: equal steps from one price to another, up (call spread) or down (put spread).
  const strikes = ladder.strikes;
  const centerIdx = useMemo(() => (strikes.length ? strikes.indexOf(nearest(strikes, mkt.mean)) : 0), [strikes, mkt.mean]); // eslint-disable-line react-hooks/exhaustive-deps
  const [spreadDir, setSpreadDir] = useState<"up" | "down">("up");
  const [spreadIdx, setSpreadIdx] = useState<[number, number]>(() => [centerIdx, Math.min(strikes.length - 1, centerIdx + 4)]);
  const setDirection = (d: "up" | "down") => {
    setSpreadDir(d);
    setSpreadIdx(d === "up" ? [centerIdx, Math.min(strikes.length - 1, centerIdx + 4)] : [Math.max(0, centerIdx - 4), centerIdx]);
  };
  const spreading = strategy === "spread" && ladder.kind === "threshold" && strikes.length >= 3;
  const spreadQuote = useMemo(() => {
    if (!spreading) return null;
    try {
      return spread({ ladder, direction: spreadDir, from: strikes[spreadIdx[0]], to: strikes[spreadIdx[1]], stakeUsd: Math.max(1, stake) });
    } catch {
      return null;
    }
  }, [spreading, ladder, spreadDir, strikes, spreadIdx, stake]);
  // The floor alone, to show what the collar's cap saves.
  const floorAloneCost = useMemo(() => {
    if (!collaring) return null;
    try {
      return protect({ ladder, units, floor }).stakeBase / 1e6;
    } catch {
      return null;
    }
  }, [collaring, ladder, units, floor]);

  // Range: "it'll land between two prices" (cut indexes into ladder.cuts; outcomes lo+1..hi are inside).
  const [rangeCuts, setRangeCuts] = useState<[number, number]>(() => {
    const n = ladder.cuts?.length ?? 0;
    if (!n) return [0, 0];
    const [a, b] = likelyRange(ladder.marketProb, 0.5);
    return [Math.max(0, a - 1), Math.min(n - 1, Math.max(a, b))];
  });
  const ranging = strategy === "range" && ordered;
  const pickStrategy = (k: StrategyKey) => {
    setStrategy(k);
    if (k === "range" || k === "spread") {
      setOutlook(null);
      setEdit(false);
      setDraft(null);
      setStarted(true);
    }
  };

  const pickOutlook = (k: Outlook) => {
    setStrategy("outlook");
    const o = OUTLOOKS.find((x) => x.key === k)!;
    // Re-read the live price at the moment of the pick, so the view starts from exactly what's shown.
    const at = spot?.price ?? base;
    if (spot) setAnchor(spot.price);
    setCenter(clamp(at + o.x * range.sd, range.lo, range.hi));
    setScale(o.w);
    setSplit(!!o.split);
    setEdit(false);
    setDraft(null);
    setOutlook(k);
    setStarted(true);
  };

  const picked = outlook && strategy === "outlook" ? OUTLOOKS.find((o) => o.key === outlook)! : null;
  const center = picked ? clamp(base + picked.x * range.sd, range.lo, range.hi) : centerState;

  // The user's (unblended) belief.
  const belief = useMemo(() => {
    if (ranging) return rangeBelief(ladder, rangeCuts[0] + 1, rangeCuts[1]);
    if (!ordered) return oddsBelief(ladder.marketProb, takes);
    if (edit && (draft || bars)) return fromBars(draft ?? bars!);
    if (split) {
      const lo = normalBelief(ladder, center - SPLIT_OFFSET * range.sd, range.sd * scale);
      const hi = normalBelief(ladder, center + SPLIT_OFFSET * range.sd, range.sd * scale);
      return lo.map((p, j) => (p + hi[j]) / 2);
    }
    return normalBelief(ladder, center, range.sd * scale);
  }, [ranging, rangeCuts, edit, draft, bars, ordered, ladder, center, range.sd, scale, split, takes]);

  // The curve on the chart follows `belief` at once; everything solved from it (the position, its
  // cards and the order panel) follows `solveBelief`, which React may let trail by a frame or two
  // under load. A drag never waits on the solver: the curve stays under the pointer and the numbers
  // catch up as fast as they can.
  const solveBelief = useDeferredValue(belief);
  // Formatting a date is costly enough to show up in a drag's frames: once per market.
  const settlesText = useMemo(() => settleLabel(ladder.expiry), [ladder.expiry]);

  // Instant in-browser preview (warm-started solver).
  const warm = useRef<number[] | undefined>(undefined);
  const viewPreview = useMemo(() => {
    // Mid-drag the preview only has to keep up with the curve: a short solve from the last answer.
    // Near the market's own view the solver converges slowly, and 20,000 iterations every frame
    // stalls the drag. Letting go re-solves in full (and asks the desk, whose quote is what signs).
    const q = compile({ ladder, belief: solveBelief, confidence, stakeUsd: Math.max(1, stake), warmStart: warm.current, maxIter: dragging ? 3_000 : 20_000 });
    warm.current = q.raw.weights;
    return q;
  }, [ladder, solveBelief, confidence, stake, dragging]);
  const preview: Omit<Quote, "raw"> & { raw?: Quote["raw"] } = protectQuote ?? spreadQuote ?? viewPreview;
  // In protect mode the amount isn't chosen: it's what the protection costs.
  // What the request asks for; the amount shown comes from the displayed quote (see payStake below).
  const previewStake = protectQuote ? protectQuote.stakeBase / 1e6 : stake;

  // Server quote: debounced 150 ms, refreshed every 15 s while idle.
  const key = useMemo(
    () =>
      JSON.stringify(
        protecting
          ? [ladder.eventTicker, "protect", units, covering ? null : floor, collaring || covering ? cap : null]
          : spreading
            ? [ladder.eventTicker, "spread", spreadDir, spreadIdx, stake]
            : [ladder.eventTicker, solveBelief, confidence, stake],
      ),
    [protecting, covering, collaring, cap, spreading, spreadDir, spreadIdx, ladder.eventTicker, units, floor, solveBelief, confidence, stake],
  );
  // The same request minus the anchor: a picked outlook re-centering on the live price is the same
  // view, so the last desk quote stays on screen (no flash back to the preview) until the new one lands.
  const sticky = useMemo(
    () =>
      !ordered
        ? JSON.stringify([ladder.eventTicker, "odds", takes, confidence, stake])
        : picked && !edit && !protecting && !spreading
          ? JSON.stringify([ladder.eventTicker, "outlook", picked.key, scale, split, confidence, stake])
          : key,
    [ordered, takes, picked, edit, protecting, spreading, ladder.eventTicker, scale, split, confidence, stake, key],
  );
  const [server, setServer] = useState<{ key: string; sticky: string; data: StoredQuote; at: number } | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // Slow tier: each refresh re-reads the live price the outlooks are relative to.
  useEffect(() => {
    if (tick > 0 && spot) setAnchor(spot.price);
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Mid-gesture (painting or dragging), skip the desk: its quote would land on a view that's
    // already moved on, and flip the card between it and the preview. The release asks once.
    if (draft || dragging || !(previewStake > 0)) return;
    const ac = new AbortController();
    const body = protecting
      ? {
          ticker: ladder.eventTicker,
          belief: ladder.marketProb,
          confidence: 0,
          stakeUsd: previewStake,
          protect: covering ? { units, cap } : { units, floor, ...(collaring ? { cap } : {}) },
        }
      : spreading
        ? {
            ticker: ladder.eventTicker,
            belief: ladder.marketProb,
            confidence: 0,
            stakeUsd: stake,
            spread: { direction: spreadDir, from: strikes[spreadIdx[0]], to: strikes[spreadIdx[1]] },
          }
        : { ticker: ladder.eventTicker, belief: solveBelief, confidence, stakeUsd: stake };
    const t = setTimeout(() => {
      desk
        .quote(body, ac.signal)
        .then((data) => {
          setServer({ key, sticky, data, at: Date.now() });
          setQuoteErr(null);
        })
        .catch((e: Error) => e.name !== "AbortError" && setQuoteErr(e.message));
    }, 150);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [key, draft, dragging, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Slow tier: the desk re-solves the position every CHART_MS (sooner if live prices move a lot, below).
  useEffect(() => {
    const i = setInterval(() => setTick((x) => x + 1), CHART_MS);
    return () => clearInterval(i);
  }, []);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  // The last desk quote for these inputs stays on screen until the next one lands, so a routine
  // refresh never flashes back to the in-browser preview.
  const serverFresh = server && (server.key === key || server.sticky === sticky) && now - server.at < 3 * CHART_MS ? server : null;
  // The latest quote: what the order ticket re-prices live and what the review signs.
  const shown: ShownQuote = serverFresh ? serverFresh.data.quote : preview;
  // What the charts and summaries draw. A refresh whose payouts barely moved keeps the previous
  // picture, so the expensive parts of the screen only change when the position really changes.
  const steady = useRef<{ key: string; q: ShownQuote; server: boolean; at: number | null } | null>(null);
  const prevSteady = steady.current;
  const display: ShownQuote = (() => {
    if (!prevSteady || prevSteady.key !== sticky || !prevSteady.server || !serverFresh || prevSteady.q === shown) return shown;
    const tol = Math.max(0.25, stake * 0.005);
    const a = prevSteady.q.payoutByBucket;
    const b = shown.payoutByBucket;
    return a.length === b.length && a.every((p, j) => Math.abs(p - b[j]) < tol) ? prevSteady.q : shown;
  })();
  const displayAt = display === prevSteady?.q && display !== shown ? prevSteady.at : serverFresh?.at ?? null;
  useEffect(() => {
    steady.current = { key: sticky, q: display, server: !!serverFresh, at: displayAt };
  });
  // Fast tier: the same contracts at the live asks, like a brokerage ticket's estimated cost.
  const fill = useMemo(() => liveFill(shown, live), [shown, live]);
  // Prices moved a lot since the last solve (or a contract lost its quote): re-solve now, at most every 8 s.
  const lastEarly = useRef(0);
  useEffect(() => {
    if (!fill) return;
    const moved = Math.abs(fill.delta) >= Math.max(0.5, stake * 0.01) || fill.missing > 0;
    if (moved && Date.now() - lastEarly.current > 8_000) {
      lastEarly.current = Date.now();
      setTick((x) => x + 1);
    }
  }, [fill, stake]);
  const closesIn = new Date(ladder.expiry).getTime() - now;
  const closed = !offline && closesIn < CLOSE_BUFFER_MS;
  const noEdge = shown.advice === "no_edge";
  // Every number on screen comes from the displayed quote (the desk's when fresh, else the preview),
  // so live price moves between the two can never leave the card, panel and review disagreeing.
  const payStake = protecting ? shown.stakeBase / 1e6 : stake;
  // With a cap: what comes back if the price ends below it (and above the floor), from the shown quote.
  const shownBack = useMemo(() => {
    const p = protectQuote?.protection;
    if (!p || p.cap === null) return null;
    const j = p.holdingChange.findIndex((h) => {
      const m = h / p.units + p.reference;
      return m > (p.floor ?? -Infinity) && m < p.cap!;
    });
    return j >= 0 ? shown.payoutByBucket[j] : null;
  }, [protectQuote, shown]);
  // When the view is too weak to trade, the lowest confidence level that would make it tradable.
  // Up to two extra cold solves, so it waits until a drag is released.
  const raiseTo = useMemo(() => {
    if (dragging || protecting || spreading || !noEdge || !started) return null;
    for (const c of CONFIDENCE_LEVELS) {
      if (c <= confidence) continue;
      if (compile({ ladder, belief: solveBelief, confidence: c, stakeUsd: Math.max(1, stake), maxIter: 8_000 }).advice === "trade") return c;
    }
    return null;
  }, [dragging, protecting, spreading, noEdge, started, ladder, solveBelief, confidence, stake]);
  const raiseConfidence = useCallback(() => raiseTo !== null && setConfidence(raiseTo), [raiseTo]);
  // What the result panel says when there's no trade to show (it keeps its shape either way).
  const summaryStatus = useMemo<SummaryStatus | null>(() => {
    if (protecting || spreading) return null;
    if (!started)
      return ordered
        ? { title: "Pick an outlook to see what you'd make.", detail: "Or drag the violet curve. You'll see when you make money, the most you could win, and the least you'd get back." }
        : { title: "Give the outcomes your own odds to see what you'd make.", detail: "You'll see what you make if each one wins, the most you could win, and the least you'd get back." };
    if (!noEdge) return null;
    return {
      title: "Your view is too close to the market's to trade.",
      detail:
        raiseTo !== null ? (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>It becomes a trade if you trust your view {pct(raiseTo)}.</span>
            <button type="button" className="ease rounded-full font-bold text-signal-violet underline decoration-2 underline-offset-4 hover:text-inkstone" onClick={raiseConfidence}>
              Use {pct(raiseTo)} confidence
            </button>
          </span>
        ) : dragging ? (
          "Keep going: pull your curve further from the market's."
        ) : ordered ? (
          "Drag your curve further from the market's, or try a stronger outlook."
        ) : (
          "Move your odds further from the market's."
        ),
    };
  }, [protecting, spreading, started, ordered, noEdge, raiseTo, raiseConfidence, dragging]);

  // What the single best contract for the same view would pay in each outcome.
  const compare = useMemo(() => {
    const c = display.comparison;
    if (!c) return null;
    const i = ladder.instruments.findIndex((x) => x.symbol === c.symbol);
    if (i < 0) return null;
    return ladder.marketProb.map((_, j) => (paysIn(ladder, i, c.side, j) ? c.payoutIfWin : 0));
  }, [display.comparison, ladder]);

  // Chart decorations.
  const untraded = ladder.kind === "threshold" ? ladder.instruments.map((_, i) => i).filter((i) => !isTradable(ladder, i)).map((i) => ({ cut: i, reason: ladder.crossed[i] ? "quotes crossed" : "no two-sided quote" })) : [];
  const likely = useMemo(() => {
    if (!ordered || !ladder.cuts) return null;
    const [a, b] = likelyRange(ladder.marketProb, 0.5);
    const lo = a === 0 ? null : formatValue(ladder.cuts[a - 1], ladder.unit);
    const hi = b === ladder.cuts.length ? null : formatValue(ladder.cuts[b], ladder.unit);
    const range = lo && hi ? `${lo} – ${hi}` : lo ? `${lo} or above` : hi ? `below ${hi}` : "anywhere";
    return { from: a, to: b, label: `Market's likely range: ${range}` };
  }, [ladder, ordered]);

  const round = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v) : Math.round(v * 100) / 100);
  // Dollar amounts with cents always show two decimals ($65.50, not $65.5).
  const fmt = (v: number) => {
    const r = round(v);
    if (ladder.unit.prefix === "$" && Math.abs(r) < 1000 && !Number.isInteger(r))
      return `$${r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${ladder.unit.suffix}`;
    return formatValue(r, ladder.unit);
  };
  // The market's 2-in-3 range: the shortest run of outcomes holding at least 2/3 of its odds. Shown
  // beside your own "2 in 3 chance" range so the two captions measure the same thing.
  const marketTwoInThree = useMemo(() => {
    if (!ordered || !ladder.cuts) return null;
    const [a, b] = likelyRange(ladder.marketProb, 2 / 3);
    const lo = a === 0 ? null : fmt(ladder.cuts[a - 1]);
    const hi = b === ladder.cuts.length ? null : fmt(ladder.cuts[b]);
    return lo && hi ? `${lo}–${hi}` : lo ? `${lo} or above` : hi ? `below ${hi}` : null;
  }, [ladder, ordered]); // eslint-disable-line react-hooks/exhaustive-deps
  const fmtCenter = fmt(center);
  const width = range.sd * scale;
  const widthLabel = fmt(width);
  // The view in plain terms. One bell: a 2-in-3 likely range (center ± one standard deviation).
  // Big move: two humps either side of the midpoint, each with its own ± width.
  const humps = split ? ([center - SPLIT_OFFSET * range.sd, center + SPLIT_OFFSET * range.sd] as const) : null;
  const likelyText = humps ? `near ${fmt(humps[0])} or ${fmt(humps[1])}` : `likely ${fmt(center - width)}–${fmt(center + width)}`;
  const viewName = outlook ? OUTLOOKS.find((o) => o.key === outlook)!.title : started ? "Your own view" : "Market's view";
  const unitsText = units.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const rangeLo = ladder.cuts ? ladder.cuts[rangeCuts[0]] : 0;
  const rangeHi = ladder.cuts ? ladder.cuts[rangeCuts[1]] : 0;
  const spreadFrom = strikes[spreadIdx[0]] ?? 0;
  const spreadTo = strikes[spreadIdx[1]] ?? 0;
  const spreadText =
    spreadQuote && spreadQuote.spread.steps
      ? spreadDir === "up"
        ? `${usd(spreadQuote.spread.perStep)} for each full $1 it ends above ${fmt(spreadFrom)}, up to ${usd(spreadQuote.spread.perStep * spreadQuote.spread.steps)} at ${fmt(spreadTo)} or higher`
        : `${usd(spreadQuote.spread.perStep)} for each full $1 it ends below ${fmt(spreadTo)}, up to ${usd(spreadQuote.spread.perStep * spreadQuote.spread.steps)} at ${fmt(spreadFrom)} or lower`
      : "";
  const viewLabel = covering
    ? `Covered call ${unitsText} ${name} · cap ${fmt(cap)}`
    : collaring
    ? `Collar ${unitsText} ${name} · floor ${fmt(floor)} · cap ${fmt(cap)}`
    : protecting
    ? `Protect ${unitsText} ${name} below ${fmt(floor)}`
    : spreading
    ? `Spread ${spreadDir === "up" ? "up" : "down"} · ${fmt(spreadDir === "up" ? spreadFrom : spreadTo)} → ${fmt(spreadDir === "up" ? spreadTo : spreadFrom)}`
    : ranging
    ? `Range · between ${fmt(rangeLo)} and ${fmt(rangeHi)}`
    : ordered
      ? humps
        ? `${viewName} · most likely near ${fmt(humps[0])} or ${fmt(humps[1])}`
        : `${viewName} · 2 in 3 chance between ${fmt(center - width)} and ${fmt(center + width)}`
      : "Your own odds";
  const tooBig = protecting && payStake > maxStake;
  const tradable =
    !closed &&
    (protecting
      ? !!protectQuote && protectQuote.legs.length > 0 && !tooBig
      : spreading
        ? !!spreadQuote && spreadQuote.legs.length > 0
        : started && !noEdge);
  const wins = display.payoutByBucket.map((p) => isWin(p, payStake));
  const chanceMkt = ladder.marketProb.reduce((s, p, j) => s + (wins[j] ? p : 0), 0);
  // Live ticket numbers: the latest quote's contracts at the current asks (falls back to the quote).
  const getBack = fill ? { min: fill.minPayout, max: fill.maxPayout } : { min: shown.minPayout, max: shown.maxPayout };
  // On the chart, big prices read in whole dollars ($64,674); the header keeps the cents.
  // (Memoized, like the other ProfitCard inputs, so the card can skip renders that don't concern it.)
  const spotPrice = spot?.price ?? null;
  const nowMark = useMemo(
    () =>
      spotPrice !== null && ladder.kind === "threshold"
        ? { value: spotPrice, label: spotPrice >= 1000 ? `$${Math.round(spotPrice).toLocaleString("en-US")}` : spotText(spotPrice) }
        : null,
    [spotPrice, ladder.kind],
  );
  // "Where your money goes": where the contracts pay, and how likely that is by the market's odds.
  const detailsMoney = useMemo(() => {
    if (protecting) return null;
    const w = display.payoutByBucket.map((p) => isWin(p, payStake));
    const z = runs(w, (x) => x);
    return { winsWhere: z.length ? whenPhrase(ladder, z) : null, chance: ladder.marketProb.reduce((acc, p, j) => acc + (w[j] ? p : 0), 0) };
  }, [protecting, display, payStake, ladder]);
  const crossedStrikes = serverFresh?.data.crossedStrikes;
  const crossed = useMemo(() => crossedStrikes ?? ladder.instruments.filter((_, i) => ladder.crossed[i]).map((i) => i.label), [crossedStrikes, ladder]);
  const asOf = displayAt ? new Date(displayAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }) : null;
  const openReview = () => {
    setTick((x) => x + 1); // sign against a quote taken now, not one up to 30 s old
    setReviewOpen(true);
  };

  // Panel numbers walk a newcomer through the workspace in order. Protection has no curve to shape,
  // and named-outcome markets start from the odds list instead of an outlook.
  const showView = ordered ? !protecting && !spreading : true;
  const stepView = ordered ? 2 : 1;
  const stepResult = ordered ? (showView ? 3 : 2) : 2;
  const stepOrder = stepResult + 1;

  const hasPosition = started || protecting || spreading;
  const shaping = ordered && !protecting && !ranging && !spreading;
  // Fine-tune: the same view as the curve, as two compact sliders right under the chart.
  const tune = shaping ? (
    <div className="mt-2 grid gap-x-6 gap-y-3 border-t border-mist pt-2.5 sm:grid-cols-2">
      <Slider
        compact
        label={humps ? "Midpoint" : "Where"}
        value={center}
        min={range.lo}
        max={range.hi}
        step={range.sd / 100}
        onChange={(v) => {
          custom();
          setCenter(v);
          setEdit(false);
        }}
        display={fmtCenter}
        valueText={humps ? `Midpoint ${fmtCenter}, humps near ${fmt(humps[0])} and ${fmt(humps[1])}` : `Center ${fmtCenter}`}
        caption={humps ? `humps at ${fmt(humps[0])} and ${fmt(humps[1])}` : marketTwoInThree ? `market's 2 in 3: ${marketTwoInThree}` : "the middle of your view"}
      />
      <Slider
        compact
        label="How sure"
        value={2 - scale}
        min={0.4}
        max={1.6}
        step={0.01}
        onChange={(v) => {
          custom();
          setScale(Math.round((2 - v) * 100) / 100);
          setEdit(false);
        }}
        display={humps ? `each ±${widthLabel}` : `±${widthLabel}`}
        valueText={
          humps
            ? `Each hump plus or minus ${widthLabel}`
            : `2 in 3 chance between ${fmt(center - width)} and ${fmt(center + width)}, ${scale.toFixed(2)} times the market's spread`
        }
        caption={humps ? "narrower: a sharper move" : `2 in 3 chance: ${fmt(center - width)}–${fmt(center + width)}`}
      />
    </div>
  ) : null;
  const drawToggle = shaping ? (
    <button
      type="button"
      aria-pressed={edit}
      onClick={() => {
        custom();
        const on = !edit;
        setEdit(on);
        if (on) setBars(belief);
      }}
      className={`ease inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-bold ${
        edit ? "border-signal-violet bg-signal-violet text-white" : "border-mist bg-porcelain text-inkstone hover:border-ash"
      }`}
    >
      <Pencil size={13} strokeWidth={2.25} aria-hidden="true" />
      Draw by hand
    </button>
  ) : null;

  // The details, each in its own compact panel, always in full: nothing hides behind tabs or scrolling.
  const fade = `transition-opacity duration-300 ${tradable ? "" : "opacity-45"}`;
  const moneyPanel =
    !protecting && detailsMoney ? (
      <Panel id="money" title={`Where your ${usd(stake, 0)} goes`} className="max-lg:order-6" bodyClassName={`gap-2 ${fade}`}>
        <MoneySplit quote={display} stake={stake} winsWhere={detailsMoney.winsWhere} chance={detailsMoney.chance} bare compact />
        <EvNote quote={display} stake={stake} compact />
      </Panel>
    ) : null;
  const comparing = !protecting && !summaryStatus && hasPosition && !!display.comparison;
  const comparePanel = !protecting ? (
    <Panel id="compare" title="vs betting on one contract" className="max-lg:order-7" bodyClassName={comparing ? fade : ""}>
      {comparing ? (
        <CompareMini quote={display} stake={stake} />
      ) : (
        // Only once there's a real position: before that it would weigh a bet against nothing.
        <p className="text-[13.5px] text-slate">Once you have a trade, this shows how it stacks up against putting everything on the single best contract.</p>
      )}
    </Panel>
  ) : null;
  const contractsPanel = (
    <Panel
      id="contracts"
      title={display.legs.length ? `The ${display.legs.length} ${display.legs.length === 1 ? "contract" : "contracts"} you'd buy` : "The contracts you'd buy"}
      right={<span className="text-smoke">at Gemini&apos;s asks</span>}
      className="max-lg:order-8"
      bodyClassName={fade}
    >
      <LegsTable quote={display} paper={true} crossed={crossed} compact />
    </Panel>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-2 px-4 pb-28 pt-2 md:px-6 lg:min-h-[calc(100dvh-73px)] lg:pb-3">
      {/* Phone order bar: always one tap from the next step, like a brokerage app's trade button. */}
      <div className="fixed inset-x-3 bottom-3 z-20 flex items-center justify-between gap-3 rounded-full bg-inkstone py-2 pl-5 pr-2 text-porcelain shadow-xl lg:hidden">
        {tradable ? (
          <>
            <span className="tnum min-w-0 text-[14px] leading-tight">
              <span className="block font-bold">
                {covering ? `Covered call ${usd(payStake)}` : protecting ? `Protection ${usd(payStake + (fill?.delta ?? 0))}` : `You pay ${usd(stake, 0)}`}
              </span>
              <span className="block text-ash">
                {covering && shownBack !== null
                  ? `earns ${usd(shownBack - payStake)} below ${fmt(cap)}`
                  : protecting
                    ? `pays up to ${usd(shown.maxPayout, 0)} below ${fmt(floor)}`
                    : `get back ${usd(getBack.min, 0)}–${usd(getBack.max, 0)}`}
              </span>
            </span>
            <button type="button" className="btn btn-primary shrink-0 !px-5 !py-2.5" onClick={openReview}>
              {protecting ? "Review" : "Review hedge"}
            </button>
          </>
        ) : (
          <>
            <span className="min-w-0 text-[14px] leading-tight">
              {closed
                ? "Closed for new positions"
                : protecting
                  ? tooBig
                    ? "Over the per-position limit"
                    : "Adjust your protection"
                  : !started
                    ? ordered
                      ? "Start with your outlook"
                      : "Start with your odds"
                    : "Too close to the market to trade"}
            </span>
            <a href={!started && !protecting ? (ordered ? "#outlook" : "#view") : "#controls"} className="btn btn-quiet shrink-0 !px-5 !py-2.5">
              {!started && !protecting ? "Pick one ↑" : "Adjust ↓"}
            </a>
          </>
        )}
      </div>

      {banner}

      {/* Market bar: what's being traded, the live price, and when it settles. */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-1">
        <div className="min-w-0">
          <p className="text-[13px] text-smoke">
            {ladder.category} · Settles {settlesText} · {untilLabel(ladder.expiry, now)}
          </p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <ViewTransition name={`market-title-${ladder.eventTicker}`} share="morph" default="none">
              <h1 className="text-[22px] font-bold leading-tight text-inkstone md:text-[24px]">{ladder.title}</h1>
            </ViewTransition>
            {spot && <LivePrice compact spot={spot} name={name || ladder.eventTicker.replace(/\d.*$/, "")} settles={settlesText} />}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="tag tnum !py-0.5 !text-[13px]">{ladder.kind === "threshold" ? `${ladder.strikes.length} strikes` : `${ladder.marketProb.length} outcomes`}</span>
          <span className="tag tnum !py-0.5 !text-[13px]">{ladder.quoted.filter(Boolean).length} quoted</span>
          {ladder.crossed.some(Boolean) && <span className="tag !py-0.5 !text-[13px]">Crossed quotes not traded</span>}
        </div>
      </header>

      {/* The workspace. Every panel is as tall as its content: nothing scrolls inside a panel or
          hides behind a tab. Wide screens: the outlook across the top; below it two uneven columns
          (your view and where the money goes; what you make, its numbers and the single-contract
          comparison) with the contracts underneath; the order ticket down the right, pinned while
          you scroll. Phones: the panels stack in step order; the bottom bar keeps Review one tap away. */}
      {/* On screens with height to spare, the workspace fills the window and the two main panels take the extra. */}
      <div className="grid flex-1 grid-cols-1 items-start gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(320px,348px)]">
        <div className="flex min-w-0 flex-col gap-2 max-lg:contents lg:self-stretch">
          {ordered && (
            <div id="outlook" className="min-w-0 scroll-mt-24 max-lg:order-1">
              <OutlookPicker
                value={protecting ? null : outlook}
                onPick={pickOutlook}
                center={spot ? spotText(spot.price) : formatValue(round(mkt.mean), ladder.unit)}
                expected={fmt(mkt.mean)}
                live={!!spot}
                settles={settlesText}
                step={1}
                prompt={!hasPosition}
                protect={canProtect && floors.length ? { on: strategy === "protect", name, onClick: () => setStrategy(strategy === "protect" ? "outlook" : "protect") } : undefined}
                more={{ items: moreItems, active: strategy === "outlook" || strategy === "protect" ? null : strategy, onPick: pickStrategy }}
              />
            </div>
          )}

          {/* 2 → 3: the two panels you work in, lifted off the page, with an arrow for "this drives that". */}
          <div className={`relative grid gap-2 max-lg:contents lg:flex-1 ${showView ? "lg:grid-cols-2" : ""}`}>
            {showView && (ordered ? (
                <Panel
                  id="view"
                  step={stepView}
                  tone="focus"
                  title="Shape your view"
                  hint={edit ? "Drag up or down on each bar to set its chance." : undefined}
                  right={drawToggle}
                  className="max-lg:order-2"
                >
                  <Fill fallback={176} className="h-[220px] lg:h-auto lg:min-h-[150px] lg:flex-1">
                    {(h) => (
                      <ProbabilityChart
                        height={h}
                        bucketLabels={ladder.bucketLabels}
                        cutLabels={ladder.cutLabels}
                        cuts={ladder.cuts}
                        market={ladder.marketProb}
                        you={belief}
                        drag={
                          !edit
                            ? {
                                center,
                                onStart: () => {
                                  dragStart.current = { center, scale, moved: false };
                                  setDragging(true);
                                },
                                // Sideways moves the center with the pointer; up and down raise or lower the
                                // peak with it (a taller peak is a narrower, surer view).
                                onMove: (dv, peakRatio) => {
                                  const st = dragStart.current;
                                  if (!st) return;
                                  if (!st.moved) {
                                    st.moved = true;
                                    custom();
                                  }
                                  setCenter(clamp(st.center + dv, range.lo, range.hi));
                                  setScale(Math.round(clamp(st.scale / peakRatio, 0.4, 1.6) * 100) / 100);
                                },
                                onEnd: () => {
                                  dragStart.current = null;
                                  setDragging(false);
                                },
                                readout: humps ? `Near ${fmt(humps[0])} or ${fmt(humps[1])}` : `2 in 3: ${fmt(center - width)} – ${fmt(center + width)}`,
                              }
                            : null
                        }
                        untraded={untraded}
                        hover={hover}
                        onHover={setHover}
                        editable={edit}
                        onDraft={setDraft}
                        onCommit={(v) => {
                          custom();
                          setBars(fromBars(v));
                          setDraft(null);
                        }}
                        tooltip={(j) => {
                          // One line: the outcome, both chances (and how far yours is from the market's), what it pays.
                          const diff = belief[j] - ladder.marketProb[j];
                          const pays = display.payoutByBucket[j];
                          return (
                            <span
                              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap text-slate sm:gap-x-2.5"
                              title="Your chance vs the market's for this outcome, in percentage points, and what your position pays if it lands here"
                            >
                              <b className="text-inkstone">{ladder.bucketLabels[j]}</b>
                              <span className="inline-flex items-center gap-1">
                                <span className="h-2 w-2 rounded-full bg-ash" />
                                <span className="max-sm:hidden">Market</span> <b className="tnum text-inkstone">{pct(ladder.marketProb[j], 1)}</b>
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <span className="h-2 w-2 rounded-full bg-signal-violet" />
                                <span className="max-sm:hidden">You</span> <b className="tnum text-signal-violet">{pct(belief[j], 1)}</b>
                                {Math.abs(diff) >= 0.0005 && (
                                  <span className={`tnum rounded-full px-1.5 text-[11px] font-bold ${diff > 0 ? "bg-signal-violet/10 text-signal-violet" : "bg-mist text-slate"}`}>
                                    {diff > 0 ? "+" : "−"}
                                    {(Math.abs(diff) * 100).toFixed(1)}
                                    <span className="font-medium max-sm:hidden"> pts</span>
                                  </span>
                                )}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                Pays <b className={`tnum ${isWin(pays, stake) ? "text-gain" : "text-inkstone"}`}>{usd(pays)}</b>
                              </span>
                            </span>
                          );
                        }}
                      />
                    )}
                  </Fill>
                  {tune}
                </Panel>
              ) : (
                <Panel
                  id="view"
                  step={stepView}
                  tone="focus"
                  title="Your odds"
                  className="max-lg:order-1"
                >
                  <CandidateEditor
                    bare
                    labels={ladder.bucketLabels}
                    market={ladder.marketProb}
                    weights={takes}
                    belief={belief}
                    payouts={display.payoutByBucket}
                    stake={stake}
                    onChange={(w) => {
                      custom();
                      setOddsW(w);
                    }}
                    hover={hover}
                    onHover={setHover}
                  />
                </Panel>
              ))}
            <Panel
              id="result"
              step={stepResult}
              tone="focus"
              title={protecting ? "What you get" : "What you make"}
              right={
                hasPosition ? (
                  <span className="text-smoke">
                    {serverFresh ? "desk quote" : "preview"}
                    {asOf ? ` · ${asOf}` : ""}
                  </span>
                ) : undefined
              }
              className="max-lg:order-3"
            >
              {protecting && protectQuote ? (
                <ProtectCard
                  bare
                  ladder={ladder}
                  quote={display}
                  protection={protectQuote.protection}
                  name={name}
                  source={serverFresh ? "desk quote" : "preview"}
                  floorAloneCost={floorAloneCost}
                />
              ) : (
                // Stays mounted from the start, even with no view yet or one too close to the
                // market's to trade: it says so in place, so no panel ever collapses under a drag.
                <ProfitSummary
                  ladder={ladder}
                  quote={display}
                  stake={stake}
                  hasView={!spreading}
                  note={spreading && spreadText ? `This spread pays ${spreadText}.` : undefined}
                  hover={hover}
                  onHover={setHover}
                  likely={likely}
                  now={nowMark}
                  status={summaryStatus}
                />
              )}
            </Panel>
            {showView && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-signal-violet text-white shadow-md ring-4 ring-porcelain lg:flex"
              >
                <ArrowRight size={16} strokeWidth={2.5} />
              </span>
            )}
          </div>

          {!protecting && (
            <section aria-label="Key numbers" className="min-w-0 rounded-[24px] bg-cloud p-2 max-lg:order-4">
              <KeyNumbers ladder={ladder} quote={display} stake={stake} belief={spreading ? null : solveBelief} faded={!!summaryStatus} />
            </section>
          )}

          <div
            className={`grid items-stretch gap-2 max-lg:contents ${
              protecting ? "lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)_minmax(0,1.15fr)]"
            }`}
          >
            {moneyPanel}
            {comparePanel}
            {contractsPanel}
            {protecting && protectQuote && (
              <Panel id="notes" title="Good to know" className="max-lg:order-7">
                <ProtectNotes ladder={ladder} quote={display} protection={protectQuote.protection} name={name} />
              </Panel>
            )}
          </div>
        </div>

        {/* The order ticket, in full, as one column the height of the whole workspace: its top lines
            up with the outlook and its bottom with the last row of panels. Controls sit at the top,
            the summary and Review at the bottom. */}
        <aside
          id="controls"
          aria-labelledby="controls-title"
          className="flex min-w-0 scroll-mt-24 flex-col rounded-[24px] bg-cloud max-lg:order-5 lg:self-stretch"
        >
          <div className="px-4 pt-4 xl:px-5 xl:pt-5">
            <h2 id="controls-title" className="flex items-center gap-2 text-[16px] font-bold leading-tight text-inkstone">
              <StepBadge n={stepOrder} />
              {covering
                ? "Set up your covered call"
                : collaring
                  ? "Set up your collar"
                  : protecting
                    ? "Set up your protection"
                    : spreading
                      ? "Set up your spread"
                      : ranging
                        ? "Set up your range"
                        : "Set up your hedge"}
            </h2>
          </div>
          <div className="flex flex-col gap-5 px-4 py-4 xl:px-5">
          {protecting && (
            <ProtectControls
              name={name}
              units={units}
              setUnits={setUnits}
              floors={covering ? [] : floors}
              floor={floor}
              setFloor={setFloor}
              unit={ladder.unit}
              cap={collaring || covering ? { caps, value: cap, set: setCap, income: covering } : undefined}
            />
          )}
          {ranging && ladder.cuts && (
            <RangeControls cuts={ladder.cuts} labels={ladder.cutLabels} value={rangeCuts} onChange={setRangeCuts} />
          )}
          {spreading && (
            <SpreadControls
              strikes={strikes}
              unit={ladder.unit}
              direction={spreadDir}
              setDirection={setDirection}
              value={spreadIdx}
              onChange={setSpreadIdx}
              summary={spreadText}
            />
          )}
          {!protecting && (
            <>
              <div className={ranging || spreading ? "border-t border-mist pt-5" : ""}>
                <AmountPicker stake={stake} setStake={setStake} maxStake={maxStake} absorb={shown.maxAbsorbableStakeUsd} />
              </div>
              {/* A spread is a fixed shape, not a view blended with the market's, so it has no confidence. */}
              {!spreading && (
                <>
                  <ConfidencePicker value={confidence} onChange={setConfidence} onOther={() => setCustomOpen(true)} />
                  {/* Mounted only while open: it runs its own solve on every change of view. */}
                  {customOpen && (
                    <ConfidenceDialog
                      open
                      onOpenChange={setCustomOpen}
                      ladder={ladder}
                      belief={belief}
                      stake={stake}
                      value={confidence}
                      onApply={setConfidence}
                    />
                  )}
                </>
              )}
            </>
          )}
          </div>
          <div className="mt-auto flex flex-col gap-3 border-t border-mist px-4 pb-4 pt-4 xl:px-5">
            {protecting && protectQuote ? (
              <>
                {covering && shownBack !== null ? (
                  <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[14px]">
                    <dt className="text-slate">You put in</dt>
                    <dd className="tnum text-right font-bold text-inkstone">{usd(payStake)}</dd>
                    <dt className="text-slate">Back if it stays below {fmt(cap)}</dt>
                    <dd className="tnum text-right text-inkstone">{usd(shownBack)}</dd>
                    <dt className="text-slate">Income then</dt>
                    <dd className="tnum text-right font-bold text-gain">+{usd(shownBack - payStake)}</dd>
                    <dt className="text-slate">Gemini fees (included)</dt>
                    <dd className="tnum text-right text-inkstone">{usd(shown.feesUsd ?? 0)}</dd>
                  </dl>
                ) : collaring && shownBack !== null ? (
                  <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[14px]">
                    <dt className="text-slate">You put in</dt>
                    <dd className="tnum text-right font-bold text-inkstone">{usd(payStake)}</dd>
                    <dt className="text-slate">
                      Back if it ends {fmt(floor)}–{fmt(cap)}
                    </dt>
                    <dd className="tnum text-right text-inkstone">{usd(shownBack)}</dd>
                    <dt className="text-slate">Net cost then</dt>
                    <dd className="tnum text-right font-bold text-inkstone">{usd(payStake - shownBack)}</dd>
                    {floorAloneCost !== null && (
                      <>
                        <dt className="text-slate">Floor alone would cost</dt>
                        <dd className="tnum text-right text-inkstone">{usd(floorAloneCost)}</dd>
                      </>
                    )}
                    <dt className="text-slate">Gemini fees (included)</dt>
                    <dd className="tnum text-right text-inkstone">{usd(shown.feesUsd ?? 0)}</dd>
                  </dl>
                ) : (
                  <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[14px]">
                    <dt className="flex items-center gap-2 text-slate">Protection costs {fill && <LiveDot label="" />}</dt>
                    <dd className="text-right font-bold text-inkstone">
                      <TickNumber value={fill ? payStake + fill.delta : payStake} text={usd(fill ? payStake + fill.delta : payStake)} />
                    </dd>
                    <dt className="text-slate">Gemini fees (included)</dt>
                    <dd className="tnum text-right text-inkstone">{usd(shown.feesUsd ?? 0)}</dd>
                    <dt className="text-slate">Pays out if below</dt>
                    <dd className="tnum text-right font-bold text-inkstone">{fmt(floor)}</dd>
                    <dt className="text-slate">Pays up to</dt>
                    <dd className="tnum text-right font-bold text-inkstone">{usd(shown.maxPayout)}</dd>
                  </dl>
                )}
                {tooBig && (
                  <p className="rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-inkstone">
                    That would cost {usd(payStake)}, over the {usd(maxStake, 0)} per-position limit on {networkName}. Protect less {name}, or pick a lower floor.
                  </p>
                )}
              </>
            ) : tradable ? (
              <>
                <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[14px]">
                  {/* The four numbers a newcomer needs; contract costs and fees are one tab away in Details. */}
                  <dt className="text-slate">You pay</dt>
                  <dd className="tnum text-right font-bold text-inkstone">{usd(stake)}</dd>
                  <dt className="text-slate">Really at risk</dt>
                  <dd className="text-right font-bold text-inkstone">
                    <TickNumber value={stake - getBack.min} text={usd(stake - getBack.min)} />
                  </dd>
                  <dt className="text-slate">You get back</dt>
                  <dd className="text-right font-bold text-inkstone">
                    <TickNumber value={getBack.min + getBack.max} text={`${usd(getBack.min, 0)} – ${usd(getBack.max, 0)}`} />
                  </dd>
                  <dt className="text-slate">Chance of profit</dt>
                  <dd className="tnum text-right font-bold text-inkstone">{pct(chanceMkt)}</dd>
                </dl>
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-smoke">
                  {fill && <LiveDot />}
                  <span>
                    Includes {usd(shown.feesUsd)} in Gemini fees
                    {fill
                      ? Math.abs(fill.delta) >= 0.01
                        ? ` · ${fill.delta > 0 ? "▲" : "▼"} ${usd(Math.abs(fill.delta))} since the chart was drawn`
                        : " · live asks"
                      : ""}
                  </span>
                </p>
              </>
            ) : closed ? (
              <p className="rounded-2xl bg-porcelain px-4 py-3 text-[14px] text-inkstone">
                {closesIn > 0
                  ? `This market settles in ${Math.max(1, Math.round(closesIn / 60_000))} min, so it's closed for new positions. Quotes thin out in the last minutes, and there's no time left to lock a payout.`
                  : "This market has settled."}
              </p>
            ) : (
              <p className="text-[14px] text-slate">
                {spreading
                  ? "Put in a bit more: at this amount the spread is smaller than one contract per step."
                  : !started
                    ? ordered
                      ? "Pick an outlook to build your hedge."
                      : "Set your odds to build a position."
                    : "Your view is too close to the market's to trade yet."}
              </p>
            )}
            <button type="button" className="btn btn-primary btn-block" disabled={!tradable} onClick={openReview}>
              {covering ? "Review covered call" : protecting ? "Review protection" : spreading ? "Review spread" : "Review hedge"}
            </button>
            <p className="text-center text-[13px] text-smoke">You&apos;ll see a plain summary before you sign.</p>
          </div>
          <ReviewDialog
            open={reviewOpen && tradable}
            onOpenChange={setReviewOpen}
            ladder={ladder}
            quote={shown}
            stake={payStake}
            confidence={protecting || spreading ? null : confidence}
            viewLabel={viewLabel}
            headline={
              protecting && protectQuote
                ? covering
                  ? `If ${name} stays below ${fmt(cap)}, you earn ${usd((shownBack ?? 0) - payStake)}. In return you give up gains above ${fmt(cap)}, up to ${fmt(protectQuote.protection.capTop ?? cap)}.`
                  : collaring
                    ? `If ${name} ends below ${fmt(floor)}, you're paid back the drop, down to ${fmt(protectQuote.protection.coveredDownTo ?? floor)}. In return you give up gains above ${fmt(cap)}, up to ${fmt(protectQuote.protection.capTop ?? cap)}.`
                    : `If ${name} ends below ${fmt(floor)}, you're paid back the drop below it, down to ${fmt(protectQuote.protection.coveredDownTo ?? floor)}. If it stays above, the protection expires.`
                : spreading && spreadText
                  ? `This spread pays ${spreadText}.`
                  : undefined
            }
            protection={
              protecting
                ? {
                    floor: covering ? null : fmt(floor),
                    chancePays: ladder.marketProb.reduce((s, p, j) => s + (shown.payoutByBucket[j] > shown.cashUsd + 0.005 ? p : 0), 0),
                    ...((collaring || covering) && shownBack !== null && protectQuote
                      ? { cap: fmt(cap), capTop: fmt(protectQuote.protection.capTop ?? cap), backInMiddle: shownBack }
                      : {}),
                  }
                : undefined
            }
            server={serverFresh?.data ?? null}
            quoteErr={quoteErr}
            age={serverFresh ? Math.round((now - serverFresh.at) / 1000) : null}
          />
        </aside>
      </div>
    </div>
  );
}

function ConfidencePicker({ value, onChange, onOther }: { value: number; onChange: (c: number) => void; onOther: () => void }) {
  const preset = presetIndex(value);
  const custom = preset < 0;
  // Positions 0..2 are the presets, 3 is "Other".
  const active = custom ? CONFIDENCE_LEVELS.length : preset;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const segClass = (on: boolean) =>
    `tnum rounded-full py-1.5 text-[14px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-violet ${
      on ? "bg-signal-violet text-white shadow-sm" : "text-slate hover:bg-porcelain hover:text-inkstone"
    }`;
  const pick = (i: number) => {
    const j = (i + CONFIDENCE_LEVELS.length + 1) % (CONFIDENCE_LEVELS.length + 1);
    if (j < CONFIDENCE_LEVELS.length) onChange(CONFIDENCE_LEVELS[j]);
    refs.current[j]?.focus();
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <span className="font-bold text-inkstone" id="confidence-label">
          How much do you trust your view?
        </span>
        <p className="text-[13px] leading-snug text-slate">How much your view counts against the market&apos;s. Higher bets more, and loses more if you&apos;re wrong.</p>
      </div>
      <div
        role="radiogroup"
        aria-labelledby="confidence-label"
        className="grid grid-cols-4 gap-1 rounded-full bg-mist p-1"
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            pick(active + 1);
          } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            pick(active - 1);
          }
        }}
      >
        {CONFIDENCE_LEVELS.map((level, i) => {
          const on = i === active;
          return (
            <button
              key={level}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${Math.round(level * 100)} percent, ${CONFIDENCE_NAMES[i]}`}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(level)}
              className={segClass(on)}
            >
              {pct(level)}
            </button>
          );
        })}
        <button
          ref={(el) => {
            refs.current[CONFIDENCE_LEVELS.length] = el;
          }}
          type="button"
          role="radio"
          aria-checked={custom}
          aria-haspopup="dialog"
          aria-label={custom ? `Other, ${Math.round(value * 100)} percent. Change` : "Other: set your own confidence"}
          tabIndex={custom ? 0 : -1}
          onClick={onOther}
          className={segClass(custom)}
        >
          {custom ? pct(value) : "Other"}
        </button>
      </div>
      <div className="flex justify-between gap-2 text-[13px] text-smoke">
        <span>Trust the market</span>
        <span className="text-slate">{confidenceName(value)}</span>
        <span>Trust my forecast</span>
      </div>
    </div>
  );
}

/** Spread: which way, and the two prices between which each $1 move adds a step. */
function SpreadControls({
  strikes,
  unit,
  direction,
  setDirection,
  value,
  onChange,
  summary,
}: {
  strikes: number[];
  unit: Ladder["unit"];
  direction: "up" | "down";
  setDirection: (d: "up" | "down") => void;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  summary: string;
}) {
  const [lo, hi] = value;
  const label = (i: number) => formatValue(strikes[i], unit);
  const seg = (on: boolean) =>
    `ease rounded-full py-1.5 text-[14px] font-bold ${on ? "bg-signal-violet text-white shadow-sm" : "text-slate hover:bg-porcelain hover:text-inkstone"}`;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="stat-label" id="spread-dir">
          Your spread
        </span>
        <p className="mt-1 font-bold text-inkstone">Which way will it move?</p>
      </div>
      <div role="radiogroup" aria-labelledby="spread-dir" className="grid grid-cols-2 gap-1 rounded-full bg-mist p-1">
        <button type="button" role="radio" aria-checked={direction === "up"} className={seg(direction === "up")} onClick={() => setDirection("up")}>
          Up
        </button>
        <button type="button" role="radio" aria-checked={direction === "down"} className={seg(direction === "down")} onClick={() => setDirection("down")}>
          Down
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-slate">
          {direction === "up" ? "Starts paying above" : "Pays most at or below"}
          <select
            className="input tnum !py-2.5 text-[16px] font-bold"
            value={lo}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange([v, Math.max(hi, v + 1)]);
            }}
          >
            {strikes.slice(0, -1).map((_, i) => (
              <option key={i} value={i}>
                {label(i)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-slate">
          {direction === "up" ? "Pays most at or above" : "Starts paying below"}
          <select
            className="input tnum !py-2.5 text-[16px] font-bold"
            value={hi}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange([Math.min(lo, v - 1), v]);
            }}
          >
            {strikes.map((_, i) =>
              i > 0 ? (
                <option key={i} value={i}>
                  {label(i)}
                </option>
              ) : null,
            )}
          </select>
        </label>
      </div>
      {summary && <p className="text-[14px] text-slate">Pays {summary}.</p>}
    </div>
  );
}

/** Range: the two prices you think it lands between (indexes into the ladder's cut points). */
function RangeControls({
  cuts,
  labels,
  value,
  onChange,
}: {
  cuts: number[];
  labels: string[];
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const [lo, hi] = value;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="stat-label">Your range</span>
        <p className="mt-1 font-bold text-inkstone">Where do you think it lands?</p>
        <p className="text-[14px] text-slate">Contour bets that it ends between these two prices. A narrower range pays more if you&apos;re right.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-slate">
          From
          <select
            className="input tnum !py-2.5 text-[16px] font-bold"
            value={lo}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange([v, Math.max(hi, v + 1)]);
            }}
          >
            {cuts.slice(0, -1).map((_, i) => (
              <option key={i} value={i}>
                {labels[i]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-slate">
          To
          <select
            className="input tnum !py-2.5 text-[16px] font-bold"
            value={hi}
            onChange={(e) => {
              const v = Number(e.target.value);
              onChange([Math.min(lo, v - 1), v]);
            }}
          >
            {cuts.map((_, i) =>
              i > 0 ? (
                <option key={i} value={i}>
                  {labels[i]}
                </option>
              ) : null,
            )}
          </select>
        </label>
      </div>
    </div>
  );
}

const AMOUNTS = [25, 50, 100, 250];

/** Quick amounts plus a free-form field, like a brokerage order ticket. */
function AmountPicker({ stake, setStake, maxStake, absorb }: { stake: number; setStake: (n: number) => void; maxStake: number; absorb: number | null }) {
  const [text, setText] = useState(String(stake));
  const input = useRef<HTMLInputElement>(null);
  // Follow quick-amount clicks, but never overwrite what the user is typing.
  useEffect(() => {
    if (document.activeElement !== input.current) setText(String(stake));
  }, [stake]);
  const amounts = AMOUNTS.filter((a) => a <= maxStake);
  return (
    <div className="flex flex-col gap-2.5">
      <label className="font-bold text-inkstone" htmlFor="stake">
        How much do you want to put in?
      </label>
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Quick amounts">
        {amounts.map((a) => {
          const on = stake === a;
          return (
            <button
              key={a}
              type="button"
              aria-pressed={on}
              onClick={() => setStake(a)}
              className={`ease tnum rounded-full border py-1.5 text-[14px] font-bold ${
                on ? "border-signal-violet bg-signal-violet text-white" : "border-mist bg-porcelain text-inkstone hover:border-ash"
              }`}
            >
              ${a}
            </button>
          );
        })}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[18px] font-bold text-slate">$</span>
        <input
          id="stake"
          ref={input}
          className="input tnum !py-2.5 !pl-9 !pr-16 text-[18px] font-bold"
          inputMode="decimal"
          aria-describedby="stake-note"
          value={text}
          onChange={(e) => {
            const t = e.target.value.replace(/[^0-9.]/g, "");
            setText(t);
            const n = Number(t);
            if (n > 0) setStake(Math.min(maxStake, Math.round(n * 100) / 100));
          }}
          onBlur={() => setText(String(stake))}
        />
        <span className="absolute right-5 top-1/2 -translate-y-1/2 text-slate">USDC</span>
      </div>
      <p id="stake-note" className="text-[13px] text-smoke">
        Up to {usd(maxStake, 0)} per position on {networkName}.
        {absorb !== null && absorb > 0 && absorb < maxStake ? ` The market can fill about ${usd(absorb, 0)} at these prices.` : ""}
      </p>
    </div>
  );
}

