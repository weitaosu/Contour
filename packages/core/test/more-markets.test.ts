import { describe, expect, it } from "vitest";
import { compile, formatValue, isReversed, normalizeEvent, outcomeBucket, paysIn, type ContractLike, type EventLike, type Ladder } from "../src";

// Gemini market shapes opened up beyond price ladders: ladders written "Above N" / "N+" / "or below",
// "Before <date>" ladders, single yes/no questions, game results and races whose winner may not be
// listed. Each case is modelled on a real market seen on Nov 19, 2026.

const quoted = (bid: number, ask: number) => ({ prices: { bestBid: String(bid), bestAsk: String(ask), buy: { yes: String(ask), no: String(+(1 - bid).toFixed(4)) } } });
const ev = (contracts: ContractLike[], extra: Partial<EventLike> = {}): EventLike => ({
  ticker: "T",
  title: "t",
  category: "Business",
  expiryDate: "2027-06-01T03:59:59Z",
  contracts,
  ...extra,
});
const c = (label: string, i: number, bid: number, ask: number, more: Partial<ContractLike> = {}): ContractLike => ({ label, instrumentSymbol: `S${i}`, ...quoted(bid, ask), ...more });
const settled = (side: "yes" | "no"): Partial<ContractLike> => ({ status: "settled", resolutionSide: side, prices: {} });

/** Settle the event so outcome `b` happened, rebuild the ladder the way the desk does at expiry, and read the outcome back. */
function settleAs(e: EventLike, l: Ladder, b: number) {
  const done: EventLike = {
    ...e,
    contracts: e.contracts.map((ct) => {
      const i = l.instruments.findIndex((x) => x.symbol === ct.instrumentSymbol);
      return i < 0 ? ct : { ...ct, status: "settled", resolutionSide: paysIn(l, i, "yes", b) ? "yes" : "no", prices: {} };
    }),
  };
  const rebuilt = normalizeEvent(done, { allowUnquoted: true, only: { symbols: l.instruments.map((i) => i.symbol), none: l.none ?? null } });
  expect(rebuilt.marketProb.length).toBe(l.marketProb.length);
  return outcomeBucket(rebuilt, done);
}
const roundTrips = (e: EventLike, l: Ladder) => l.bucketLabels.every((_, b) => settleAs(e, l, b)?.bucket === b && settleAs(e, l, b)?.consistent);

