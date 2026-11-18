import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  compile,
  GEMINI_MAKER_FEE_RATE,
  GEMINI_TAKER_FEE_RATE,
  tradingFeeUsd,
  protect,
  coveredCall,
  spread,
  capChoices,
  rangeBelief,
  likelyRange,
  floorChoices,
  underlyingName,
  fromMarket,
  marketMoments,
  normalBelief,
  normalizeEvent,
  tryNormalize,
  oddsBelief,
  weightForChance,
  TAKE_STEPS,
  type EventLike,
  type Ladder,
} from "../src";

describe("one-tap takes on named outcomes", () => {
  const market = [0.4, 0.3, 0.2, 0.08, 0.02];
  const odds = (p: number) => p / (1 - p);

  it("a single take multiplies that outcome's odds against the field by its ratio", () => {
    for (const step of TAKE_STEPS) {
      for (const i of [0, 4]) {
        const w = market.map((_, j) => (j === i ? step.ratio : 1));
        const b = oddsBelief(market, w);
        expect(odds(b[i]) / odds(market[i])).toBeCloseTo(step.ratio, 2);
        expect(b.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 12);
      }
    }
  });

  it("the field keeps its relative odds when one outcome moves", () => {
    const b = oddsBelief(market, [3, 1, 1, 1, 1]);
    expect(b[1] / b[2]).toBeCloseTo(market[1] / market[2], 6);
  });

  it("dragging to an exact chance lands on it, other takes kept", () => {
    const w = [1, 1.75, 1, 1, 1];
    const w2 = [...w];
    w2[3] = weightForChance(market, w, 3, 0.25);
    const b = oddsBelief(market, w2);
    expect(b[3]).toBeCloseTo(0.25, 3);
    expect(b[1] / b[2]).toBeCloseTo((market[1] * 1.75) / market[2], 6);
  });
});

describe("thin ladders (a market's last minutes)", () => {
  // Ten strikes; only four have tight quotes, the rest are one-sided or 98 cents wide (mid 0.50).
  const contract = (i: number, yes: string | undefined, no: string | undefined) => ({
    label: `$${100 + i} or above`,
    instrumentSymbol: `T-${i}`,
    strike: { type: "above", value: String(100 + i) },
    prices: { buy: { ...(yes ? { yes } : {}), ...(no ? { no } : {}) } },
  });
  const tight: Record<number, number> = { 3: 0.8, 4: 0.6, 5: 0.4, 6: 0.2 };
  const ev = (tightCount: number): EventLike => ({
    ticker: "THIN",
    title: "Thin",
    category: "Crypto",
    expiryDate: "2030-01-01T00:00:00Z",
    contracts: Array.from({ length: 10 }, (_, i) => {
      if (i in tight && Object.keys(tight).indexOf(String(i)) < tightCount)
        return contract(i, (tight[i] + 0.02).toFixed(2), (1 - tight[i] + 0.02).toFixed(2));
      return i % 2 ? contract(i, "0.99", "0.99") : contract(i, "0.99", undefined);
    }),
  });

  it("reads the odds from tight quotes only, so junk quotes can't make the curve two-humped", () => {
    const l = normalizeEvent(ev(4));
    // P(≥103) = 0.8 and P(≥106) = 0.2 from the tight quotes; the tails get the rest, nothing spurious in between.
    expect(l.marketProb[0]).toBeCloseTo(0.2, 2);
    expect(l.marketProb[10]).toBeCloseTo(0.2, 2);
    [1, 2, 3, 7, 8, 9].forEach((j) => expect(l.marketProb[j]).toBeLessThan(0.01));
  });

  it("refuses a ladder with fewer than three tight quotes", () => {
    const r = tryNormalize(ev(2));
    expect("ladder" in r).toBe(false);
  });
});

const root = resolve(__dirname, "../../..");
const fixture = JSON.parse(readFileSync(resolve(root, "fixtures/sol_calm.json"), "utf8"));
const ladder = normalizeEvent(fixture.event as EventLike);

