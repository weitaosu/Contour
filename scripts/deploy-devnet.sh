#!/bin/sh
# Deploy the Contour program to Solana devnet and set up the test USDC mint, desk wallets and Config.
# Needs ~3 devnet SOL on keys/admin.json (https://faucet.solana.com). Program keypair: keys/program.json.
set -e
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$HOME/.avm/bin:$PATH"
ADMIN=$(solana-keygen pubkey keys/admin.json)
echo "admin $ADMIN: $(solana -u devnet balance "$ADMIN")"
solana program deploy -u devnet --keypair keys/admin.json --program-id keys/program.json target/deploy/contour.so
cd apps/desk
SOLANA_RPC_URL=https://api.devnet.solana.com pnpm exec tsx scripts/setup-chain.ts --grace "${GRACE:-3600}" --accept 300