describe("'Before <date>' ladders (when will Stripe announce an IPO?)", () => {
  const e = ev([
    c("Before Jun 1, 2027", 0, 0.09, 0.14),
    c("Before Apr 1, 2027", 1, 0.05, 0.1),
    c("Before Feb 1, 2027", 2, 0.03, 0.06),
    c("Before Jan 1, 2027", 3, 0.02, 0.05),
    c("Before Dec 1, 2026", 4, 0.01, 0.04),
    // Already past: settled NO, so the ladder starts after it.
    c("Before Nov 1, 2026", 5, 0, 0, settled("no")),
  ]);
  const l = normalizeEvent(e);
  it("become a threshold ladder in date order, from the contracts still trading", () => {
    expect(l.kind).toBe("threshold");
    expect(isReversed(l)).toBe(true);
    expect(l.unit.date).toBe("month");
    expect(l.instruments.map((i) => i.label)).toEqual(["Before Dec 1, 2026", "Before Jan 1, 2027", "Before Feb 1, 2027", "Before Apr 1, 2027", "Before Jun 1, 2027"]);
    expect(l.bucketLabels).toEqual(["Before Dec 2026", "In Dec 2026", "In Jan 2027", "Feb 2027 – Apr 2027", "Apr 2027 – Jun 2027", "Jun 2027 or later"]);
    expect(l.marketProb.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
  it("keep Gemini's own prices, and pay YES in every outcome before the date", () => {
    expect(l.instruments[4].yesAsk).toBe(0.14);
    // YES "Before Apr 1, 2027" pays before Dec, in Dec, in Jan, and Feb–Apr; not Apr–Jun or later.
    expect(l.bucketLabels.map((_, j) => paysIn(l, 3, "yes", j))).toEqual([true, true, true, true, false, false]);
    expect(l.bucketLabels.map((_, j) => paysIn(l, 3, "no", j))).toEqual([false, false, false, false, true, true]);
  });
  it("read the market's odds the right way round (most likely: not before June)", () => {
    expect(l.marketProb.indexOf(Math.max(...l.marketProb))).toBe(5);
    expect(l.marketProb[5]).toBeCloseTo(1 - (0.09 + 0.14) / 2, 2);
  });
  it("settle every outcome back to itself", () => {
    expect(roundTrips(e, l)).toBe(true);
  });
  it("can be traded: a view that it happens sooner buys the early contracts", () => {
    const belief = [0.15, 0.1, 0.1, 0.1, 0.1, 0.45];
    const q = compile({ ladder: l, belief, confidence: 1, stakeUsd: 100 });
    expect(q.legs.length).toBeGreaterThan(0);
    expect(q.payoutByBucket[0]).toBeGreaterThan(q.payoutByBucket[5]);
  });
  it("format their dates to the ladder's precision", () => {
    expect(formatValue(Date.UTC(2027, 0, 1), { prefix: "", suffix: "", date: "month" })).toBe("Jan 2027");
    expect(formatValue(Date.UTC(2027, 0, 1), { prefix: "", suffix: "", date: "year" })).toBe("2027");
    expect(formatValue(Date.UTC(2029, 0, 21), { prefix: "", suffix: "", date: "day" })).toBe("Jan 21, 2029");
  });
  it("read 'Before 2027', 'Before December 2026?' and 'By January 20, 2029'", () => {
    const years = normalizeEvent(ev(["Before 2027", "Before 2028", "Before 2029"].map((x, i) => c(x, i, 0.1 * (i + 1), 0.1 * (i + 1) + 0.04))));
    expect(years.unit.date).toBe("year");
    expect(years.bucketLabels).toEqual(["Before 2027", "In 2027", "In 2028", "2029 or later"]);
    const mixed = normalizeEvent(ev(["Before December 2026?", "Before 2027?", "By January 20, 2029"].map((x, i) => c(x, i, 0.1 * (i + 1), 0.1 * (i + 1) + 0.04))));
    expect(mixed.strikes).toEqual([Date.UTC(2026, 11, 1), Date.UTC(2027, 0, 1), Date.UTC(2029, 0, 21)]);
  });
});

describe("'or below' ladders (how low will the S&P get this year?)", () => {
  const e = ev([
    c("6,300 or below", 0, 0.1, 0.11),
    c("6,100 or below", 1, 0.06, 0.08),
    c("5,900 or below", 2, 0.03, 0.05),
    // Levels already hit: settled YES. The remaining contracts still say where the low lands.
    c("6,500 or below", 3, 0, 0, settled("yes")),
  ]);
  const l = normalizeEvent(e);
  it("are threshold ladders whose YES pays at or below the strike", () => {
    expect(l.strikes).toEqual([5900, 6100, 6300]);
    expect(l.bucketLabels).toEqual(["5,900 or below", "5,900 to 6,100", "6,100 to 6,300", "Above 6,300"]);
    expect(l.bucketLabels.map((_, j) => paysIn(l, 1, "yes", j))).toEqual([true, true, false, false]);
  });
  it("settle every outcome back to itself", () => {
    expect(roundTrips(e, l)).toBe(true);
  });
});

describe("ladders written 'Above N', 'N+' (unemployment, Rotten Tomatoes, NFL win totals)", () => {
  it("'Above 7%' reads as at or above 7", () => {
    const l = normalizeEvent(ev(["Above 7%", "Above 5%", "Above 6%"].map((x, i) => c(x, i, [0.2, 0.6, 0.4][i], [0.24, 0.64, 0.44][i]))));
    expect(l.strikes).toEqual([5, 6, 7]);
    expect(isReversed(l)).toBe(false);
  });
  it("'8+ wins' reads as at or above 8, and a top '17 wins' as 17+", () => {
    const labels = ["8+ wins", "10+ wins", "9+ wins", "17 wins"];
    const l = normalizeEvent(ev(labels.map((x, i) => c(x, i, [0.7, 0.3, 0.5, 0.01][i], [0.74, 0.34, 0.54, 0.03][i]))));
    expect(l.strikes).toEqual([8, 9, 10, 17]);
  });
  it("but a bare number that isn't the top stays unreadable (rejected)", () => {
    expect(() => normalizeEvent(ev(["8+ wins", "10 wins", "12+ wins"].map((x, i) => c(x, i, 0.5, 0.54))))).toThrow();
  });
});

describe("single yes/no questions (will the SAVE Act become law?)", () => {
  const e = ev([c("SAVE Act becomes law?", 0, 0.01, 0.02)]);
  const l = normalizeEvent(e);
  it("become two outcomes, Yes and No, from the one contract", () => {
    expect(l.kind).toBe("categorical");
    expect(l.bucketLabels).toEqual(["Yes", "No"]);
    expect(l.none).toBe("No");
    expect([paysIn(l, 0, "yes", 0), paysIn(l, 0, "yes", 1), paysIn(l, 0, "no", 1)]).toEqual([true, false, true]);
    expect(l.marketProb[1]).toBeGreaterThan(0.97);
  });
  it("settle both ways", () => {
    expect(roundTrips(e, l)).toBe(true);
  });
});

describe("races too big for one schedule (45 MVP candidates)", () => {
  const exclusive = { description: { content: [{ value: "Resolves Yes if X wins. This event is mutually exclusive." }] } };
  // Two favourites and 43 long shots at 1–2¢.
  const cs = Array.from({ length: 45 }, (_, i) =>
    i === 0 ? c("Fav", i, 0.3, 0.33, exclusive) : i === 1 ? c("Second", i, 0.2, 0.22, exclusive) : c(`Long ${i}`, i, 0.01, i % 2 ? 0.02 : 0.03, exclusive),
  );
  const e = ev(cs, { category: "Sports" });
  const l = normalizeEvent(e);
  it("keep the 39 likeliest and fold the rest into 'Someone else', 40 outcomes in all", () => {
    expect(l.marketProb.length).toBe(40);
    expect(l.instruments.length).toBe(39);
    expect(l.bucketLabels.slice(0, 2)).toEqual(["Fav", "Second"]);
    expect(l.bucketLabels[39]).toBe("Someone else");
    expect(l.marketProb.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
  it("settle every outcome back to itself, a dropped long shot winning as 'Someone else'", () => {
    expect(roundTrips(e, l)).toBe(true);
    const dropped = e.contracts.find((ct) => !l.instruments.some((i) => i.symbol === ct.instrumentSymbol))!;
    const done: EventLike = {
      ...e,
      contracts: e.contracts.map((ct) => ({ ...ct, status: "settled", resolutionSide: ct === dropped ? "yes" : "no", prices: {} })),
    };
    const rebuilt = normalizeEvent(done, { allowUnquoted: true, only: { symbols: l.instruments.map((i) => i.symbol), none: l.none ?? null } });
    expect(outcomeBucket(rebuilt, done)?.bucket).toBe(39);
  });
});

describe("game results (Minnesota vs San Francisco)", () => {
  const e = ev([c("San Francisco", 0, 0.59, 0.6), c("Minnesota", 1, 0.39, 0.4)], { template: "sports-game", category: "Sports" });
  const l = normalizeEvent(e);
  it("are a race with an extra 'No result' outcome (postponed, cancelled, an unlisted tie)", () => {
    expect(l.bucketLabels).toEqual(["San Francisco", "Minnesota", "No result"]);
    expect(l.marketProb.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(l.marketProb[2]).toBeLessThan(0.05);
  });
  it("settle every outcome back to itself, including no result", () => {
    expect(roundTrips(e, l)).toBe(true);
  });
  it("leave a position the desk quoted without 'none' unchanged at settlement", () => {
    // A quote recorded before the extra outcome existed rebuilds with none: null.
    const old = normalizeEvent(e, { allowUnquoted: true, only: { symbols: ["S0", "S1"], none: null } });
    expect(old.bucketLabels).toEqual(["San Francisco", "Minnesota"]);
  });
});
