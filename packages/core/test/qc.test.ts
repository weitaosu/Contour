import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { accountingProblems, anyViewTrades, compile, marketMoments, OUTLOOK_KEYS, outlookShape, outlookStart, normCdf, normalBelief, normalizeEvent, outlookBelief, qcLadder, tryNormalize, type EventLike } from "../src";

const raw = (f: string) => JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/raw", f), "utf8")) as EventLike;
const errors = (r: ReturnType<typeof qcLadder>) => r.findings.filter((f) => f.severity === "error");
const rules = (r: ReturnType<typeof qcLadder>) => new Set(r.findings.map((f) => f.rule));

/** A well-behaved threshold ladder: P(X > s) from a normal, quoted 2¢ either side of fair. */
function cleanLadder(mean = 50, sd = 5, half = 0.02): EventLike {
  const c2 = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
  const strikes = Array.from({ length: 11 }, (_, i) => 40 + 2 * i);
  return {
    ticker: "TEST-CLEAN",
    title: "Clean ladder",
    category: "Test",
    expiryDate: "2099-01-01T00:00:00Z",
    contracts: strikes.map((s) => {
      const p = Math.min(0.97, Math.max(0.03, 1 - normCdf((s - mean) / sd)));
      return {
        label: `${s} or above`,
        instrumentSymbol: `TEST-${s}`,
        strike: { type: "above", value: String(s) },
        prices: { buy: { yes: c2(p + half), no: c2(1 - p + half) }, bestBid: c2(p - half), bestAsk: c2(p + half) },
      };
    }),
  };
}

