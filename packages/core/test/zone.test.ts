import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildZone, capOptions, fromRatings, groupByMass, marketMoments, normalizeEvent, tryNormalize, zoneOptions, type EventLike, type ZoneDirection } from "../src";

const raw = (f: string) => JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/raw", f), "utf8")) as EventLike;
const sol = normalizeEvent(raw("sol_nov20.json"));
const center = marketMoments(sol).mean;

describe("zone options on a price ladder", () => {
  for (const dir of ["higher", "lower", "around"] as ZoneDirection[]) {
    it(`${dir}: ordered from biggest payout to safest, with at most two contracts each`, () => {
      const { options, start } = zoneOptions(sol, center, dir);
      expect(options.length).toBeGreaterThan(2);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(start).toBeLessThan(options.length);
      for (let k = 1; k < options.length; k++) expect(options[k].winRate).toBeGreaterThanOrEqual(options[k - 1].winRate);
      // No stop is beaten by a safer one on payout: reward-to-risk falls strictly as win rate rises.
      for (let k = 1; k < options.length; k++) expect(options[k].rewardToRisk).toBeLessThan(options[k - 1].rewardToRisk);
      for (const o of options) {
        expect(o.legs.length).toBeLessThanOrEqual(2);
        expect(o.rewardToRisk).toBeGreaterThan(0);
        // At the market's odds, reward-to-risk can't beat the fair (1 − w) / w by more than rounding.
        expect(o.rewardToRisk).toBeLessThan(((1 - o.winRate) / o.winRate) * 1.25 + 0.05);
      }
    });
  }

  it("higher is open above, lower is open below, around is a band", () => {
    const n = sol.marketProb.length;
    expect(zoneOptions(sol, center, "higher").options.every((o) => o.hi === n - 1 && o.to === null)).toBe(true);
    expect(zoneOptions(sol, center, "lower").options.every((o) => o.lo === 0 && o.from === null)).toBe(true);
    // Higher always wins at the price (line at or below it); lower always wins just below it (line above it).
    expect(zoneOptions(sol, center, "higher").options.every((o) => o.from! <= center)).toBe(true);
    expect(zoneOptions(sol, center, "lower").options.every((o) => o.to! > center)).toBe(true);
    expect(zoneOptions(sol, center, "higher").start).toBe(0);
    expect(zoneOptions(sol, center, "around").options.some((o) => o.legs.length === 2)).toBe(true);
  });
});

describe("buildZone", () => {
  it("risks no more than asked, wins in the zone and loses the risk outside", () => {
    for (const dir of ["higher", "lower", "around"] as ZoneDirection[]) {
      const { options, start } = zoneOptions(sol, center, dir);
      const q = buildZone({ ladder: sol, option: options[start], riskUsd: 50 });
      const { lo, hi } = q.zone.option;
      expect(q.zone.units).toBeGreaterThan(0);
      expect(q.zone.riskUsd).toBeLessThanOrEqual(50);
      expect(q.zone.riskUsd).toBeGreaterThan(45);
      q.payoutByBucket.forEach((p, j) => {
        if (j >= lo && j <= hi) expect(p).toBeCloseTo(q.maxPayout, 6);
        else expect(p).toBeCloseTo(q.minPayout, 6);
      });
      expect(q.maxPayout).toBeGreaterThan(q.zone.depositUsd);
      // Legs + fees + cash equal the deposit to the base unit.
      const spent = q.legs.reduce((a, l) => a + Math.round(l.usd * 1e6) + Math.round(l.fee * 1e6), 0);
      expect(spent + Math.round(q.cashUsd * 1e6)).toBe(q.stakeBase);
    }
  });

  it("works on a bucket ladder (weather ranges)", () => {
    const r = tryNormalize(raw("weather.json"));
    if (!("ladder" in r)) return;
    const l = r.ladder;
    const { options, start } = zoneOptions(l, marketMoments(l).mean, "around");
    if (!options.length) return;
    const q = buildZone({ ladder: l, option: options[start], riskUsd: 20 });
    expect(q.legs.every((leg) => leg.side === "yes")).toBe(true);
    expect(q.zone.riskUsd).toBeLessThanOrEqual(20);
  });
});

describe("capping the other end", () => {
  it("higher with a cap: wins less often, pays more, still covers the price", () => {
    const { options, start } = zoneOptions(sol, center, "higher");
    const base = options[start];
    const caps = capOptions(sol, base, center, "higher");
    expect(caps.length).toBeGreaterThan(0);
    for (const c of caps) {
      expect(c.lo).toBe(base.lo);
      expect(c.legs.length).toBe(2);
      expect(c.winRate).toBeLessThan(base.winRate);
      expect(c.rewardToRisk).toBeGreaterThan(base.rewardToRisk);
      expect(c.to!).toBeGreaterThan(center);
    }
    for (let k = 1; k < caps.length; k++) expect(caps[k].rewardToRisk).toBeGreaterThan(caps[k - 1].rewardToRisk);
  });

  it("lower with a floor mirrors it", () => {
    const { options, start } = zoneOptions(sol, center, "lower");
    const caps = capOptions(sol, options[start], center, "lower");
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.every((c) => c.hi === options[start].hi && c.from! <= center)).toBe(true);
  });
});

describe("ratings", () => {
  it("groups cover every bucket once with similar market mass", () => {
    const g = groupByMass(sol, 5);
    expect(g.length).toBe(5);
    expect(g[0].lo).toBe(0);
    expect(g.at(-1)!.hi).toBe(sol.marketProb.length - 1);
    for (let k = 1; k < g.length; k++) expect(g[k].lo).toBe(g[k - 1].hi + 1);
    expect(g.reduce((a, x) => a + x.marketProb, 0)).toBeCloseTo(1, 9);
  });

  it("all 'about right' is the market; 'more likely' raises that range", () => {
    const g = groupByMass(sol, 5);
    const same = fromRatings(sol, g, [0, 0, 0, 0, 0]);
    same.forEach((p, j) => expect(p).toBeCloseTo(sol.marketProb[j], 12));
    const b = fromRatings(sol, g, [0, 0, 1, 0, 0]);
    const mid = (x: number[]) => x.slice(g[2].lo, g[2].hi + 1).reduce((a, y) => a + y, 0);
    expect(mid(b)).toBeGreaterThan(g[2].marketProb);
    expect(b.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 12);
  });
});
