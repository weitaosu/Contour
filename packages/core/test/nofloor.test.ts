import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, fromMarket, noFloor, normalizeEvent, type EventLike } from "../src";

const sol = normalizeEvent(JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/raw/sol_nov20.json"), "utf8")) as EventLike);
const belief = fromMarket(sol, 1.0, 0.7);

describe("no floor", () => {
  const prot = compile({ ladder: sol, belief, confidence: 0.75, stakeUsd: 100 });
  const open = noFloor({ ladder: sol, belief, confidence: 0.75, stakeUsd: 100, range: 0.9 });

  it("spends the whole stake: no cash floor", () => {
    expect(open.cashUsd).toBeLessThan(0.5);
    expect(open.cashUsd).toBeGreaterThanOrEqual(0);
    const spent = open.legs.reduce((a, l) => a + Math.round(l.usd * 1e6) + Math.round(l.fee * 1e6), 0);
    expect(spent + Math.round(open.cashUsd * 1e6)).toBe(open.stakeBase);
  });

  it("can lose (nearly) everything outside the range, and wins more often inside it", () => {
    expect(open.minPayout).toBeLessThan(prot.minPayout);
    const win = (pay: number[]) => belief.reduce((a, q, j) => a + (pay[j] > 100 ? q : 0), 0);
    expect(win(open.payoutByBucket)).toBeGreaterThanOrEqual(win(prot.payoutByBucket));
    expect(open.range.from).toBeLessThanOrEqual(open.range.to);
  });
});
