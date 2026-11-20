/**
 * The four steps from a market to a position, worded once and shared: the landing page's "How it
 * works" shows each title with its sentence (`body`), and the market browser's intro each title with
 * its short version (`short`).
 * Titles match the labels people meet inside a market.
 */
export const STEPS = [
  {
    title: "Pick a market",
    short: "crypto, sports, politics and more, below",
    body: "Trade across crypto, sports, politics, and more on Gemini Prediction Markets.",
  },
  {
    title: "Shape your view",
    short: "draw where it lands and how sure you are",
    body: "Draw a curve around where you expect the outcome to land and how confident you are. Contour selects and sizes contracts to express your view.",
  },
  {
    title: "See what you make",
    short: "the most you can make and lose, and your odds",
    body: "Understand the most you can make and lose, your chance of profit, and the contracts you’d buy at Gemini’s prices.",
  },
  {
    title: "Review your trade",
    short: "sign once to lock the payout on Solana",
    body: "Read a plain summary of what you pay and the best and worst case. Sign with your wallet to lock the payout on Solana.",
  },
] as const;