describe("fixture: sol_calm (independent SciPy reference)", () => {
  it("normalization matches the reference market probabilities", () => {
    expect(ladder.kind).toBe("threshold");
    expect(ladder.marketProb.length).toBe(fixture.reference.marketProb.length);
    ladder.marketProb.forEach((q, j) => expect(q).toBeCloseTo(fixture.reference.marketProb[j], 9));
    const { mean, sd } = marketMoments(ladder);
    expect(mean).toBeCloseTo(fixture.reference.marketMean, 9);
    expect(sd).toBeCloseTo(fixture.reference.marketSd, 9);
  });

  it("normal belief matches scipy.stats.norm", () => {
    const b = normalBelief(ladder, fixture.inputs.beliefMean, fixture.inputs.beliefSd);
    b.forEach((x, j) => expect(Math.abs(x - fixture.inputs.belief[j])).toBeLessThan(1e-9));
  });

  it("solver matches payoutByBucket within $0.50 and ELG within 0.0005 (before post-processing)", () => {
    const t0 = performance.now();
    // The SciPy reference was computed without trading fees.
    const quote = compile({
      ladder,
      belief: fixture.inputs.belief,
      confidence: fixture.inputs.confidence,
      stakeUsd: fixture.inputs.stakeUsd,
      feeRate: 0,
    });
    const ms = performance.now() - t0;
    quote.raw.payoutByBucket.forEach((x, j) =>
      expect(Math.abs(x - fixture.reference.payoutByBucket[j])).toBeLessThan(0.5),
    );
    expect(Math.abs(quote.raw.expectedLogGrowth - fixture.reference.expectedLogGrowth)).toBeLessThan(0.0005);
    expect(quote.raw.converged).toBe(true);
    expect(ms).toBeLessThan(1000);
  });

  it("post-processed quote is internally consistent", () => {
    const quote = compile({ ladder, belief: fixture.inputs.belief, confidence: 0.5, stakeUsd: 100 });
    const legCost = quote.legs.reduce((a, l) => a + Math.round(l.usd * 1e6) + Math.round(l.fee * 1e6), 0);
    expect(legCost + Math.round(quote.cashUsd * 1e6)).toBe(quote.stakeBase);
    expect(quote.feesUsd).toBeCloseTo(quote.legs.reduce((a, l) => a + l.fee, 0), 9);
    quote.legs.forEach((l) => expect(l.fee).toBeGreaterThan(0));
    expect(quote.advice).toBe("trade");
    expect(quote.comparison).not.toBeNull();
    // Schedule recomputed from legs equals what is returned.
    const recomputed = quote.payoutByBucket.map((_, j) =>
      Math.round(quote.cashUsd * 1e6) +
      quote.legs.reduce((a, l) => {
        const yes = j >= l.instrumentIndex + 1;
        return a + ((l.side === "yes") === yes ? Math.round(l.qty * 1e6) : 0);
      }, 0),
    );
    expect(recomputed).toEqual(quote.scheduleBase);
  });
});

