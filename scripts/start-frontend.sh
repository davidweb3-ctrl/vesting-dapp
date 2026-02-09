#!/usr/bin/env bash
# start-frontend.sh — Start frontend for Devnet testing

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Checking if IDL is up to date..."
if [ -f "target/idl/anchor_vesting.json" ]; then
  if ! cmp -s "target/idl/anchor_vesting.json" "app/app/lib/program/idl.json"; then
    echo "⚠️  IDL file is outdated. Updating..."
    cp target/idl/anchor_vesting.json app/app/lib/program/idl.json
    echo "✅ IDL updated"
  else
    echo "✅ IDL is up to date"
  fi
else
  echo "⚠️  target/idl/anchor_vesting.json not found. Run 'anchor build' first."
fi

echo ""
echo "==> Installing frontend dependencies..."
cd app
if [ ! -d "node_modules" ]; then
  pnpm install
else
  echo "✅ Dependencies already installed"
fi

echo ""
echo "==> Starting Next.js dev server..."
echo "Frontend will be available at: http://localhost:3000"
echo ""
echo "Make sure:"
echo "  1. Your wallet is connected to Devnet"
echo "  2. You have Devnet SOL (get from https://faucet.solana.com)"
echo "  3. You have test tokens ready"
echo ""
pnpm dev
