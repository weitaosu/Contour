/**
 * The four steps from a market to a position, worded once and shared: the landing page's "How it
 * works" shows each title with its sentence (`body`), and the market browser's intro each title with
 * its short version (`short`).
 * Titles match the labels people meet inside a market.
 */
export const STEPS = [
  {
    title: "Pick a market",
    short: "crypto, sports, weather and more, below",
    body: "Sports, crypto, commodities and more, live from Gemini Prediction Markets. The grey curve shows where traders expect the outcome to land.",
  },
  {
    title: "Shape your view",
    short: "draw where it lands and how sure you are",
    body: "Pick what you expect to happen, then drag your curve over the range you believe in. Contour picks the contracts and sizes them for you.",
  },
  {
    title: "See what you make",
    short: "the most you can make and lose",
    body: "Your payout in every outcome updates as you shape the curve: the most you can make, the most you can lose, and your chance of profit.",
  },
  {
    title: "Review your trade",
    short: "sign once to lock the payout on Solana",
    body: "Review the order and confirm it from your wallet. Your portfolio then shows open positions, past trades and live P&L, and you can close early any time.",
  },
] as const;