describe("fees: Gemini Predictions schedule (March 12, 2026)", () => {
  it("matches Gemini's published taker examples, rounded up to the cent", () => {
    // gemini.com/fees/predictions: Taker $0.40 × 100 → $1.68; Taker $0.90 × 100 → $0.63.
    expect(tradingFeeUsd(100, 0.4)).toBe(1.68);
    expect(tradingFeeUsd(100, 0.9)).toBe(0.63);
    // Maker examples at 0.0175: $0.10 × 100 → $0.16; $0.50 × 100 → $0.44.
    expect(tradingFeeUsd(100, 0.1, GEMINI_MAKER_FEE_RATE)).toBe(0.16);
    expect(tradingFeeUsd(100, 0.5, GEMINI_MAKER_FEE_RATE)).toBe(0.44);
    // Any fraction of a cent rounds up: 6.18 × 0.19 × 0.81 × 0.07 = $0.0666 → $0.07.
    expect(tradingFeeUsd(6.18, 0.19)).toBe(0.07);
    expect(tradingFeeUsd(0, 0.5)).toBe(0);
  });

  it("fees only ever make a quote worse, and are taken out of the schedule", () => {
    const belief = fixture.inputs.belief;
    const free = compile({ ladder, belief, confidence: 0.5, stakeUsd: 100, feeRate: 0 });
    const paid = compile({ ladder, belief, confidence: 0.5, stakeUsd: 100 });
    expect(free.feesUsd).toBe(0);
    expect(paid.feesUsd).toBeGreaterThan(0);
    expect(paid.feeRate).toBe(GEMINI_TAKER_FEE_RATE);
    expect(paid.evUnderMarket).toBeLessThan(free.evUnderMarket);
    expect(paid.maxPayout).toBeLessThanOrEqual(free.maxPayout + 1e-9);
  });

  it("the single-contract comparison fits contracts plus fee inside the stake", () => {
    const q = compile({ ladder, belief: fixture.inputs.belief, confidence: 0.5, stakeUsd: 10 });
    const c = q.comparison!;
    expect(c.qty * c.price + c.fee).toBeLessThanOrEqual(10 + 1e-9);
    expect(c.fee).toBe(tradingFeeUsd(c.qty, c.price));
  });
});

describe("protect what I hold (protective floor)", () => {
  const reference = marketMoments(ladder).mean;

  it("locks the loss below the floor and keeps the upside above it", () => {
    for (const [units, floor] of [
      [10, 70],
      [10, 72],
      [1, 70],
      [50, 68],
    ]) {
      const q = protect({ ladder, units, floor });
      const cost = q.stakeBase / 1e6;
      const net = q.protection.holdingChange.map((h, j) => h + q.payoutByBucket[j] - cost);
      const flat = units * (floor - reference) - cost; // loss at the floor, the most you can lose inside the ladder
      ladder.bucketLabels.forEach((_, j) => {
        const mid = q.protection.holdingChange[j] / units + reference;
        // Inside the ladder and below the floor: the loss is locked near the floor's (within half a strike step).
        if (mid < floor && mid > q.protection.coveredDownTo!) expect(Math.abs(net[j] - flat)).toBeLessThanOrEqual(units * 0.5 + 0.02);
        // Above the floor the protection pays nothing (beyond leftover cents).
        if (mid > floor + 0.5) expect(q.payoutByBucket[j]).toBeLessThan(0.01);
      });
    }
  });

  it("costs exactly contracts + fees, rounded up to the cent, and only buys NO at or below the floor", () => {
    const q = protect({ ladder, units: 10, floor: 70 });
    const legs = q.legs.reduce((a, l) => a + Math.round(l.usd * 1e6) + Math.round(l.fee * 1e6), 0);
    expect(legs + Math.round(q.cashUsd * 1e6)).toBe(q.stakeBase);
    expect(q.cashUsd).toBeGreaterThanOrEqual(0);
    expect(q.cashUsd).toBeLessThan(0.01);
    q.legs.forEach((l) => {
      expect(l.side).toBe("no");
      expect(l.strike!).toBeLessThanOrEqual(70);
      expect(l.fee).toBe(tradingFeeUsd(l.qty, l.price));
    });
    // Insurance costs money on average: by the market's odds it returns less than it costs.
    expect(q.evUnderMarket).toBeLessThan(q.stakeBase / 1e6);
  });

  it("offers floors at or below the market's expected price, and refuses non-price ladders", () => {
    const floors = floorChoices(ladder);
    expect(floors.length).toBeGreaterThan(0);
    floors.forEach((f) => expect(f).toBeLessThanOrEqual(reference));
    expect(underlyingName(ladder)).toBe("SOL");
    const buckets = { ...ladder, kind: "buckets" as const };
    expect(() => protect({ ladder: buckets, units: 1, floor: 70 })).toThrow();
  });
});

