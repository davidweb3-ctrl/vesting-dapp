#!/usr/bin/env bash
# deploy-devnet.sh — Deploy contracts to Solana Devnet

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ANCHOR_PROGRAM_ID="BB1JtUxXtmDnb6L5qXUSfuvT18TggYuSLBzfmjoYFnb4"
PINOCCHIO_PROGRAM_ID="EzRUZpW3CsvnKzEUiF7fAPHyHWsv2D3ERR482BPKHwYk"

echo "==> Checking Solana CLI config..."
solana config get

echo ""
echo "==> Checking wallet balance..."
BALANCE=$(solana balance --output json | jq -r '.balance')
echo "Balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 2" | bc -l) )); then
  echo "⚠️  Balance is low. Requesting airdrop..."
  solana airdrop 2 || echo "⚠️  Airdrop failed (rate limited). Please get SOL manually:"
  echo "   solana airdrop 2"
  echo "   or visit: https://faucet.solana.com"
  echo ""
  echo "Press Enter to continue after getting SOL, or Ctrl+C to cancel..."
  read
fi

echo ""
echo "==> Building Anchor program..."
anchor build

echo ""
echo "==> Deploying Anchor program to Devnet..."
anchor deploy --provider.cluster devnet

echo ""
echo "==> Building Pinocchio program..."
(cd pinocchio-vesting && cargo build-sbf)

echo ""
echo "==> Deploying Pinocchio program to Devnet..."
solana program deploy \
  --program-id pinocchio-vesting/target/deploy/pinocchio_vesting-keypair.json \
  pinocchio-vesting/target/deploy/pinocchio_vesting.so \
  --url devnet

echo ""
echo "==> Verifying deployments..."
echo "Anchor Program:"
solana program show "$ANCHOR_PROGRAM_ID" --url devnet || echo "⚠️  Anchor program not found"

echo ""
echo "Pinocchio Program:"
solana program show "$PINOCCHIO_PROGRAM_ID" --url devnet || echo "⚠️  Pinocchio program not found"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Program IDs:"
echo "  Anchor:    $ANCHOR_PROGRAM_ID"
echo "  Pinocchio: $PINOCCHIO_PROGRAM_ID"
