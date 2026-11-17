import { AnchorProvider, BN, Wallet, type Program } from "@anchor-lang/core";
import {
  ata,
  configPda,
  programFor,
  vaultPda,
  stateName,
  type Contour,
} from "@contour/chain";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config";

export function loadKeypair(path: string): Keypair {
  const p = resolve(process.cwd(), path);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
}

export class DeskChain {
  connection: Connection;
  desk: Keypair;
  oracle: Keypair;
  mintAuthority: Keypair | null;
  usdcMint: PublicKey;
  deskProgram: Program<Contour>;
  oracleProgram: Program<Contour>;

  constructor() {
    if (!config.usdcMint) throw new Error("USDC_MINT is not set");
    this.connection = new Connection(config.solanaRpcUrl, "confirmed");
    this.desk = loadKeypair(config.deskKeypairPath);
    this.oracle = loadKeypair(config.oracleKeypairPath);
    this.mintAuthority = existsSync(resolve(process.cwd(), config.mintAuthorityKeypairPath)) ? loadKeypair(config.mintAuthorityKeypairPath) : null;
    this.usdcMint = new PublicKey(config.usdcMint);
    const opts = { commitment: "confirmed" as const };
    this.deskProgram = programFor(new AnchorProvider(this.connection, new Wallet(this.desk), opts));
    this.oracleProgram = programFor(new AnchorProvider(this.connection, new Wallet(this.oracle), opts));
  }

  async fetchPosition(position: PublicKey) {
    const p = await this.deskProgram.account.position.fetch(position);
    return {
      owner: p.owner.toBase58(),
      nonce: p.nonce.toString(),
      stake: p.stake.toString(),
      schedule: p.schedule.map((x: BN) => x.toString()),
      maxPayout: p.maxPayout.toString(),
      openedTs: Number(p.openedTs.toString()),
      expiryTs: Number(p.expiryTs.toString()),
      state: stateName(p.state as Record<string, unknown>),
      outcomeBucket: p.outcomeBucket,
      scoreBps: p.scoreBps,
      forecastHash: Buffer.from(p.forecastHash).toString("hex"),
      marketId: Buffer.from(p.marketId).toString("hex"),
    };
  }

  async vaultBalance(position: PublicKey): Promise<bigint> {
    try {
      return (await getAccount(this.connection, vaultPda(position))).amount;
    } catch {
      return 0n;
    }
  }

  async accept(position: PublicKey): Promise<string> {
    return this.deskProgram.methods
      .acceptPosition()
      .accountsPartial({
        desk: this.desk.publicKey,
        config: configPda(),
        position,
        vault: vaultPda(position),
        deskToken: ata(this.usdcMint, this.desk.publicKey),
        usdcMint: this.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async settle(position: PublicKey, owner: PublicKey, bucket: number, scoreBps: number): Promise<string> {
    // Make sure the owner's token account exists (it does if they deposited from it).
    return this.oracleProgram.methods
      .settlePosition(bucket, scoreBps)
      .accountsPartial({
        oracle: this.oracle.publicKey,
        config: configPda(),
        position,
        vault: vaultPda(position),
        ownerToken: ata(this.usdcMint, owner),
        deskToken: ata(this.usdcMint, this.desk.publicKey),
        usdcMint: this.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async unwind(position: PublicKey, owner: PublicKey): Promise<string> {
    return this.deskProgram.methods
      .unwindPosition()
      .accountsPartial({
        caller: this.desk.publicKey,
        config: configPda(),
        position,
        vault: vaultPda(position),
        ownerToken: ata(this.usdcMint, owner),
        deskToken: ata(this.usdcMint, this.desk.publicKey),
        usdcMint: this.usdcMint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  /** Devnet faucet: a little SOL for fees from the desk wallet and test USDC minted to the owner's ATA. */
  async faucet(owner: PublicKey, usdc = 1_000, sol = 0.05): Promise<string> {
    if (!this.mintAuthority) throw new Error("faucet unavailable: no mint authority key on this desk");
    const ownerAta = ata(this.usdcMint, owner);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(this.desk.publicKey, ownerAta, owner, this.usdcMint),
      createMintToInstruction(this.usdcMint, ownerAta, this.mintAuthority.publicKey, BigInt(Math.round(usdc * 1e6))),
    );
    const bal = await this.connection.getBalance(owner);
    if (bal < 0.02 * LAMPORTS_PER_SOL) {
      tx.add(SystemProgram.transfer({ fromPubkey: this.desk.publicKey, toPubkey: owner, lamports: Math.round(sol * LAMPORTS_PER_SOL) }));
    }
    const signers = [this.desk, this.mintAuthority].filter((k, i, a) => a.findIndex((x) => x.publicKey.equals(k.publicKey)) === i);
    return sendAndConfirmTransaction(this.connection, tx, signers, { commitment: "confirmed" });
  }
}

let instance: DeskChain | null | undefined;
/** Null when chain config (program, mint, keys) is not available; the desk still serves markets and quotes. */
export function getChain(): DeskChain | null {
  if (instance !== undefined) return instance;
  try {
    instance = new DeskChain();
  } catch (err) {
    console.warn("[chain] disabled:", (err as Error).message);
    instance = null;
  }
  return instance;
}
