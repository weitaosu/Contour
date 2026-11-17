/** Forecast score: ln(belief[j*] / market[j*]) using the unblended belief and market probs stored at open. */
export function forecastScore(belief: readonly number[], marketProb: readonly number[], bucket: number): number {
  return Math.log(belief[bucket] / marketProb[bucket]);
}

export function scoreBps(belief: readonly number[], marketProb: readonly number[], bucket: number): number {
  return Math.round(10_000 * forecastScore(belief, marketProb, bucket));
}