describe("more strategies: range and collar", () => {
  it("a range view profits inside the chosen range", () => {
    const [a, b] = likelyRange(ladder.marketProb, 0.5);
    const belief = rangeBelief(ladder, a + 1, b - 1);
    const inside = belief.slice(a + 1, b).reduce((s, x) => s + x, 0);
    expect(inside).toBeGreaterThan(0.7);
    const q = compile({ ladder, belief, confidence: 0.5, stakeUsd: 100 });
    expect(q.advice).toBe("trade");
    // Every outcome inside the range makes money; the far tails don't.
    for (let j = a + 1; j < b; j++) expect(q.payoutByBucket[j]).toBeGreaterThan(100);
    expect(q.payoutByBucket[0]).toBeLessThan(100);
    expect(q.payoutByBucket[q.payoutByBucket.length - 1]).toBeLessThan(100);
  });

  it("a collar keeps the floor, gives up gains above the cap, and costs less net than the floor alone", () => {
    const plain = protect({ ladder, units: 10, floor: 70 });
    const collar = protect({ ladder, units: 10, floor: 70, cap: 76 });
    const p = collar.protection;
    const cost = collar.stakeBase / 1e6;
    const net = p.holdingChange.map((h, j) => h + collar.payoutByBucket[j] - cost);
    expect(p.cap).toBe(76);
    expect(p.backInMiddle).not.toBeNull();
    // Net cost when the price ends between floor and cap is below the floor alone's cost.
    expect(cost - p.backInMiddle!).toBeLessThan(plain.stakeBase / 1e6);
    // Gains are flat between the cap and the ladder's top strike.
    const mid = (j: number) => p.holdingChange[j] / 10 + p.reference;
    const capped = net.filter((_, j) => mid(j) > 76.5 && mid(j) < 83.5);
    expect(Math.max(...capped) - Math.min(...capped)).toBeLessThan(5.01);
    // A cap outside (floor, top) is ignored rather than producing a broken schedule.
    expect(protect({ ladder, units: 10, floor: 70, cap: 60 }).protection.cap).toBeNull();
    expect(capChoices(ladder).every((c) => c > p.reference)).toBe(true);
  });
});

describe("more strategies: covered call and spreads", () => {
  it("a covered call earns income if the price stays below the cap, and gives up gains above it", () => {
    const q = coveredCall({ ladder, units: 10, cap: 76 });
    const p = q.protection;
    const cost = q.stakeBase / 1e6;
    expect(p.floor).toBeNull();
    expect(p.coveredDownTo).toBeNull();
    // Below the cap you get back more than you put in: that's the income.
    expect(p.backInMiddle! - cost).toBeGreaterThan(0);
    // Only NO contracts at or above the cap (the cap strike carries a half-size leg, so steps sit at midpoints).
    q.legs.forEach((l) => {
      expect(l.side).toBe("no");
      expect(l.strike!).toBeGreaterThanOrEqual(76);
    });
    // Holding + covered call is flat between the cap and the top strike (gains given up).
    const net = p.holdingChange.map((h, j) => h + q.payoutByBucket[j] - cost);
    const mid = (j: number) => p.holdingChange[j] / 10 + p.reference;
    const capped = net.filter((_, j) => mid(j) > 76.5 && mid(j) < 83.5);
    expect(Math.max(...capped) - Math.min(...capped)).toBeLessThan(5.01);
  });

  it("an up spread pays one equal step per strike above `from`, capped at `to`, and fits in the stake", () => {
    const q = spread({ ladder, direction: "up", from: 72, to: 76, stakeUsd: 100 });
    const s = q.spread;
    expect(s.steps).toBe(4);
    expect(q.legs.every((l) => l.side === "yes" && l.strike! > 72 && l.strike! <= 76)).toBe(true);
    const legs = q.legs.reduce((a, l) => a + Math.round(l.usd * 1e6) + Math.round(l.fee * 1e6), 0);
    expect(legs + Math.round(q.cashUsd * 1e6)).toBe(100 * 1e6);
    // Nothing below $73, one step at $73, all four from $76 up.
    const at = (label: string) => q.payoutByBucket[ladder.bucketLabels.indexOf(label)] - q.cashUsd;
    expect(at("$72 to $73")).toBeCloseTo(0, 6);
    expect(at("$73 to $74")).toBeCloseTo(s.perStep, 6);
    expect(at("$76 to $77")).toBeCloseTo(4 * s.perStep, 6);
    expect(at("$84 or above")).toBeCloseTo(4 * s.perStep, 6);
  });

  it("a down spread mirrors it with NO contracts, paying more the further it falls below `to`", () => {
    const q = spread({ ladder, direction: "down", from: 68, to: 72, stakeUsd: 50 });
    const s = q.spread;
    expect(q.legs.every((l) => l.side === "no" && l.strike! >= 68 && l.strike! < 72)).toBe(true);
    const at = (label: string) => q.payoutByBucket[ladder.bucketLabels.indexOf(label)] - q.cashUsd;
    expect(at("$71 to $72")).toBeCloseTo(0, 6);
    expect(at("$70 to $71")).toBeCloseTo(s.perStep, 6);
    expect(at("Below $65")).toBeCloseTo(4 * s.perStep, 6);
    // Spreads cost money on average at market odds, like every other position.
    expect(q.evUnderMarket).toBeLessThan(50);
  });
});

