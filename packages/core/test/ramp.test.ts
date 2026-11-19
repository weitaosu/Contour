import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRamp, marketMoments, maxRampSteps, normalizeEvent, type EventLike } from "../src";

const sol = normalizeEvent(JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/raw/sol_nov20.json"), "utf8")) as EventLike);
const price = marketMoments(sol).mean;

describe("ramps", () => {
  it("one step is the single contract: a cliff from the full payout to ~$0", () => {
    const q = buildRamp({ ladder: sol, price, direction: "higher", steps: 1, stakeUsd: 100 });
    expect(q.legs.length).toBe(1);
    expect(q.legs[0].side).toBe("yes");
    expect(q.legs[0].strike!).toBeLessThanOrEqual(price);
    expect(q.minPayout).toBeLessThan(1); // only rounding cash
  });

  it("more steps: a lower best case, a slope down to ~$0, and nothing below the slope", () => {
    const cliff = buildRamp({ ladder: sol, price, direction: "higher", steps: 1, stakeUsd: 100 });
    const ramp = buildRamp({ ladder: sol, price, direction: "higher", steps: 5, stakeUsd: 100 });
    expect(ramp.legs.length).toBe(5);
    expect(ramp.maxPayout).toBeLessThan(cliff.maxPayout);
    expect(ramp.minPayout).toBeLessThan(1);
    // Payout never falls as the price rises, and steps up across the ramp's strikes.
    const p = ramp.payoutByBucket;
    for (let j = 1; j < p.length; j++) expect(p[j]).toBeGreaterThanOrEqual(p[j - 1] - 1e-9);
    const levels = new Set(p.map((x) => Math.round(x)));
    expect(levels.size).toBe(6);
    // Contracts + fees + cash equal the stake exactly.
    const spent = ramp.legs.reduce((a, l) => a + Math.round(l.usd * 1e6) + Math.round(l.fee * 1e6), 0);
    expect(spent + Math.round(ramp.cashUsd * 1e6)).toBe(100_000_000);
  });

  it("lower mirrors it; stays near ramps both ways with a guaranteed part", () => {
    const lo = buildRamp({ ladder: sol, price, direction: "lower", steps: 3, stakeUsd: 100 });
    expect(lo.legs.every((l) => l.side === "no" && l.strike! > price)).toBe(true);
    const p = lo.payoutByBucket;
    for (let j = 1; j < p.length; j++) expect(p[j]).toBeLessThanOrEqual(p[j - 1] + 1e-9);
    const near = buildRamp({ ladder: sol, price, direction: "around", steps: 3, stakeUsd: 100 });
    expect(near.legs.length).toBe(6);
    expect(near.ramp.guaranteedUsd).toBeGreaterThan(0);
    expect(maxRampSteps(sol, price, "around")).toBeGreaterThan(2);
  });
});
