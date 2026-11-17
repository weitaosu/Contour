/**
 * One-time chain setup for a cluster (localnet or devnet):
 *  - test USDC mint (6 decimals, mint authority = admin), keypair kept in keys/usdc-mint.json
 *  - SOL for the desk and oracle wallets (from admin)
 *  - desk USDC balance for collateral
 *  - initialize (or update) the program Config
 * Usage: SOLANA_RPC_URL=... pnpm --filter @contour/desk exec tsx scripts/setup-chain.ts [--grace 86400] [--accept 300]
 */
import "dotenv/config";
import { AnchorProvider, BN, Wallet } from "@anchor-lang/core";
import { configPda, programFor, ata, PROGRAM_ID } from "@contour/chain";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const arg = (name: string, d: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const load = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(root, "keys", f), "utf8"))));

const rpc = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const conn = new Connection(rpc, "confirmed");
const admin = load("admin.json");
const desk = load("desk.json");
const oracle = load("oracle.json");
const mintPath = resolve(root, "keys", "usdc-mint.json");
if (!existsSync(mintPath)) writeFileSync(mintPath, JSON.stringify(Array.from(Keypair.generate().secretKey)));
const mintKp = load("usdc-mint.json");
const mint = mintKp.publicKey;

console.log(`cluster ${rpc}\nprogram ${PROGRAM_ID.toBase58()}\nadmin ${admin.publicKey.toBase58()} (${(await conn.getBalance(admin.publicKey)) / LAMPORTS_PER_SOL} SOL)`);

// 1. Mint
if (!(await conn.getAccountInfo(mint))) {
  const lamports = await getMinimumBalanceForRentExemptMint(conn);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint, space: MINT_SIZE, lamports, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint, 6, admin.publicKey, null),
  );
  await sendAndConfirmTransaction(conn, tx, [admin, mintKp]);
  console.log(`created test USDC mint ${mint.toBase58()}`);
} else console.log(`test USDC mint ${mint.toBase58()}`);

// 2. SOL for desk and oracle
for (const [name, kp, min] of [["desk", desk, 0.3], ["oracle", oracle, 0.05]] as const) {
  const bal = (await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL;
  if (bal < min) {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: kp.publicKey, lamports: Math.round((min * 2 - bal) * LAMPORTS_PER_SOL) }));
    await sendAndConfirmTransaction(conn, tx, [admin]);
  }
  console.log(`${name} ${kp.publicKey.toBase58()} ${(await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL} SOL`);
}

// 3. Desk collateral
const deskAta = ata(mint, desk.publicKey);
{
  const tx = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, deskAta, desk.publicKey, mint));
  let bal = 0;
  try {
    bal = Number((await conn.getTokenAccountBalance(deskAta)).value.uiAmount ?? 0);
  } catch {}
  if (bal < 100_000) tx.add(createMintToInstruction(mint, deskAta, admin.publicKey, BigInt(1_000_000) * 1_000_000n));
  await sendAndConfirmTransaction(conn, tx, [admin]);
  console.log(`desk USDC ${(await conn.getTokenAccountBalance(deskAta)).value.uiAmount}`);
}

// 4. Config
const program = programFor(new AnchorProvider(conn, new Wallet(admin), { commitment: "confirmed" }));
const params = {
  desk: desk.publicKey,
  oracle: oracle.publicKey,
  acceptTimeoutSecs: new BN(arg("accept", 300)),
  settleGraceSecs: new BN(arg("grace", 86_400)),
  maxStake: new BN(arg("max-stake", 500) * 1e6),
  maxDailyStake: new BN(arg("max-daily", 2_000) * 1e6),
};
const cfg = configPda();
if (!(await conn.getAccountInfo(cfg))) {
  const sig = await program.methods.initialize(params).accountsPartial({ admin: admin.publicKey, config: cfg, usdcMint: mint }).rpc();
  console.log(`initialized config ${cfg.toBase58()}: ${sig}`);
} else {
  const sig = await program.methods.updateConfig(params).accountsPartial({ admin: admin.publicKey, config: cfg }).rpc();
  console.log(`updated config ${cfg.toBase58()}: ${sig}`);
}
console.log(`\nAdd to apps/desk/.env:\nUSDC_MINT=${mint.toBase58()}\nPROGRAM_ID=${PROGRAM_ID.toBase58()}\nAdd to apps/web/.env.local:\nNEXT_PUBLIC_USDC_MINT=${mint.toBase58()}`);