describe("small stakes keep the shape of the view", () => {
  it("a $10 two-sided 'big move' view profits on both sides, not just the upside", () => {
    // Regression: legs under the $1 minimum used to be dumped into cash, deleting the downside entirely.
    const { mean, sd } = marketMoments(ladder);
    const lo = normalBelief(ladder, mean - 1.5 * sd, sd * 0.7);
    const hi = normalBelief(ladder, mean + 1.5 * sd, sd * 0.7);
    const belief = lo.map((x, j) => (x + hi[j]) / 2);
    const q = compile({ ladder, belief, confidence: 0.5, stakeUsd: 10 });
    const n = q.payoutByBucket.length;
    const lowSide = q.payoutByBucket.slice(0, Math.floor(n / 3));
    const highSide = q.payoutByBucket.slice(Math.ceil((2 * n) / 3));
    expect(Math.max(...lowSide)).toBeGreaterThan(10);
    expect(Math.max(...highSide)).toBeGreaterThan(10);
    q.legs.forEach((l) => expect(l.usd).toBeGreaterThanOrEqual(1));
  });
});

/** Random threshold ladders with sane but noisy (sometimes crossed) quotes. */
const ladderArb = fc
  .record({
    n: fc.integer({ min: 3, max: 25 }),
    center: fc.double({ min: 0.2, max: 0.8, noNaN: true }),
    width: fc.double({ min: 0.08, max: 0.4, noNaN: true }),
    spread: fc.integer({ min: 1, max: 12 }),
    noise: fc.array(fc.integer({ min: -6, max: 6 }), { minLength: 25, maxLength: 25 }),
  })
  .map(({ n, center, width, spread, noise }): EventLike => {
    const contracts = Array.from({ length: n }, (_, i) => {
      const x = i / (n - 1);
      const fair = 1 / (1 + Math.exp((x - center) / width));
      const mid = Math.round(Math.min(0.97, Math.max(0.03, fair)) * 100) + noise[i];
      const bid = Math.min(98, Math.max(1, mid - Math.ceil(spread / 2)));
      const ask = Math.min(99, Math.max(bid + 1, mid + Math.ceil(spread / 2)));
      return {
        label: `$${100 + i} or above`,
        instrumentSymbol: `T-${i}`,
        strike: { type: "above", value: String(100 + i) },
        prices: {
          buy: { yes: (ask / 100).toFixed(2), no: ((100 - bid) / 100).toFixed(2) },
          bestBid: (bid / 100).toFixed(2),
          bestAsk: (ask / 100).toFixed(2),
        },
        quantityMinimum: "0.01",
        quantityIncrement: "0.01",
      };
    });
    return { ticker: "TEST", title: "Test", category: "Crypto", expiryDate: "2030-01-01T00:00:00Z", contracts };
  });

