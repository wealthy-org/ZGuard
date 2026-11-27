#!/usr/bin/env bash
# Perm mainnet-mode end-to-end rehearsal on a local anvil fork of Robinhood Chain 4663.
#
#   web app (NEXT_PUBLIC_PERM_CHAIN_ID=4663, allowlisted-mainnet, remote signer)
#     → services/quote-signer over HTTPS + bearer token
#     → PermRouter (deployed on the fork) → Uniswap v4 pool → SwapSettled → /api/receipts
#
# Nothing touches real mainnet: every key here is an ephemeral or public Hardhat/anvil test key and every
# tx hash is fork-only (written to *.rehearsal.json, which is gitignored).
#
# Requirements: anvil (Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup), openssl, pnpm deps.
# Usage:        bash scripts/mainnet/fork-e2e.sh            # routing mode v4 (fits the RPC state window)
#               SMOKE_ROUTING_MODE=best bash scripts/mainnet/fork-e2e.sh
#
# Extra mainnet venues — one fresh fork per run (the public RPC only serves ~7–10 min of state, so a single
# fork cannot outlive several cold quotes):
#   SMOKE_ROUTING_MODE=v3    SMOKE_TOKEN=AMZN bash scripts/mainnet/fork-e2e.sh   # ETH → USDG → AMZN (USDG hub)
#   SMOKE_ROUTING_MODE=v2    SMOKE_TOKEN=SPY  bash scripts/mainnet/fork-e2e.sh   # ETH → USDG → SPY (Uniswap V2)
#   SMOKE_ROUTING_MODE=hooks SMOKE_TOKEN=NVDA bash scripts/mainnet/fork-e2e.sh   # ETH → WETH → NVDA (Aggregator Hook)
# The app reads hook pools from deployments/robinhood-mainnet.json, so the fork manifest is swapped in for
# the duration of the run and the committed placeholder is restored on exit.
#
# Why v4 by default: the public RPC is not an archive node (≈4–6k blocks ≈ 7–10 min of state) and rate-limits
# (HTTP 429). A cold fork serves `best` discovery (~140 v3 getPool + quoter calls) too slowly for the 90 s quote
# TTL, so the signer correctly rejects it as expired. Against the real RPC the same quote takes ~3 s.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd)
WORK=$(mktemp -d)
FORK_RPC=${FORK_RPC:-https://rpc.mainnet.chain.robinhood.com}
ANVIL=${ANVIL:-$(command -v anvil || echo "$HOME/.foundry/bin/anvil")}
PIDS=()
MAINNET_MANIFEST=deployments/robinhood-mainnet.json
cleanup() {
  # npx/next/anvil spawn children; kill each whole tree so no orphan keeps :8545/:3100/:8787 bound.
  # anvil can ignore SIGTERM while it waits on the upstream RPC, so survivors get SIGKILL.
  ALL=()
  collect() { local child; ALL+=("$1"); for child in $(pgrep -P "$1" 2>/dev/null); do collect "$child"; done; }
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && collect "$pid"; done
  for pid in "${ALL[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  sleep 2
  for pid in "${ALL[@]:-}"; do kill -9 "$pid" 2>/dev/null || true; done
  [ -f "$WORK/manifest.backup.json" ] && cp "$WORK/manifest.backup.json" "$MAINNET_MANIFEST"
  rm -rf "$WORK"
}
trap cleanup EXIT

# Public anvil/Hardhat accounts — fork only.
DEPLOYER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
WALLET=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
WALLET_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
TREASURY=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

for port in 8545 8787 3100; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    echo "✗ port $port is already in use (orphan anvil/signer/app from an earlier run?). Find it with: ss -ltnp | grep :$port" >&2
    exit 1
  fi
done

echo "› ephemeral signer key + self-signed TLS"
eval "$(node -e 'const {generatePrivateKey,privateKeyToAccount}=require("viem/accounts");const k=generatePrivateKey();console.log(`SIGNER_KEY=${k}\nSIGNER_ADDRESS=${privateKeyToAccount(k).address}\nSIGNER_TOKEN=${require("crypto").randomBytes(32).toString("hex")}`)')"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$WORK/key.pem" -out "$WORK/cert.pem" -days 1 \
  -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" >/dev/null 2>&1

echo "› anvil fork of $FORK_RPC"
"$ANVIL" --fork-url "$FORK_RPC" --chain-id 4663 --block-time 2 --host 127.0.0.1 --port 8545 \
  --compute-units-per-second 600 --retries 10 --fork-retry-backoff 1500 --timeout 30000 --silent &
PIDS+=($!)
for _ in $(seq 1 30); do
  curl -sf -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 >/dev/null && break
  sleep 1
done

echo "› deploy PermRouter + adapters on the fork"
MANIFEST_OUT=deployments/robinhood-mainnet.e2e.rehearsal.json
RUN_MAINNET_FORK_TESTS=1 MAINNET_DEPLOY_REHEARSAL=1 QUOTE_SIGNER_ADDRESS=$SIGNER_ADDRESS TREASURY_ADDRESS=$TREASURY \
  DEPLOYMENT_OUTPUT=$MANIFEST_OUT npx hardhat run contracts/scripts/deploy-mainnet.cjs --network localhost \
  | grep -E "PermRouter |PermV.Adapter |PermWethAdapter |configureAdapter|setVerifiedHook|configureHookProvider|Error"
read -r ROUTER V4 V3 V2 WETHA BLOCK < <(node -e 'const m=require("./'"$MANIFEST_OUT"'");console.log(m.permRouter,m.v4Adapter,m.v3Adapter,m.v2Adapter||"",m.wethAdapter||"",m.deploymentBlock)')
cp "$MAINNET_MANIFEST" "$WORK/manifest.backup.json"
cp "$MANIFEST_OUT" "$MAINNET_MANIFEST"   # restored by cleanup()

echo "› remote quote signer (HTTPS :8787)"
SIGNER_PRIVATE_KEY=$SIGNER_KEY PERM_QUOTE_SIGNER_TOKEN=$SIGNER_TOKEN SIGNER_CHAIN_ID=4663 SIGNER_ROUTER_ADDRESS=$ROUTER \
  SIGNER_EXPECTED_ADDRESS=$SIGNER_ADDRESS SIGNER_ACCOUNT_ALLOWLIST=$WALLET SIGNER_MAX_AMOUNT_IN_WEI=50000000000000000 \
  TLS_CERT_FILE=$WORK/cert.pem TLS_KEY_FILE=$WORK/key.pem HOST=127.0.0.1 PORT=8787 \
  node services/quote-signer/server.mjs > "$WORK/signer.log" 2>&1 &
PIDS+=($!)

echo "› web app in mainnet mode (:3100)"
env -u SIGNER_KEY \
  NEXT_PUBLIC_PERM_CHAIN_ID=4663 RH_MAINNET_RPC_URL=http://127.0.0.1:8545 \
  NEXT_PUBLIC_PERM_ROUTER_ADDRESS=$ROUTER NEXT_PUBLIC_PERM_V4_ADAPTER_ADDRESS=$V4 NEXT_PUBLIC_PERM_V3_ADAPTER_ADDRESS=$V3 \
  NEXT_PUBLIC_PERM_ROUTER_VERSION=2 NEXT_PUBLIC_PERM_DEPLOYMENT_BLOCK=$BLOCK \
  NEXT_PUBLIC_PERM_V2_ADAPTER_ADDRESS=$V2 NEXT_PUBLIC_PERM_WETH_ADAPTER_ADDRESS=$WETHA \
  PERM_MAINNET_ENABLE_UNISWAP_V2=1 NEXT_PUBLIC_PERM_ENABLE_UNISWAP_V2=1 \
  PERM_MAINNET_ENABLE_AGGREGATOR_HOOKS=1 NEXT_PUBLIC_PERM_ENABLE_AGGREGATOR_HOOKS=1 \
  PERM_EXECUTION_MODE=allowlisted-mainnet NEXT_PUBLIC_PERM_EXECUTION_MODE=allowlisted-mainnet \
  PERM_STAGING_CHAIN_ID=4663 PERM_STAGING_WALLET_ALLOWLIST=$WALLET \
  PERM_QUOTE_SIGNER_MODE=remote QUOTE_SIGNER_ADDRESS=$SIGNER_ADDRESS PERM_QUOTE_SIGNER_URL=https://127.0.0.1:8787/sign \
  PERM_QUOTE_SIGNER_TOKEN=$SIGNER_TOKEN NODE_TLS_REJECT_UNAUTHORIZED=0 \
  npx next dev -H 127.0.0.1 -p 3100 > "$WORK/app.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:3100/ && break; sleep 1; done

echo "› warm-up quote"
curl -s -m 300 -o /dev/null -w "  HTTP %{http_code} in %{time_total}s\n" -X POST http://127.0.0.1:3100/api/quote \
  -H 'content-type: application/json' \
  -d '{"tokenIn":"ETH","tokenOut":"'"${SMOKE_TOKEN:-NVDA}"'","amountIn":"1000000000000000","slippageBps":100,"account":"'"$WALLET"'","recipient":"'"$WALLET"'","routingMode":"'"${SMOKE_ROUTING_MODE:-v4}"'"}' || true

echo "› smoke swap"
PERM_APP_URL=http://127.0.0.1:3100 RH_MAINNET_RPC_URL=http://127.0.0.1:8545 MANIFEST=$MANIFEST_OUT \
  SMOKE_PRIVATE_KEY=$WALLET_KEY SMOKE_ROUTING_MODE=${SMOKE_ROUTING_MODE:-v4} SMOKE_TOKEN=${SMOKE_TOKEN:-NVDA} CONFIRM_MAINNET=1 \
  SMOKE_OUTPUT=deployments/mainnet/smoke-test.${SMOKE_ROUTING_MODE:-v4}-${SMOKE_TOKEN:-NVDA}.fork.rehearsal.json \
  npx tsx scripts/mainnet/smoke-swap.ts || { echo "--- signer log"; tail -5 "$WORK/signer.log"; echo "--- app log"; tail -20 "$WORK/app.log"; exit 1; }

echo "› admin status on the fork"
RUN_MAINNET_FORK_TESTS=1 MANIFEST=$MANIFEST_OUT ACTION=status npx hardhat run contracts/scripts/mainnet-admin.cjs --network localhost
echo "✓ fork E2E passed (deployer $DEPLOYER is the fork owner; nothing was sent to mainnet)"