describe("QC rules", () => {
  it("a consistent ladder passes every error rule, and each outlook leans its own way", () => {
    const l = normalizeEvent(cleanLadder());
    const r = qcLadder(l);
    expect(errors(r)).toEqual([]);
    // Higher and Lower must not buy the same thing.
    const at = (o: string) => r.runs.find((x) => x.outlook === o && x.confidence === 1)!;
    expect(at("higher").trades && at("lower").trades).toBe(true);
    expect(at("higher").legs).not.toEqual(at("lower").legs);
  });

  it("Akron vs Massachusetts: locked last-trade prices are dropped, and the real orders read as one market", () => {
    const l = normalizeEvent(raw("sports_total_contradictory.json"));
    const at = (s: number) => l.instruments[l.strikes.indexOf(s)];
    // 58.5 showed 83¢/17¢ with an empty book: no price at all now.
    expect([at(58.5).yesAsk, at(58.5).noAsk]).toEqual([null, null]);
    // 46.5 had a real 47¢ bid but no seller: the NO side (1 − bid) stays, the YES "ask" goes.
    expect([at(46.5).yesAsk, at(46.5).noAsk]).toEqual([null, 0.53]);
    const r = qcLadder(l);
    expect(errors(r)).toEqual([]);
    expect(rules(r)).not.toContain("phantom-quotes");
    const run = (o: string) => r.runs.find((x) => x.outlook === o && x.confidence === 1)!;
    expect(run("higher").legs).not.toEqual(run("lower").legs);
  });

  it("a ladder whose real orders contradict each other is refused, and QC names it", () => {
    const k = (s: number, bid: string, ask: string) => ({
      label: `${s} or above`,
      instrumentSymbol: `C-${s}`,
      strike: { type: "above", value: String(s) },
      prices: { buy: { yes: ask, no: (1 - Number(bid)).toFixed(2) }, bestBid: bid, bestAsk: ask },
    });
    const e: EventLike = {
      ticker: "TEST-CONTRA",
      title: "Contradictory",
      category: "Test",
      expiryDate: "2099-01-01T00:00:00Z",
      contracts: [k(10, "0.70", "0.74"), k(20, "0.45", "0.50"), k(30, "0.85", "0.90"), k(40, "0.10", "0.14")],
    };
    const r = tryNormalize(e);
    expect("reason" in r && r.reason).toMatch(/contradict/);
    // Read anyway (as for a settled ladder), QC reports the free money the contradiction leaves.
    const hit = rules(qcLadder(normalizeEvent(e, { allowUnquoted: true })));
    for (const id of ["contradictory-quotes", "free-money"]) expect(hit, id).toContain(id);
  });

  it("a bucket ladder's one-sided tails stay at their asks (Dallas high, Nov 19)", () => {
    const b = (label: string, yes: string, no: string | null, bid: string | null) => ({
      label,
      instrumentSymbol: `T-${label}`,
      prices: { buy: { yes, ...(no ? { no } : {}) }, ...(bid ? { bestBid: bid } : {}) },
    });
    const l = normalizeEvent({
      ticker: "TEST-DFW",
      title: "Highest temperature in Dallas",
      category: "Weather",
      expiryDate: "2099-01-01T00:00:00Z",
      contracts: [
        b("69°F or below", "0.03", "0.99", "0.01"),
        b("70°F to 71°F", "0.08", "0.94", "0.06"),
        b("72°F to 73°F", "0.59", "0.46", "0.54"),
        b("74°F to 75°F", "0.38", "0.67", "0.33"),
        b("76°F to 77°F", "0.02", null, null),
        b("78°F or above", "0.01", null, null),
      ],
    });
    // The two tails are offered at 2¢ and 1¢: the curve used to fill each with its neighbour's 36%.
    expect(l.marketProb[4]).toBeLessThanOrEqual(0.02 + 1e-9);
    expect(l.marketProb[5]).toBeLessThanOrEqual(0.01 + 1e-9);
    // Tight quotes stay inside their own bid–ask.
    expect(l.marketProb[2]).toBeGreaterThanOrEqual(0.54 - 1e-9);
    expect(l.marketProb[2]).toBeLessThanOrEqual(0.59 + 1e-9);
    const r = qcLadder(l);
    expect(errors(r)).toEqual([]);
  });

  it("named outcomes keep a tight favourite inside its quote when the prices don't add up (Fed, Dec)", () => {
    const o = (label: string, yes: string, no: string, bid?: string) => ({ label, instrumentSymbol: `F-${label}`, prices: { buy: { yes, no }, ...(bid ? { bestBid: bid } : {}) } });
    const l = normalizeEvent(
      {
        ticker: "TEST-FED",
        title: "Fed decision",
        category: "Economics",
        expiryDate: "2099-01-01T00:00:00Z",
        contracts: [o("Hike 25bps", "0.93", "0.11", "0.89"), o("Hike >25bps", "0.08", "0.97", "0.03"), o("Maintain", "0.05", "0.94"), o("Cut", "0.03", "0.98")],
      },
      { categoricalAllowlist: ["TEST-FED"] },
    );
    // Proportional rescaling used to pull the 89–93¢ favourite down to 85%.
    expect(l.marketProb[0]).toBeGreaterThanOrEqual(0.89 - 1e-9);
    expect(l.marketProb[0]).toBeLessThanOrEqual(0.93 + 1e-9);
    expect(l.marketProb.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("the accounting rule passes on real ladders", () => {
    for (const f of ["sol_nov20.json", "weather.json", "sports_total.json"]) {
      const l = normalizeEvent(raw(f), { allowUnquoted: true });
      const { belief } = l.cuts ? outlookBelief(l, "higher") : { belief: l.marketProb };
      const q = compile({ ladder: l, belief, confidence: 1, stakeUsd: 100, maxIter: 8_000 });
      expect(accountingProblems(l, q), f).toEqual([]);
    }
  });
});

describe("Stays near (range positions)", () => {
  const ladders = [
    ["clean", normalizeEvent(cleanLadder())],
    ["SOL Nov 20", normalizeEvent(raw("sol_nov20.json"), { allowUnquoted: true })],
  ] as const;

  it("always loses at both ends, whatever the view, confidence or stake", () => {
    let traded = 0;
    for (const [name, l] of ladders) {
      const { mean, sd } = marketMoments(l);
      for (const shift of [-1, -0.5, 0, 0.5, 1])
        for (const w of [0.3, 0.55, 1])
          for (const confidence of [0.25, 0.5, 1])
            for (const stakeUsd of [10, 100, 500]) {
              const belief = normalBelief(l, mean + shift * sd, sd * w);
              const q = compile({ ladder: l, belief, confidence, stakeUsd, shape: "range", maxIter: 6_000 });
              const where = `${name} shift ${shift} width ${w} conf ${confidence} $${stakeUsd}`;
              expect(accountingProblems(l, q), where).toEqual([]);
              if (!q.legs.length) continue;
              traded++;
              const ends = [q.scheduleBase[0], q.scheduleBase[q.scheduleBase.length - 1]];
              ends.forEach((b) => expect(b, where).toBeLessThan(q.stakeBase));
              // Every YES is matched by the same number of NO contracts.
              const total = (side: string) => q.legs.filter((g) => g.side === side).reduce((a, g) => a + g.qty, 0);
              expect(total("yes"), where).toBeCloseTo(total("no"), 6);
            }
    }
    expect(traded).toBeGreaterThan(20);
  }, 120_000);

  it("QC holds the Stays near outlook to it", () => {
    const r = qcLadder(normalizeEvent(cleanLadder()));
    expect(rules(r)).not.toContain("near-not-both-sides");
    const near = r.runs.filter((x) => x.outlook === "near" && x.trades);
    expect(near.length).toBeGreaterThan(0);
    near.forEach((x) => expect(Math.max(x.payouts[0], x.payouts[x.payouts.length - 1])).toBeLessThan(100));
  });
});

describe("outlook starting points", () => {
  it("every tile opens on a position that trades", () => {
    const l = normalizeEvent(cleanLadder());
    for (const k of OUTLOOK_KEYS) {
      const start = outlookStart(l, k);
      expect(start, k).not.toBeNull();
      const { belief } = outlookBelief(l, k, null, start!.strength);
      const q = compile({ ladder: l, belief, confidence: start!.confidence, stakeUsd: 100, shape: outlookShape(k) });
      expect(q.advice, k).toBe("trade");
    }
  }, 120_000);

  it("a market where no view can be bought is reported as such", () => {
    // Every quote crossed (stale): the curve still reads, but there is no contract to buy.
    const e = cleanLadder();
    e.contracts.forEach((c) => (c.prices!.buy!.no = (1 - Number(c.prices!.buy!.yes) - 0.05).toFixed(2)));
    const l = normalizeEvent(e);
    expect(anyViewTrades(l)).toBe(false);
    expect(new Set(qcLadder(l).findings.map((f) => f.rule))).toContain("no-view-trades");
  }, 120_000);
});
