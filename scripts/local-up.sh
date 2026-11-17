#!/bin/sh
# One-command local environment: a Solana test validator with the Contour program preloaded,
# fresh devnet-style keys, a test USDC mint, desk collateral, program Config, and env files.
# Needs only the Solana CLI (no Rust/Anchor, no devnet SOL, no accounts). Then run:
#   pnpm dev:desk:local     and     pnpm dev:web:local
set -e
cd "$(dirname "$0")/.."
ROOT=$(pwd)
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
command -v solana-test-validator >/dev/null || { echo "Install the Solana CLI first: https://solana.com/docs/intro/installation"; exit 1; }

PROGRAM_ID=$(node -e "console.log(require('./packages/chain/src/idl/contour.json').address)")
SO="target/deploy/contour.so"; [ -f "$SO" ] || SO="programs/contour/build/contour.so"
RPC=http://127.0.0.1:8899

mkdir -p keys data
for k in admin desk oracle; do [ -f keys/$k.json ] || solana-keygen new --no-bip39-passphrase -s -o keys/$k.json >/dev/null; done

if ! curl -s $RPC -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q ok; then
  echo "starting solana-test-validator (ledger: data/test-ledger, log: data/validator.log)"
  nohup solana-test-validator --reset --ledger data/test-ledger --bpf-program "$PROGRAM_ID" "$SO" --quiet > data/validator.log 2>&1 &
  for i in $(seq 1 60); do
    curl -s $RPC -X POST -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | grep -q ok && break
    sleep 1
  done
fi
solana -u localhost airdrop 100 "$(solana-keygen pubkey keys/admin.json)" >/dev/null
(cd apps/desk && SOLANA_RPC_URL=$RPC pnpm exec tsx scripts/setup-chain.ts --grace 600 --accept 300 | grep -E "mint|config|desk|oracle")
MINT=$(solana-keygen pubkey keys/usdc-mint.json)

cat > apps/desk/.env.localnet <<ENV
PORT=4000
WEB_ORIGIN=http://localhost:3000
DB_PATH=$ROOT/data/desk-localnet.sqlite
EXECUTION_MODE=paper
ALLOW_LIVE_ORDERS=false
SOLANA_RPC_URL=$RPC
PROGRAM_ID=$PROGRAM_ID
USDC_MINT=$MINT
DESK_KEYPAIR_PATH=$ROOT/keys/desk.json
ORACLE_KEYPAIR_PATH=$ROOT/keys/oracle.json
MINT_AUTHORITY_KEYPAIR_PATH=$ROOT/keys/admin.json
QUICKNODE_STREAM_TOKEN=local-test-token
LOCAL_EVENT_SOURCE=websocket
CATEGORICAL_ALLOWLIST=DEMNOM2028,REPNOM2028
ENV
cat > apps/web/.env.localnet <<ENV
NEXT_PUBLIC_DESK_URL=http://localhost:4000
NEXT_PUBLIC_SOLANA_RPC_URL=$RPC
NEXT_PUBLIC_PROGRAM_ID=$PROGRAM_ID
NEXT_PUBLIC_USDC_MINT=$MINT
ENV
echo
echo "Local chain ready: program $PROGRAM_ID, test USDC $MINT"
echo "Next:  pnpm dev:desk:local   (http://localhost:4000)"
echo "       pnpm dev:web:local    (http://localhost:3000)"
echo "Check: pnpm e2e:local        (opens, accepts and hedges a position end to end)"
