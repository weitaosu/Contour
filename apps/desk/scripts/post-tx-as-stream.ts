/**
 * Test tool (not a fallback): fetch a real transaction and POST it to the desk webhook in the same
 * shape our QuickNode Stream filter emits, signed the way QuickNode signs. Used for local testing
 * before the Stream exists. Usage: tsx scripts/post-tx-as-stream.ts <signature> [deskUrl]
 */
import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";
import { Connection } from "@solana/web3.js";

export async function postAsStream(signature: string, url = "http://localhost:4000") {
  const token = process.env.QUICKNODE_STREAM_TOKEN;
  if (!token) throw new Error("QUICKNODE_STREAM_TOKEN is not set");
  const conn = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  let tx = null;
  for (let i = 0; i < 20 && !tx; i++) {
    tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!tx) await new Promise((r) => setTimeout(r, 500));
  }
  if (!tx) throw new Error(`transaction ${signature} not found`);
  const body = JSON.stringify([{ signature, slot: tx.slot, blockTime: tx.blockTime, logs: tx.meta?.logMessages ?? [] }]);
  const nonce = randomUUID();
  const ts = Math.floor(Date.now() / 1000).toString();
  const res = await fetch(`${url}/hooks/quicknode`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-qn-nonce": nonce, "x-qn-timestamp": ts, "x-qn-signature": createHmac("sha256", token!).update(nonce + ts + body).digest("hex") },
    body,
  });
  return { status: res.status, body: await res.text() };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [sig, deskUrl = "http://localhost:4000"] = process.argv.slice(2);
  if (!sig) throw new Error("usage: tsx scripts/post-tx-as-stream.ts <signature> [deskUrl]");
  console.log(await postAsStream(sig, deskUrl));
}
