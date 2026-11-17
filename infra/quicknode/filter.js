// QuickNode Streams filter for Contour (Solana devnet, "block" dataset).
// Keeps only transactions whose account keys include the Contour program and returns
// { signature, slot, blockTime, logs } so the desk can decode Anchor events without any RPC call.
// Destination: webhook -> POST https://<desk-host>/hooks/quicknode (HMAC-signed with the Stream's security token).
const PROGRAM_ID = "BrTbVXVsKMNYQiAfRohLCK2tH5wSpEgwvc8TctWrVT7g";

function keysOf(tx) {
  const msg = (tx.transaction && tx.transaction.message) || {};
  const keys = (msg.accountKeys || msg.staticAccountKeys || []).map((k) => (typeof k === "string" ? k : k.pubkey));
  const loaded = (tx.meta && tx.meta.loadedAddresses) || {};
  return keys.concat(loaded.writable || [], loaded.readonly || []);
}

function main(stream) {
  const blocks = Array.isArray(stream.data) ? stream.data : [stream.data];
  const out = [];
  for (const block of blocks) {
    if (!block || !Array.isArray(block.transactions)) continue;
    for (const tx of block.transactions) {
      if (!tx || !tx.meta || tx.meta.err) continue;
      if (!keysOf(tx).includes(PROGRAM_ID)) continue;
      out.push({
        signature: tx.transaction.signatures[0],
        slot: block.slot !== undefined ? block.slot : block.parentSlot + 1,
        blockTime: block.blockTime,
        logs: tx.meta.logMessages || [],
      });
    }
  }
  return out.length ? out : null; // null = nothing delivered for this block
}
