import type { Quote } from "./types";

/**
 * What a position actually escrows on-chain. The quote's cash would come back in every outcome, so
 * locking it buys nothing: the desk's collateral (largest payout − stake) is the same either way.
 * The escrow therefore holds only what's at risk (contracts + fees), every scheduled payout drops
 * by the cash, and the cash never leaves the wallet. Profit and loss in every outcome are unchanged.
 */
export interface EscrowTerms {
  /** USDC base units moved into escrow: the quote's stake minus its cash. */
  stakeBase: number;
  /** The on-chain payout per outcome, in base units: the quote's payout minus its cash. */
  scheduleBase: number[];
  /** Base units that stay in the wallet. */
  keptBase: number;
}

export function escrowTerms(q: Pick<Quote, "stakeBase" | "scheduleBase" | "cashUsd">): EscrowTerms {
  // Every payout includes the cash, so the floor of the schedule bounds it too (and keeps payouts ≥ 0).
  const kept = Math.max(0, Math.min(Math.round(q.cashUsd * 1e6), q.stakeBase, ...q.scheduleBase));
  return { stakeBase: q.stakeBase - kept, scheduleBase: q.scheduleBase.map((b) => b - kept), keptBase: kept };
}
