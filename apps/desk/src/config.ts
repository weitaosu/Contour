import "dotenv/config";
import { executionMode } from "@contour/gemini/signed";

const list = (v: string | undefined, d: string[]) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d);

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  webOrigin: list(process.env.WEB_ORIGIN, ["http://localhost:3000"]),
  geminiBase: process.env.GEMINI_API_BASE ?? "https://api.gemini.com",
  executionMode: executionMode(),
  /** Gemini categories to list; "*" (the default) means every category Gemini has. */
  marketCategories: list(process.env.MARKET_CATEGORIES, ["*"]),
  categoricalAllowlist: list(process.env.CATEGORICAL_ALLOWLIST, []),
  quoteTtlMs: 30_000,
  acceptMaxQuoteAgeMs: 60_000,
  maxRepriceOverStake: 0.01,
  recorderEnabled: process.env.RECORDER_ENABLED === "true",
  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  programId: process.env.PROGRAM_ID ?? "",
  usdcMint: process.env.USDC_MINT ?? "",
  deskKeypairPath: process.env.DESK_KEYPAIR_PATH ?? "../../keys/desk.json",
  oracleKeypairPath: process.env.ORACLE_KEYPAIR_PATH ?? "../../keys/oracle.json",
  mintAuthorityKeypairPath: process.env.MINT_AUTHORITY_KEYPAIR_PATH ?? "../../keys/admin.json",
  quicknodeToken: process.env.QUICKNODE_STREAM_TOKEN ?? "",
  faucetEnabled: (process.env.FAUCET_ENABLED ?? "true") === "true",
  schedulerEnabled: (process.env.SCHEDULER_ENABLED ?? "true") === "true",
};
