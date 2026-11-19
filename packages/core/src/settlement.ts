import type { ContractLike, EventLike } from "./normalize";
import type { Ladder } from "./types";

export interface Outcome {
  bucket: number;
  consistent: boolean;
  settlementValue: number | null;
  detail: string;
}

/**
 * Map a settled Gemini event to a bucket index of the ladder.
 * Threshold: bucket = number of strikes whose "at or above" side came true (a prefix of the sorted
 * strikes). A contract that pays below its strike ("Before …") came true on that side when it resolved NO.
 * Buckets/categorical: the single contract that resolved YES; with an extra "none of the listed"
 * outcome (Ladder.none), every contract resolving NO is that outcome.
 */
export function outcomeBucket(ladder: Ladder, e: EventLike & { settlement?: { value?: string } | null }): Outcome | null {
  const bySymbol = new Map<string, ContractLike>(e.contracts.map((c) => [c.instrumentSymbol, c]));
  const sides = ladder.instruments.map((i) => bySymbol.get(i.symbol)?.resolutionSide);
  if (sides.some((s) => s !== "yes" && s !== "no")) return null; // not fully settled yet
  const value = e.settlement?.value !== undefined && e.settlement?.value !== null ? Number(e.settlement.value) : null;
  if (ladder.kind === "threshold") {
    const above = sides.map((s, i) => (ladder.instruments[i].below ? s === "no" : s === "yes"));
    const aboveCount = above.filter(Boolean).length;
    const prefix = above.every((a, i) => a === i < aboveCount);
    let consistent = prefix;
    // Gemini's settlement value cross-checks "at or above" ladders; for the other way round the
    // contracts' own resolutions are the record (a date ladder has no single value to compare).
    if (value !== null && Number.isFinite(value) && !ladder.instruments.some((i) => i.below)) {
      const byValue = ladder.strikes.filter((k) => value >= k).length;
      consistent = consistent && byValue === aboveCount;
    }
    const reversed = ladder.instruments.some((i) => i.below);
    const detail = reversed ? `${aboveCount} of ${sides.length} strikes came true on the "at or above" side` : `${aboveCount} of ${sides.length} strikes resolved yes`;
    return { bucket: aboveCount, consistent, settlementValue: value, detail };
  }
  const winners = sides.map((s, i) => (s === "yes" ? i : -1)).filter((i) => i >= 0);
  if (winners.length === 0 && ladder.none)
    return { bucket: ladder.instruments.length, consistent: true, settlementValue: value, detail: `none of the listed outcomes resolved yes: "${ladder.none}"` };
  if (winners.length !== 1) return { bucket: -1, consistent: false, settlementValue: value, detail: `${winners.length} outcomes resolved yes` };
  return { bucket: winners[0], consistent: true, settlementValue: value, detail: `"${ladder.bucketLabels[winners[0]]}" resolved yes` };
}
