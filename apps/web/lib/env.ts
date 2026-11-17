export const env = {
  deskUrl: process.env.NEXT_PUBLIC_DESK_URL ?? "http://localhost:4000",
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  programId: process.env.NEXT_PUBLIC_PROGRAM_ID ?? "",
  usdcMint: process.env.NEXT_PUBLIC_USDC_MINT ?? "",
  cluster: "devnet" as const,
  githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL ?? "https://github.com",
};

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
