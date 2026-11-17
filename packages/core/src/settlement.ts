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
 * Threshold: bucket = number of strikes that resolved YES (they must be a prefix of the sorted strikes).
 * Buckets/categorical: the single contract that resolved YES.
 */
export function outcomeBucket(ladder: Ladder, e: EventLike & { settlement?: { value?: string } | null }): Outcome | null {
  const bySymbol = new Map<string, ContractLike>(e.contracts.map((c) => [c.instrumentSymbol, c]));
  const sides = ladder.instruments.map((i) => bySymbol.get(i.symbol)?.resolutionSide);
  if (sides.some((s) => s !== "yes" && s !== "no")) return null; // not fully settled yet
  const value = e.settlement?.value !== undefined && e.settlement?.value !== null ? Number(e.settlement.value) : null;
  if (ladder.kind === "threshold") {
    const yesCount = sides.filter((s) => s === "yes").length;
    const prefix = sides.every((s, i) => (i < yesCount ? s === "yes" : s === "no"));
    let consistent = prefix;
    if (value !== null && Number.isFinite(value)) {
      const byValue = ladder.strikes.filter((k) => value >= k).length;
      consistent = consistent && byValue === yesCount;
    }
    return { bucket: yesCount, consistent, settlementValue: value, detail: `${yesCount} of ${sides.length} strikes resolved yes` };
  }
  const winners = sides.map((s, i) => (s === "yes" ? i : -1)).filter((i) => i >= 0);
  if (winners.length !== 1) return { bucket: -1, consistent: false, settlementValue: value, detail: `${winners.length} outcomes resolved yes` };
  return { bucket: winners[0], consistent: true, settlementValue: value, detail: `"${ladder.bucketLabels[winners[0]]}" resolved yes` };
}
