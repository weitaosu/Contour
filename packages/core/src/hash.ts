import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

/** Canonical JSON: object keys sorted recursively, no whitespace, ES number formatting. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite number in canonical JSON");
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  throw new Error(`unsupported value in canonical JSON: ${typeof value}`);
}

export function sha256Hex(s: string): string {
  return bytesToHex(sha256(utf8ToBytes(s)));
}

export function sha256Bytes(s: string): Uint8Array {
  return sha256(utf8ToBytes(s));
}

export interface ForecastPreimage {
  ticker: string;
  marketProb: number[];
  belief: number[];
  confidence: number;
  quoteId: string;
  capturedAt: string;
  /** Holding strategies only (floor / collar / covered call). Absent keys are skipped, so older hashes are unchanged. */
  protect?: { units: number; floor?: number; cap?: number };
  /** Spread quotes only. */
  spread?: { direction: "up" | "down"; from: number; to: number };
}

export function forecastHash(pre: ForecastPreimage): string {
  return sha256Hex(canonicalJson(pre));
}

/** market_id on-chain = sha256(event ticker). */
export function marketIdHex(ticker: string): string {
  return sha256Hex(ticker);
}
