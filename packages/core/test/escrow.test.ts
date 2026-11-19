import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compile, escrowTerms, fromMarket, marketMoments, normalizeEvent, type EventLike } from "../src";

const root = resolve(__dirname, "../../..");
const fixture = JSON.parse(readFileSync(resolve(root, "fixtures/sol_calm.json"), "utf8"));
const ladder = normalizeEvent(fixture.event as EventLike);

describe("escrow terms", () => {
  const cases = [0.1, 0.25, 0.5, 1].flatMap((confidence) =>
    [-1, 0, 0.8].map((shift) => compile({ ladder, belief: fromMarket(ladder, shift * marketMoments(ladder).sd, 0.7), confidence, stakeUsd: 100 })),
  );

  it("escrow only the at-risk part: stake − cash, every payout − cash, cash kept", () => {
    for (const q of cases) {
      const e = escrowTerms(q);
      const cash = Math.round(q.cashUsd * 1e6);
      expect(e.keptBase).toBe(cash);
      expect(e.stakeBase).toBe(q.stakeBase - cash);
      expect(e.scheduleBase.every((b) => b >= 0)).toBe(true);
      // Profit and loss in every outcome is unchanged.
      e.scheduleBase.forEach((b, j) => expect(b - e.stakeBase).toBe(q.scheduleBase[j] - q.stakeBase));
      // The desk's collateral (largest payout − stake) is unchanged too.
      expect(Math.max(...e.scheduleBase) - e.stakeBase).toBe(Math.max(...q.scheduleBase) - q.stakeBase);
    }
  });

  it("some of these views do keep cash, so the test means something", () => {
    expect(cases.some((q) => escrowTerms(q).keptBase > 1e6)).toBe(true);
  });
});
