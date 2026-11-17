import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  compile,
  fromMarket,
  marketMoments,
  normalBelief,
  normalizeEvent,
  type EventLike,
  type Ladder,
} from "../src";

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
    const quote = compile({
      ladder,
      belief: fixture.inputs.belief,
      confidence: fixture.inputs.confidence,
      stakeUsd: fixture.inputs.stakeUsd,
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
    const legCost = quote.legs.reduce((a, l) => a + Math.round(l.usd * 1e6), 0);
    expect(legCost + Math.round(quote.cashUsd * 1e6)).toBe(quote.stakeBase);
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
        expect(cents(q.legs.reduce((a, l2) => a + l2.usd, 0) + q.cashUsd)).toBe(cents(stake));
        expect(q.legs.reduce((a, l2) => a + Math.round(l2.usd * 1e6), 0) + Math.round(q.cashUsd * 1e6)).toBe(stake * 1e6);
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
        const l = normalizeEvent(ev);
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