function cleanLadder(ev: EventLike): EventLike {
  const n = ev.contracts.length;
  return {
    ...ev,
    contracts: ev.contracts.map((c, i) => {
      const mid = Math.round(97 - (94 * i) / (n - 1));
      return { ...c, prices: { buy: { yes: ((mid + 2) / 100).toFixed(2), no: ((100 - mid + 2) / 100).toFixed(2) }, bestBid: ((mid - 2) / 100).toFixed(2), bestAsk: ((mid + 2) / 100).toFixed(2) } };
    }),
  };
}

describe("properties", () => {
  const param = fc.record({
    ev: ladderArb,
    shift: fc.double({ min: -3, max: 3, noNaN: true }),
    scale: fc.double({ min: 0.4, max: 1.6, noNaN: true }),
    conf: fc.double({ min: 0, max: 1, noNaN: true }),
    stake: fc.integer({ min: 5, max: 2000 }),
  });

  it("weights sum to 1, payouts positive, legs + cash = stake to the cent", () => {
    fc.assert(
      fc.property(param, ({ ev, shift, scale, conf, stake }) => {
        const l: Ladder = normalizeEvent(ev);
        const belief = fromMarket(l, shift, scale);
        const q = compile({ ladder: l, belief, confidence: conf, stakeUsd: stake, maxIter: 20_000 });
        const ws = q.raw.weights.reduce((a, b) => a + b, 0);
        expect(Math.abs(ws - 1)).toBeLessThan(1e-9);
        q.payoutByBucket.forEach((x) => expect(x).toBeGreaterThan(0));
        const cents = (x: number) => Math.round(x * 100);
        expect(cents(q.legs.reduce((a, l2) => a + l2.usd + l2.fee, 0) + q.cashUsd)).toBe(cents(stake));
        expect(q.legs.reduce((a, l2) => a + Math.round(l2.usd * 1e6) + Math.round(l2.fee * 1e6), 0) + Math.round(q.cashUsd * 1e6)).toBe(stake * 1e6);
        expect(q.cashUsd).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 60 },
    );
  });

  it("confidence 0 leaves at least 95% in cash (consistent quotes)", () => {
    fc.assert(
      fc.property(param, ({ ev, shift, scale, stake }) => {
        // Remove the per-strike noise so the market's own curve agrees with its quotes.
        ev = cleanLadder(ev);
        const l = normalizeEvent(ev);
        const q = compile({ ladder: l, belief: fromMarket(l, shift, scale), confidence: 0, stakeUsd: stake });
        expect(q.cashUsd).toBeGreaterThanOrEqual(0.95 * stake - 1e-9);
        expect(q.advice).toBe("no_edge");
      }),
      { numRuns: 40 },
    );
  });

  it("ladders with crossed quotes still give non-negative probabilities that sum to 1", () => {
    fc.assert(
      fc.property(ladderArb, fc.array(fc.integer({ min: 1, max: 99 }), { minLength: 25, maxLength: 25 }), (ev, junk) => {
        // Scramble quotes so mids are non-monotone and some yes+no asks cross below 1.
        ev.contracts.forEach((c, i) => {
          if (i % 3 === 0) c.prices = { buy: { yes: (junk[i] / 100).toFixed(2), no: "0.10" }, bestBid: null, bestAsk: (junk[i] / 100).toFixed(2) };
        });
        // Too few clean quotes left is a valid answer: the ladder is refused rather than misread.
        const r = tryNormalize(ev);
        if (!("ladder" in r)) {
          expect(r.reason).toMatch(/tight two-sided quotes/);
          return;
        }
        const l = r.ladder;
        const s = l.marketProb.reduce((a, b) => a + b, 0);
        expect(Math.abs(s - 1)).toBeLessThan(1e-12);
        l.marketProb.forEach((p) => expect(p).toBeGreaterThanOrEqual(0));
        // Crossed strikes are never traded.
        const q = compile({ ladder: l, belief: fromMarket(l, 0, 0.7), confidence: 0.5, stakeUsd: 100 });
        q.legs.forEach((leg) => expect(l.crossed[leg.instrumentIndex]).toBe(false));
      }),
      { numRuns: 60 },
    );
  });
});
