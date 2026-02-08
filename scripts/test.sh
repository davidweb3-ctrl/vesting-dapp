#!/usr/bin/env bash
# test.sh — Run all tests against a local Solana test validator.
#
# Workaround: Anchor 0.32.1 hardcodes --bind-address 0.0.0.0, which is rejected
# by Solana CLI 3.x (agave-validator). We start the validator manually with
# --bind-address 127.0.0.1 instead.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ANCHOR_PROGRAM_ID="BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4"
PINOCCHIO_PROGRAM_ID="EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk"

# ──────────────────────────────────────────────
# 1. Build programs
# ──────────────────────────────────────────────
echo "==> Building Anchor program..."
anchor build

echo "==> Building Pinocchio program..."
(cd pinocchio-vesting && cargo build-sbf)

# ──────────────────────────────────────────────
# 2. Start test validator
# ──────────────────────────────────────────────
echo "==> Starting test validator..."
solana-test-validator \
  --bind-address 127.0.0.1 \
  --rpc-port 8899 \
  --ledger .anchor/test-ledger \
  --reset \
  --bpf-program "$ANCHOR_PROGRAM_ID" target/deploy/anchor_vesting.so \
  --bpf-program "$PINOCCHIO_PROGRAM_ID" pinocchio-vesting/target/deploy/pinocchio_vesting.so \
  --quiet &
VALIDATOR_PID=$!
trap "kill $VALIDATOR_PID 2>/dev/null" EXIT

# Wait for RPC to become available
echo "==> Waiting for validator..."
for i in $(seq 1 30); do
  if solana balance --url http://127.0.0.1:8899 &>/dev/null; then
    echo "    Validator ready (slot $i)"
    break
  fi
  sleep 1
done

# ──────────────────────────────────────────────
# 3. Run tests
# ──────────────────────────────────────────────
echo "==> Running tests..."
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
pnpm exec ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.test.ts"

echo "==> All done!"
