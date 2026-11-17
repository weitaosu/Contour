import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  classify,
  compile,
  forecastHash,
  fromBars,
  normalizeEvent,
  outcomeBucket,
  scoreBps,
  tryNormalize,
  type EventLike,
} from "../src";

const raw = (f: string) => JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/raw", f), "utf8")) as EventLike;

describe("classification of real Gemini events", () => {
  it("price ladder (type categorical, unsorted, strike above) is a threshold ladder", () => {
    const e = raw("sol_nov20.json");
    expect(classify(e)).toEqual({ ok: true, kind: "threshold" });
    const l = normalizeEvent(e);
    expect(l.strikes).toEqual([...l.strikes].sort((a, b) => a - b));
    expect(l.bucketLabels.length).toBe(l.strikes.length + 1);
    expect(l.bucketLabels[0]).toBe("Below $65");
  });

  it("weather ladder becomes contiguous buckets", () => {
    const e = raw("weather.json");
    const r = tryNormalize(e);
    expect(classify(e)).toEqual({ ok: true, kind: "buckets" });
    if ("ladder" in r) {
      expect(r.ladder.bucketLabels[0]).toMatch(/or below/);
      expect(r.ladder.bucketLabels.at(-1)).toMatch(/or above/);
      expect(r.ladder.cuts!.length).toBe(r.ladder.bucketLabels.length - 1);
      const q = compile({ ladder: r.ladder, belief: fromBars(r.ladder.marketProb.map((x, i) => x * (i + 1))), confidence: 0.5, stakeUsd: 50 });
      expect(q.payoutByBucket.every((x) => x > 0)).toBe(true);
    }
  });

  it("sports total (over) on one underlying is a threshold ladder", () => {
    expect(classify(raw("sports_total.json"))).toEqual({ ok: true, kind: "threshold" });
  });

  it("spreads and player props are rejected", () => {
    expect(classify(raw("sports_spread.json")).ok).toBe(false);
    expect(classify(raw("player_props.json")).ok).toBe(false);
  });

  it("non-exclusive categoricals are rejected unless allowlisted", () => {
    const e: EventLike = {
      ticker: "CABINET-26",
      title: "Who will leave?",
      category: "Politics",
      expiryDate: "2027-01-01T00:00:00Z",
      contracts: ["A", "B", "C"].map((n) => ({ label: n, instrumentSymbol: `X-${n}`, strike: null, prices: { buy: { yes: "0.3", no: "0.75" }, bestBid: "0.25", bestAsk: "0.3" } })),
    };
    expect(classify(e).ok).toBe(false);
    expect(classify(e, { categoricalAllowlist: ["CABINET-26"] })).toEqual({ ok: true, kind: "categorical" });
  });
});

describe("settlement mapping", () => {
  it("SOL Nov 16 settled at 71.89 -> bucket 4 (>= $71, < $72)", () => {
    const e = raw("sol_nov16_settled.json") as EventLike & { settlement?: { value?: string } };
    const l = normalizeEvent(e, { allowUnquoted: true });
    const o = outcomeBucket(l, e)!;
    expect(o.bucket).toBe(4);
    expect(o.consistent).toBe(true);
    expect(l.bucketLabels[o.bucket]).toBe("$71 to $72");
  });
});

describe("hashing and scoring", () => {
  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 0.1 }] })).toBe('{"a":[1,{"c":0.1,"d":2}],"b":1}');
    const pre = { ticker: "T", marketProb: [0.5, 0.5], belief: [0.25, 0.75], confidence: 0.25, quoteId: "q", capturedAt: "x" };
    const swapped = { quoteId: "q", capturedAt: "x", confidence: 0.25, belief: [0.25, 0.75], marketProb: [0.5, 0.5], ticker: "T" };
    expect(forecastHash(pre)).toBe(forecastHash(swapped));
    expect(forecastHash(pre)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("score is ln(belief/market) in basis points", () => {
    expect(scoreBps([0.2, 0.8], [0.4, 0.6], 1)).toBe(Math.round(1e4 * Math.log(0.8 / 0.6)));
  });
});
