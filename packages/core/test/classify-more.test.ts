import { describe, expect, it } from "vitest";
import { classify, normalizeEvent, paysIn, type ContractLike, type EventLike } from "../src";

// The rules that decide which Gemini markets Contour will trade as one curve. Every accept path
// needs proof that exactly one outcome wins; every reject below is a real shape seen on Gemini.

const rules = (text: string) => ({ content: [{ value: text }] });
const quoted = (bid: number, ask: number) => ({ prices: { bestBid: String(bid), bestAsk: String(ask), buy: { yes: String(ask), no: String(+(1 - bid).toFixed(4)) } } });
const ev = (contracts: ContractLike[], extra: Partial<EventLike> = {}): EventLike => ({
  ticker: "T",
  title: "t",
  category: "Economics",
  expiryDate: "2026-12-31T21:00:00Z",
  contracts,
  ...extra,
});
const c = (label: string, i: number, more: Partial<ContractLike> = {}): ContractLike => ({ label, instrumentSymbol: `S${i}`, ...quoted(0.1, 0.12), ...more });

describe("range ladders written with commas and cents (S&P, NASDAQ year-end)", () => {
  const labels = ["3,999.99 or below", "4,000 to 4,199.99", "4,200 to 8,799.99", "8,800 to 9,000", "9,000.01 or above"];
  it("are accepted when the ranges meet edge to edge, with cuts on the round numbers", () => {
    const l = normalizeEvent(ev(labels.map((x, i) => c(x, i))));
    expect(l.kind).toBe("buckets");
    expect(l.cuts!.map((x) => Math.round(x * 1000) / 1000)).toEqual([3999.995, 4199.995, 8799.995, 9000.005]);
    expect(l.cutLabels).toEqual(["4,000", "4,200", "8,800", "9,000"]);
    expect(l.bucketLabels).toEqual(labels);
    expect(l.marketProb.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
  it("are rejected when a range is missing (a gap no outcome covers)", () => {
    const gap = ["3,999.99 or below", "4,000 to 4,199.99", "4,300 to 9,000", "9,000.01 or above"];
    expect(classify(ev(gap.map((x, i) => c(x, i)))).ok).toBe(false);
  });
  it("are rejected when two ranges overlap", () => {
    const overlap = ["3,999.99 or below", "4,000 to 4,199.99", "4,100 to 9,000", "9,000.01 or above"];
    expect(classify(ev(overlap.map((x, i) => c(x, i)))).ok).toBe(false);
  });
  it("still put integer ranges' cuts halfway (weather: 59 | 60 → 59.5)", () => {
    const l = normalizeEvent(ev(["57°F or below", "58 to 59°F", "60 to 61°F", "62°F or above"].map((x, i) => c(x, i))));
    expect(l.cuts).toEqual([57.5, 59.5, 61.5]);
  });
});

describe("'X or above' ladders with no strike field (how high will the S&P get)", () => {
  it("become threshold ladders, strikes read from the labels", () => {
    const l = normalizeEvent(ev(["8,200 or above", "8,000 or above", "8,400 or above"].map((x, i) => c(x, i))));
    expect(l.kind).toBe("threshold");
    expect(l.strikes).toEqual([8000, 8200, 8400]);
    // YES on "8,200 or above" pays exactly in the outcomes from 8,200 up.
    expect(l.bucketLabels.map((_, j) => paysIn(l, 1, "yes", j))).toEqual([false, false, true, true]);
  });
});

describe("named-outcome races", () => {
  const names = ["Ann", "Ben", "Cal", "Dee"];
  const exclusive = rules("Resolves Yes if X wins. Note: this event is mutually exclusive.");
  it("are accepted when Gemini's rules say mutually exclusive and the prices agree one listed outcome wins", () => {
    const cs = names.map((n, i) => c(n, i, { description: exclusive, ...quoted([0.38, 0.28, 0.18, 0.12][i], [0.42, 0.31, 0.21, 0.14][i]) }));
    expect(classify(ev(cs))).toEqual({ ok: true, kind: "categorical" });
  });
  it("are rejected when the rules don't say so, whatever the prices", () => {
    const cs = names.map((n, i) => c(n, i, { description: rules("Resolves Yes if X wins."), ...quoted(0.24, 0.26) }));
    expect(classify(ev(cs)).ok).toBe(false);
  });
  it("get a 'Someone else' outcome when the prices show a real chance nobody listed wins (asks total under 95%)", () => {
    // France 2027 on Nov 18: asks summed to 0.78. The unlisted winner becomes an outcome of its own,
    // priced by what the listed asks leave over, and paid when every listed contract resolves NO.
    const cs = names.map((n, i) => c(n, i, { description: exclusive, ...quoted(0.17, 0.19) }));
    const l = normalizeEvent(ev(cs));
    expect(l.kind).toBe("categorical");
    expect(l.none).toBe("Someone else");
    expect(l.bucketLabels).toEqual([...names, "Someone else"]);
    expect(l.marketProb.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(l.marketProb[4]).toBeGreaterThanOrEqual(1 - 4 * 0.19 - 1e-9);
    // No listed contract pays in it; every NO does.
    expect(names.map((_, i) => paysIn(l, i, "yes", 4))).toEqual([false, false, false, false]);
    expect(names.map((_, i) => paysIn(l, i, "no", 4))).toEqual([true, true, true, true]);
  });
  it("are rejected when the prices say several can win (bids total over 105%)", () => {
    // US GDP 2026 on Nov 18: bids summed to 2.86 despite the rules' wording.
    const cs = names.map((n, i) => c(n, i, { description: exclusive, ...quoted(0.5, 0.55) }));
    expect(classify(ev(cs)).ok).toBe(false);
  });
  it("count unquoted sides at their bounds (bid 0, ask 1), never as evidence", () => {
    const cs = names.map((n, i) => c(n, i, { description: exclusive, prices: i < 2 ? quoted(0.3, 0.33).prices : {} }));
    expect(classify(ev(cs))).toEqual({ ok: true, kind: "categorical" });
  });
  it("can have two outcomes, when the rules say they are mutually exclusive", () => {
    const cs = names.slice(0, 2).map((n, i) => c(n, i, { description: exclusive, ...quoted(0.48, 0.52) }));
    const l = normalizeEvent(ev(cs));
    expect(l.kind).toBe("categorical");
    expect(l.none).toBeUndefined();
    expect(l.bucketLabels).toEqual(["Ann", "Ben"]);
  });
  it("ignore stale bids left on long shots (crossed or one-sided quotes aren't evidence)", () => {
    // The Game Awards on Nov 19: a firm 92¢ bid on the favourite, plus 11¢ and 8¢ bids sitting above
    // 5¢ asks on two long shots. Only the firm quote counts, so the race is consistent.
    const crossed = (bid: number, ask: number) => ({ prices: { buy: { yes: String(ask), no: String(+(1 - bid).toFixed(4)) } } });
    const cs = [
      c("GTA VI", 0, { description: exclusive, ...quoted(0.92, 0.96) }),
      c("Requiem", 1, { description: exclusive, ...crossed(0.11, 0.05) }),
      c("Phantom", 2, { description: exclusive, ...crossed(0.08, 0.05) }),
      c("Tie", 3, { description: exclusive, prices: { bestAsk: "0.05", buy: { yes: "0.05" } } }),
    ];
    expect(classify(ev(cs)).ok).toBe(true);
  });
});

describe("shapes that must stay rejected", () => {
  it("'which of these will happen' lists: several can resolve yes", () => {
    const cs = ["OpenAI", "Anthropic", "Micron"].map((x, i) => c(x, i, { description: rules("Resolves Yes if the US takes a stake in X.") }));
    expect(classify(ev(cs)).ok).toBe(false);
  });
});
