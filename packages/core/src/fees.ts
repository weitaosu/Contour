/**
 * Gemini Predictions trading fees, per the fee schedule dated March 12, 2026 (applies to contracts
 * listed on or after March 18, 2026): https://www.gemini.com/fees/predictions
 *
 *   Taker fee = 0.07   × C × P × (1 − P)     (orders that match immediately, e.g. buying at the ask)
 *   Maker fee = 0.0175 × C × P × (1 − P)     (orders that rest on the book; charged only when matched)
 *
 * C = contracts, P = price in dollars. Fees are rounded up to the next cent. There are no settlement
 * or membership fees. The desk hedges by buying at the ask, so every leg pays the taker rate.
 */
export const GEMINI_TAKER_FEE_RATE = 0.07;
export const GEMINI_MAKER_FEE_RATE = 0.0175;

/** Fee in USD for one order of `qty` contracts at `price`, rounded up to the next cent like Gemini does. */
export function tradingFeeUsd(qty: number, price: number, rate = GEMINI_TAKER_FEE_RATE): number {
  const raw = rate * qty * price * (1 - price);
  if (!(raw > 0)) return 0;
  // The epsilon keeps exact cents (e.g. 1.68) from rounding up a further cent through float noise.
  return Math.ceil(raw * 100 - 1e-9) / 100;
}

/** All-in cost of one contract before cent rounding: what the optimizer pays per contract. */
export function costPerContract(price: number, rate = GEMINI_TAKER_FEE_RATE): number {
  return price + rate * price * (1 - price);
}
