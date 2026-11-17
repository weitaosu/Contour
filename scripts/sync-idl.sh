#!/bin/sh
# Copy the Anchor IDL and generated types into packages/chain (committed, so web/desk build without Rust).
set -e
cd "$(dirname "$0")/.."
cp target/idl/contour.json packages/chain/src/idl/contour.json
cp target/types/contour.ts packages/chain/src/idl/contour.ts
echo "IDL synced: $(node -e "console.log(require('./packages/chain/src/idl/contour.json').address)")"
