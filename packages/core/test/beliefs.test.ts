import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bucketMidpoints, likelyRange, marketMoments, normalBelief, normalizeEvent, normCdf, paysIn, type EventLike, type Ladder } from "../src";

// Reference values computed independently with Python's math.erf, not with this package's code,
// so a regression in the shared math can't hide behind its own output. These numbers drive the
// forecast screen's outlook (panel 1) and "Shape your view" curve and captions (panel 2).

const raw = (f: string) => JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/raw", f), "utf8")) as EventLike;

/** A minimal ordered ladder: cuts 1..5, six outcomes. */
const toy = { cuts: [1, 2, 3, 4, 5], marketProb: [0.1, 0.2, 0.3, 0.25, 0.1, 0.05] } as unknown as Ladder;

describe("normal distribution", () => {
  it("matches math.erf to 1e-14", () => {
    const ref: [number, number][] = [
      [0, 0.5],
      [1, 0.8413447460685429],
      [-1.96, 0.024997895148220428],
      [3, 0.9986501019683699],
      [-4, 3.167124183311998e-5],
    ];
    for (const [z, p] of ref) expect(Math.abs(normCdf(z) - p)).toBeLessThan(1e-14);
  });
});

describe("your view's curve (normalBelief)", () => {
  it("is the normal's chance in each outcome, end outcomes open-ended", () => {
    const ref = [0.007253771124867803, 0.08395744860100007, 0.32085922814507467, 0.4008981533836162, 0.16428126679726207, 0.02275013194817921];
    const got = normalBelief(toy, 3.2, 0.9);
    got.forEach((p, j) => expect(Math.abs(p - ref[j])).toBeLessThan(1e-12));
  });

  it("puts about 2 in 3 of the view within one width of its center (the '2 in 3 chance' caption)", () => {
    const l = normalizeEvent(raw("sol_nov20.json"));
    const { mean, sd } = marketMoments(l);
    const b = normalBelief(l, mean + 0.8 * sd, 0.85 * sd);
    const lo = mean + 0.8 * sd - 0.85 * sd;
    const hi = mean + 0.8 * sd + 0.85 * sd;
    const cuts = l.cuts!;
    // Mass between lo and hi, splitting the partly covered outcomes linearly.
    let inside = 0;
    b.forEach((p, j) => {
      if (j === 0 || j === cuts.length) return; // open-ended ends lie outside ±1 width here
      const a = cuts[j - 1];
      const c = cuts[j];
      inside += (p * Math.max(0, Math.min(hi, c) - Math.max(lo, a))) / (c - a);
    });
    expect(Math.abs(inside - 0.6827)).toBeLessThan(0.02);
  });
});

describe("the market's numbers on the outlook and sliders", () => {
  it("'expects' is the average of the outcome midpoints, weighted by the market's odds", () => {
    const l = normalizeEvent(raw("sol_nov20.json"));
    const cuts = l.cuts!;
    const mids = [cuts[0] - (cuts[1] - cuts[0]) / 2, ...cuts.slice(1).map((c, j) => (cuts[j] + c) / 2), cuts[cuts.length - 1] + (cuts[cuts.length - 1] - cuts[cuts.length - 2]) / 2];
    expect(bucketMidpoints(l)).toEqual(mids);
    const mean = l.marketProb.reduce((s, p, j) => s + p * mids[j], 0);
    const sd = Math.sqrt(l.marketProb.reduce((s, p, j) => s + p * (mids[j] - mean) ** 2, 0));
    expect(marketMoments(l).mean).toBeCloseTo(mean, 12);
    expect(marketMoments(l).sd).toBeCloseTo(sd, 12);
  });

  it("the market's range is the shortest run of outcomes holding at least the asked share", () => {
    // [0.1, 0.2, 0.3, 0.25, 0.1, 0.05]: two outcomes reach 50% first at 1..2 (0.5); 2 in 3 needs three, first at 1..3 (0.75).
    expect(likelyRange(toy.marketProb, 0.5)).toEqual([1, 2]);
    expect(likelyRange(toy.marketProb, 2 / 3)).toEqual([1, 3]);
    const l = normalizeEvent(raw("sol_nov20.json"));
    const [a, b] = likelyRange(l.marketProb, 2 / 3);
    const held = l.marketProb.slice(a, b + 1).reduce((s, p) => s + p, 0);
    expect(held).toBeGreaterThanOrEqual(2 / 3);
    // No shorter run of outcomes holds 2 in 3.
    for (let i = 0; i + (b - a) - 1 < l.marketProb.length; i++) {
      const s = l.marketProb.slice(i, i + (b - a)).reduce((x, p) => x + p, 0);
      expect(s).toBeLessThan(2 / 3);
    }
  });
});

describe("outcomes and contracts line up with Gemini's rules", () => {
  it("a YES on strike s pays exactly in the outcomes at or above s (rules: 'is $s or above')", () => {
    const l = normalizeEvent(raw("sol_nov20.json"));
    l.strikes.forEach((s, i) => {
      l.bucketLabels.forEach((label, j) => {
        const lowerBound = j === 0 ? -Infinity : l.cuts![j - 1];
        expect(paysIn(l, i, "yes", j)).toBe(lowerBound >= s);
        expect(paysIn(l, i, "no", j)).toBe(lowerBound < s);
      });
    });
    expect(l.bucketLabels[1]).toBe(`$${l.strikes[0]} to $${l.strikes[1]}`);
  });

  it("the market's odds add up to 1 and fall straight out of the strikes' chances", () => {
    const l = normalizeEvent(raw("sol_nov20.json"));
    expect(l.marketProb.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
    expect(l.marketProb.every((p) => p > 0)).toBe(true);
  });
});
