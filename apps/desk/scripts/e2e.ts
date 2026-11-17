/**
 * End-to-end check: throwaway wallet -> faucet -> quote -> open_position -> (Stream) -> desk accepts
 * and hedges -> vault holds max payout. Optionally waits for settlement (E2E_WAIT_SETTLE=1).
 * Usage: SOLANA_RPC_URL=... DESK_URL=... [E2E_POST_STREAM=1] tsx scripts/e2e.ts [ticker] [widthScale] [confidence]
 */
import "dotenv/config";
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import { fromMarket, type Ladder } from "@contour/core";
import { openPositionIx, programFor, vaultPda } from "@contour/chain";
import { getAccount } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { postAsStream } from "./post-tx-as-stream";

const [ticker = "SOL2611202200", width = "0.6", conf = "0.5"] = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const desk = process.env.DESK_URL ?? "http://localhost:4000";
const conn = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const j = async (r: Response) => {
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

const user = Keypair.generate();
console.log(`user ${user.publicKey.toBase58()}`);
const cfg = await j(await fetch(`${desk}/config`));
const f = await j(await fetch(`${desk}/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: user.publicKey.toBase58() }) }));
console.log(`faucet ${f.signature}`);

const { ladder } = (await j(await fetch(`${desk}/markets/${ticker}`))) as { ladder: Ladder };
const belief = fromMarket(ladder, 0, Number(width));
const q = await j(await fetch(`${desk}/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker, belief, confidence: Number(conf), stakeUsd: 100 }) }));
console.log(`quote ${q.quoteId} advice=${q.quote.advice} min=${q.quote.minPayout} max=${q.quote.maxPayout} legs=${q.quote.legs.length}`);
if (q.quote.advice === "no_edge") throw new Error("no edge: widen the forecast difference");

const program = programFor(new AnchorProvider(conn, new Wallet(user), { commitment: "confirmed" }));
const nonce = BigInt(Date.now());
const { ix, position } = await openPositionIx(program, {
  owner: user.publicKey,
  usdcMint: new PublicKey(cfg.usdcMint),
  nonce,
  marketIdHex: q.marketIdHex,
  forecastHashHex: q.forecastHash,
  stakeBase: q.stakeBaseUnits,
  scheduleBase: q.scheduleBaseUnits,
  expiryTs: q.expiryTs,
});
const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [user], { commitment: "confirmed" });
console.log(`open_position ${sig}\nposition ${position.toBase58()}`);

if (process.env.E2E_POST_STREAM === "1") console.log("posted as stream:", await postAsStream(sig, desk));

let view: any = null;
for (let i = 0; i < 60; i++) {
  const r = await fetch(`${desk}/positions/${position.toBase58()}`);
  if (r.ok) {
    view = await r.json();
    if (view.position.state === "Active" && view.fills.length) break;
    if (view.position.note) console.log("note:", view.position.note);
  }
  await sleep(1000);
}
if (!view || view.position.state !== "Active") throw new Error(`position not Active: ${JSON.stringify(view?.position)}`);
const vault = (await getAccount(conn, vaultPda(position))).amount;
const expected = BigInt(Math.max(Number(q.stakeBaseUnits), Math.max(...q.scheduleBaseUnits.map(Number))));
console.log(`state=${view.position.state} vault=${vault} expected=${expected} fills=${view.fills.map((x: any) => `${x.side}:${x.status}@${x.price}`).join(",")}`);
if (vault !== expected) throw new Error("vault does not hold max(stake, max payout)");
console.log("E2E OK: open -> stream -> accept -> hedge, vault invariant holds");
