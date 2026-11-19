import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blendWithSingle, compile, fromMarket, normalizeEvent, paysIn, type EventLike } from "../src";

const sol = normalizeEvent(JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/raw/sol_nov20.json"), "utf8")) as EventLike);
const belief = fromMarket(sol, 1.5, 0.8);
const q = compile({ ladder: sol, belief, confidence: 1, stakeUsd: 100 });

describe("blend with the single contract", () => {
  it("t = 0 is exactly the single contract", () => {
    const b = blendWithSingle(sol, q, 0, belief);
    const c = q.comparison!;
    const i = sol.instruments.findIndex((x) => x.symbol === c.symbol);
    const single = sol.marketProb.map((_, j) => (paysIn(sol, i, c.side, j) ? c.qty : 0) - (c.qty * c.price + c.fee));
    b.payoutByBucket.forEach((p, j) => expect(p - 100).toBeCloseTo(single[j], 6));
  });

  it("t = 1 is exactly the solved position", () => {
    const b = blendWithSingle(sol, q, 1, belief);
    b.payoutByBucket.forEach((p, j) => expect(p).toBeCloseTo(q.payoutByBucket[j], 6));
  });

  it("in between: same stake, payouts between the two, never over-spent", () => {
    const one = blendWithSingle(sol, q, 0);
    const all = blendWithSingle(sol, q, 1);
    for (const t of [0.25, 0.5, 0.75]) {
      const b = blendWithSingle(sol, q, t);
      expect(b.cashUsd).toBeGreaterThanOrEqual(0);
      expect(b.stakeBase).toBe(q.stakeBase);
      b.payoutByBucket.forEach((p, j) => {
        const mix = t * all.payoutByBucket[j] + (1 - t) * one.payoutByBucket[j];
        expect(Math.abs(p - mix)).toBeLessThan(0.5);
      });
    }
  });
});
