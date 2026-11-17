import { AnchorProvider, BN, BorshCoder, EventParser, Program, type Idl } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import idlJson from "./idl/contour.json";
import type { Contour } from "./idl/contour";

export type { Contour };
export const IDL = idlJson as unknown as Contour;
export const PROGRAM_ID = new PublicKey(idlJson.address);
export { BN };

const enc = (s: string) => new TextEncoder().encode(s);
export const SEEDS = { config: enc("config"), position: enc("position"), vault: enc("vault"), limits: enc("limits") };

export function u64le(n: bigint | number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

export function configPda(programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([SEEDS.config], programId)[0];
}
export function positionPda(owner: PublicKey, nonce: bigint | number, programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([SEEDS.position, owner.toBytes(), u64le(nonce)], programId)[0];
}
export function vaultPda(position: PublicKey, programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([SEEDS.vault, position.toBytes()], programId)[0];
}
export function limitsPda(owner: PublicKey, programId = PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([SEEDS.limits, owner.toBytes()], programId)[0];
}
export function ata(mint: PublicKey, owner: PublicKey) {
  return getAssociatedTokenAddressSync(mint, owner, true);
}

export function hexToBytes32(hex: string): number[] {
  const clean = hex.replace(/^0x/, "");
  if (clean.length !== 64) throw new Error("expected 32-byte hex");
  return Array.from({ length: 32 }, (_, i) => parseInt(clean.slice(2 * i, 2 * i + 2), 16));
}
export const bytesToHex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** A read-only Program (no wallet) for fetching accounts and decoding. */
export function readonlyProgram(connection: Connection): Program<Contour> {
  const provider = new AnchorProvider(
    connection,
    { publicKey: PublicKey.default, signTransaction: async <T>(t: T) => t, signAllTransactions: async <T>(t: T) => t } as never,
    { commitment: "confirmed" },
  );
  return new Program<Contour>(IDL, provider);
}

export function programFor(provider: AnchorProvider): Program<Contour> {
  return new Program<Contour>(IDL, provider);
}

export interface OpenArgs {
  owner: PublicKey;
  usdcMint: PublicKey;
  nonce: bigint;
  marketIdHex: string;
  forecastHashHex: string;
  stakeBase: bigint | string;
  scheduleBase: (bigint | string)[];
  expiryTs: number;
}

export async function openPositionIx(program: Program<Contour>, a: OpenArgs): Promise<{ ix: TransactionInstruction; position: PublicKey }> {
  const position = positionPda(a.owner, a.nonce, program.programId);
  const ix = await program.methods
    .openPosition(
      new BN(a.nonce.toString()),
      hexToBytes32(a.marketIdHex),
      hexToBytes32(a.forecastHashHex),
      new BN(a.stakeBase.toString()),
      a.scheduleBase.map((s) => new BN(s.toString())),
      new BN(a.expiryTs),
    )
    .accountsPartial({
      owner: a.owner,
      config: configPda(program.programId),
      position,
      vault: vaultPda(position, program.programId),
      limits: limitsPda(a.owner, program.programId),
      ownerToken: ata(a.usdcMint, a.owner),
      usdcMint: a.usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  return { ix, position };
}

export async function cancelPositionIx(program: Program<Contour>, owner: PublicKey, position: PublicKey, usdcMint: PublicKey) {
  return program.methods
    .cancelPosition()
    .accountsPartial({
      owner,
      config: configPda(program.programId),
      position,
      vault: vaultPda(position, program.programId),
      ownerToken: ata(usdcMint, owner),
      usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function unwindPositionIx(program: Program<Contour>, caller: PublicKey, position: PublicKey, owner: PublicKey, desk: PublicKey, usdcMint: PublicKey) {
  return program.methods
    .unwindPosition()
    .accountsPartial({
      caller,
      config: configPda(program.programId),
      position,
      vault: vaultPda(position, program.programId),
      ownerToken: ata(usdcMint, owner),
      deskToken: ata(usdcMint, desk),
      usdcMint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export type PositionStateName = "open" | "active" | "settled" | "cancelled" | "unwound";
export function stateName(s: Record<string, unknown>): PositionStateName {
  return Object.keys(s)[0] as PositionStateName;
}

export interface DecodedEvent {
  name: string;
  data: Record<string, unknown>;
}

/** Decode Anchor events from transaction log lines ("Program data: ..."). */
export function decodeEvents(logs: string[], programId = PROGRAM_ID): DecodedEvent[] {
  const parser = new EventParser(programId, new BorshCoder(IDL as unknown as Idl));
  const out: DecodedEvent[] = [];
  for (const ev of parser.parseLogs(logs)) out.push({ name: ev.name, data: normalizeEventData(ev.data as Record<string, unknown>) });
  return out;
}

/** BN -> decimal string, PublicKey -> base58, byte arrays -> hex; plain JSON out. */
export function normalizeEventData(d: Record<string, unknown>): Record<string, unknown> {
  const conv = (v: unknown): unknown => {
    if (v instanceof BN) return v.toString();
    if (v instanceof PublicKey) return v.toBase58();
    if (Array.isArray(v)) {
      if (v.length === 32 && v.every((x) => typeof x === "number")) return bytesToHex(v as number[]);
      return v.map(conv);
    }
    if (v && typeof v === "object" && "toBase58" in (v as object)) return (v as PublicKey).toBase58();
    return v;
  };
  return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, conv(v)]));
}

export { TOKEN_PROGRAM_ID };
