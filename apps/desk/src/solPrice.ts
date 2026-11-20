import { config } from "./config";

/**
 * SOL in US dollars from Gemini's public ticker, cached briefly. Demo direct-payment mode prices each
 * quote's stake in devnet SOL at this rate: an estimate, since devnet SOL has no real value.
 */
let cached: { usd: number; at: number } | null = null;
const TTL_MS = 30_000;

export async function solUsd(): Promise<number> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.usd;
  try {
    const r = await fetch(`${config.geminiBase}/v1/pubticker/solusd`, { signal: AbortSignal.timeout(5_000) });
    if (!r.ok) throw new Error(`Gemini ticker ${r.status}`);
    const usd = Number(((await r.json()) as { last?: string }).last);
    if (!(usd > 0)) throw new Error("Gemini ticker had no SOL price");
    cached = { usd, at: Date.now() };
    return usd;
  } catch (err) {
    // A slightly stale price beats no quote at all.
    if (cached) return cached.usd;
    throw Object.assign(new Error(`Couldn't get the SOL price: ${(err as Error).message}`), { statusCode: 503 });
  }
}

/** A stake in USDC base units (1e-6 dollars) as lamports (1e-9 SOL) at `price` dollars per SOL, rounded up. */
export function lamportsFor(stakeBaseUnits: number, price: number): bigint {
  return BigInt(Math.ceil((stakeBaseUnits * 1_000) / price));
}
