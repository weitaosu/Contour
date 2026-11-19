export const env = {
  deskUrl: process.env.NEXT_PUBLIC_DESK_URL ?? "http://localhost:4000",
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  programId: process.env.NEXT_PUBLIC_PROGRAM_ID ?? "",
  usdcMint: process.env.NEXT_PUBLIC_USDC_MINT ?? "",
  githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com",
};

/** Which Solana network the app is pointed at, read from its RPC address (not assumed). */
export const network: "localnet" | "devnet" | "mainnet" = /127\.0\.0\.1|localhost/.test(env.rpcUrl)
  ? "localnet"
  : /mainnet/.test(env.rpcUrl)
    ? "mainnet"
    : "devnet";
export const networkName = network === "localnet" ? "the local validator" : network;
export const networkLabel = network === "localnet" ? "Local Solana validator" : network === "mainnet" ? "Solana mainnet" : "Solana devnet";

// Explorer links for the network in use: a local validator through the explorer's custom-RPC mode.
const clusterQuery =
  network === "localnet" ? `cluster=custom&customUrl=${encodeURIComponent(env.rpcUrl)}` : network === "mainnet" ? "" : "cluster=devnet";
export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}${clusterQuery ? `?${clusterQuery}` : ""}`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}${clusterQuery ? `?${clusterQuery}` : ""}`;
