#!/usr/bin/env bash
# AURA ERC-7857 secure-transfer DEMO runner.
# Starts a local anvil, runs the REAL on-chain demo (server/src/scripts/demo-secure-transfer.ts)
# against it, then tears anvil down. Network-free except for localhost; touches NO real chain.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_PORT="${RPC_PORT:-8545}"
RPC_URL="http://127.0.0.1:${RPC_PORT}"

echo "[demo] building contracts (forge)…"
( cd "$REPO_ROOT/contracts" && forge build >/dev/null )

echo "[demo] starting anvil on :${RPC_PORT}…"
anvil --port "$RPC_PORT" --silent &
ANVIL_PID=$!
cleanup() { kill "$ANVIL_PID" 2>/dev/null || true; }
trap cleanup EXIT

# wait for anvil to answer eth_chainId
for i in $(seq 1 50); do
  if curl -s "$RPC_URL" -H 'content-type: application/json' \
       -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' 2>/dev/null | grep -q result; then
    break
  fi
  sleep 0.1
done

echo "[demo] running the real secure-transfer demo…"
cd "$REPO_ROOT/server"
RPC_URL="$RPC_URL" npx tsx src/scripts/demo-secure-transfer.ts
