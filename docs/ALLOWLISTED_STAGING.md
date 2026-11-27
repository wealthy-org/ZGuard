# Allowlisted Router-v2 staging

This path exists only to make real Router-v2 swaps usable on Robinhood Chain testnet before production infrastructure is available. It is **not a release**, is not a public demo, and does not satisfy remote-custody, fallback-RPC, indexer, shared-rate-limit, alerting, WalletConnect, governance, assurance, or green-CI release gates.

The official `deployments/robinhood-testnet.json` manifest remains the release boundary. A staging deployment must keep `executionReady: false` and must never be promoted with `scripts/promote-deployment.cjs`.

The current deployment's public, credential-free record is committed as `deployments/robinhood-testnet.v2-staging.json`. A feature-by-feature status and blocker map is maintained in `docs/GAP_20NOV_CLOSURE.md`. The manifest publishes contract addresses, runtime codehashes, exact-match Blockscout source links, role concentration, direct-provider identities, and canonical staging evidence. It deliberately excludes private keys, wallet allowlists, signatures, database/RPC credentials, and webhook or WalletConnect configuration. Run `pnpm staging:test-public-manifest` after every update. The ignored `deployments/robinhood-testnet.staging.json` and `.staging/` files remain local operational artifacts and must never be staged.

## Enforced boundary

- Chain is pinned to Robinhood testnet `46630`.
- The server and browser must both use the exact mode `allowlisted-testnet-staging`.
- Signed quotes are issued only when `PermQuote.account` is in `PERM_STAGING_WALLET_ALLOWLIST`; the router binds that account to `msg.sender`.
- A local burner quote key is accepted in a production-built staging runtime only when `PERM_QUOTE_SIGNER_MODE=staging-local` and `PERM_STAGING_ALLOW_BURNER_SIGNER=1` are both explicit.
- Burner custody is always reported as `custodyReady: false` and can never satisfy `/api/health?requireExecution=1`.
- Aggregator Hook mode is disabled. Staging accepts only the configured direct Uniswap-v4 and Synthra-v3 adapter identities, with the v4 hook-provider sentinel left at zero.
- Third-party V2 admission is withheld. `docs/V2_VENUE_REVIEW.md` records exact-source and fork-test evidence, but no V2 adapter is deployed, registered, or exposed because provenance, recent activity, and meaningful liquidity are not established.
- The UI execution button remains disabled until a canonical allowlisted E2E settlement is recorded and rechecked by `/api/health?requireStaging=1`.

## 1. Create fresh testnet-only identities

Run once:

```sh
corepack pnpm staging:create-keys
```

This writes private values to ignored, mode-`0600` `.staging/keys.env` and writes funding addresses to `.staging/addresses.json`. Private keys are never printed. Never fund these addresses with mainnet assets, reuse them on another chain, or treat them as production custody.

The generated identities are:

- deployer / temporary staging owner, treasury, and pause guardian;
- separate burner quote signer; and
- separate canonical E2E transaction wallet.

Add the human tester wallet to `PERM_STAGING_WALLET_ALLOWLIST` as a comma-separated address. Keep the generated canonical E2E wallet in the list.

## 2. Fund only the required testnet addresses

Use the official faucet at `https://faucet.testnet.chain.robinhood.com/` (chain `46630`). At the time of this run it offers `0.01` testnet ETH plus five of each listed Stock Token per eligible address every 24 hours. Fund:

1. the generated deployer address for Router and adapter deployment gas; and
2. the generated canonical E2E wallet for one small native-ETH swap and gas.

The burner quote signer does not submit transactions and should not need funds.

## 3. Deploy the non-release contracts

Load the generated variables and deploy:

```sh
set -a
. .staging/keys.env
set +a
corepack pnpm contracts:deploy:staging
```

The script requires both `DEPLOYMENT_STAGING=1` and `CONFIRM_NON_RELEASE_STAGING=1`, permits a dirty worktree only for this non-release path, rejects reuse of the deployer as quote signer, deploys Router v2 plus direct v4/v3 adapters, leaves Aggregator Hook identity disabled, and writes ignored `deployments/robinhood-testnet.staging.json` with `executionReady: false`.

The production candidate path is unchanged: it still requires a clean commit, separate reviewed roles, multisig/timelock controls, and all release evidence.

## 4. Configure a separate hosted staging environment

A separate Vercel project or isolated Preview environment is strongly preferred. Do not overwrite the public production environment unless that choice is deliberate and the URL remains access-controlled operationally.

Set values from the staging manifest:

```dotenv
NEXT_PUBLIC_PERM_ROUTER_ADDRESS=<staging permRouter>
NEXT_PUBLIC_PERM_V4_ADAPTER_ADDRESS=<staging v4Adapter>
NEXT_PUBLIC_PERM_V3_ADAPTER_ADDRESS=<staging v3Adapter>
NEXT_PUBLIC_PERM_ROUTER_VERSION=2
NEXT_PUBLIC_PERM_DEPLOYMENT_BLOCK=<staging deploymentBlock>
NEXT_PUBLIC_PERM_EXECUTION_READY=0
PERM_EXECUTION_MODE=allowlisted-testnet-staging
NEXT_PUBLIC_PERM_EXECUTION_MODE=allowlisted-testnet-staging
PERM_STAGING_CHAIN_ID=46630
PERM_STAGING_WALLET_ALLOWLIST=<canonical E2E wallet>,<human tester wallet>
PERM_STAGING_ALLOW_BURNER_SIGNER=1
PERM_QUOTE_SIGNER_MODE=staging-local
PERM_QUOTE_SIGNER_PRIVATE_KEY=<fresh staging quote key>
QUOTE_SIGNER_ADDRESS=<staging quoteSigner>
PERM_AGGREGATOR_HOOKS_JSON=[]
NEXT_PUBLIC_PERM_STAGING_E2E_PASSED=0
PERM_STAGING_E2E_TX_HASH=
```

Keep the first hosted build at `NEXT_PUBLIC_PERM_STAGING_E2E_PASSED=0`. The quote API can serve the allowlisted bootstrap runner, but the browser button stays disabled.

## 5. Run the canonical staging E2E

Set `PERM_STAGING_URL` to the isolated HTTPS staging origin, load `.staging/keys.env`, and run:

```sh
set -a
. .staging/keys.env
set +a
PERM_STAGING_URL=https://your-staging-host.example corepack pnpm staging:run-e2e
```

The runner requests an allowlisted signed quote, rejects hook-backed or unknown provider steps, simulates the exact signed call, submits a small native-ETH Router-v2 swap, checks canonical `SwapSettled` and `RouteStepSettled` logs, writes ignored `.staging/e2e.json`, and keeps the staging manifest’s `executionReady` value false.

Copy only the returned transaction hash into the hosted environment:

```dotenv
PERM_STAGING_E2E_TX_HASH=<canonical transaction hash>
NEXT_PUBLIC_PERM_STAGING_E2E_PASSED=1
```

Redeploy staging. The public flag enables the UI only after the E2E run; the server independently rechecks the transaction, allowlisted sender, canonical block, direct provider IDs, zero hook address, and minimum confirmations.

### Additional non-release evidence suite

The canonical bootstrap transaction above remains the health-gate anchor. Record additional deployment evidence without replacing that transaction:

```sh
set -a
. .staging/keys.env
set +a
PERM_STAGING_URL=https://perm-iota.vercel.app \
STAGING_EVIDENCE_SCENARIOS=v3,multiHop,crossVenue,permit2 \
corepack pnpm staging:run-evidence
```

The runner obtains fresh quotes from the configured staging origin, enforces chain `46630`, the allowlisted account, deployed adapter addresses, approved direct-v4/v3 provider identities and zero hooks, then simulates and submits each transaction. HTTPS is mandatory by default; an explicit loopback-only HTTP guard exists for local non-release verification and must not be treated as hosted-service evidence. ERC-20 approvals are exact; the Permit2 case signs a one-transaction authorization. Results are written to ignored `.staging/e2e-suite.json`, while public transaction and receipt IDs may be copied to `deployments/robinhood-testnet.v2-staging.json`.

Referral and claim evidence uses a separate testnet-only referrer identity and changes the Router staging referral registry. It therefore requires the explicit `CONFIRM_STAGING_ADMIN_EVIDENCE=I_UNDERSTAND_TESTNET_ONLY` guard. Never reuse that identity outside testnet. Independently recheck every published hash with:

```sh
corepack pnpm staging:verify-evidence
```

The public suite records direct v4, v3, token-to-token multi-hop, explicit v4→v3 cross-venue execution, Permit2, referral accrual, treasury claim and referral claim. The `crossVenue` scenario requests the explicit `mixed` routing mode and accepts only a two-step route containing both `UNISWAP_V4_DIRECT` and `SYNTHRA_V3`. Transaction `0x994b1b8ac83d8e3ae03d036c9d85cadc71e8b93e3144b8c6167d471716f77290` is published in the non-release manifest and independently rechecked by `staging:verify-evidence`. Its quote came from the explicit local-loopback staging path, so it proves canonical Router/adapters settlement but does not claim that the currently hosted build exposes `mixed` mode. WalletConnect remains a manual mobile pairing plus independent signed-attestation test. These staging transactions do not satisfy role separation, remote custody, Aggregator Hook, WalletConnect, assurance or official-release gates.

For the manual mobile test, run `corepack pnpm staging:prepare-walletconnect` once to create ignored `.staging/walletconnect.json`. After a real Reown QR pairing, submit a Router-v2 swap from a wallet that is independent of every staging role; fill the public metadata, transaction hash, receipt ID, and **only a one-way hash** of the session topic. Run the prepare command again to print the exact QA attestation message. An independent QA signer must personal-sign that message. Configure only that public signer address in `STAGING_WALLETCONNECT_QA_SIGNERS`, then run `corepack pnpm staging:verify-walletconnect`. The verifier fails closed on stale/non-canonical transactions, wrong Router/account, receipt mismatch, an untrusted or operational-role signer, signature mutation, or a raw `sessionTopic` field. Do not commit the local evidence file, the session topic, or any Reown credential.

## 6. Verify the two independent health boundaries

Expected staging check:

```text
GET /api/health?requireStaging=1 -> 200
status: staging-ready-non-release
stagingReady: true
executionReady: false
```

Expected production check, even on the staging host:

```text
GET /api/health?requireExecution=1 -> 503
executionReady: false
```

A `200` from the staging check must never be presented as production release readiness.

## 7. Add hosted staging operations without changing the release boundary

Only after the canonical E2E gate is stable, add a managed primary chain-46630 RPC, keep the official public RPC as the independent fallback, and provision hosted PostgreSQL. Use the provider's direct PostgreSQL URL for schema migration/indexer jobs and its pooled URL for Vercel serverless traffic. Never commit either URL.

The scheduled indexer supports an explicit staging target without changing `deployments/robinhood-testnet.json`. Configure these GitHub Actions variables:

```dotenv
PERM_INDEXER_ENABLED=0
PERM_INDEXER_MODE=allowlisted-testnet-staging
PERM_INDEXER_CHAIN_ID=46630
PERM_INDEXER_ROUTER_ADDRESS=<staging Router v2>
PERM_INDEXER_ROUTER_VERSION=2
PERM_INDEXER_DEPLOYMENT_BLOCK=<staging deployment block>
PERM_INDEXER_CONFIRM_NON_RELEASE=1
PERM_MONITOR_ENABLED=0
PERM_MONITOR_MODE=allowlisted-testnet-staging
PERM_POOL_DISCOVERY_ENABLED=0
PERM_STAGING_URL=https://perm-iota.vercel.app
```

Configure these GitHub Actions secrets without printing them:

```dotenv
PERM_INDEXER_DATABASE_URL=<direct PostgreSQL URL>
RH_TESTNET_RPC_URL=<managed chain-46630 HTTPS RPC>
RH_TESTNET_FALLBACK_RPC_URL=https://rpc.testnet.chain.robinhood.com
PERM_ALERT_WEBHOOK_URL=<HTTPS JSON webhook>
```

Run the indexer manually once while all scheduled-operation `*_ENABLED` variables remain `0`. It applies the idempotent schema, backfills from the staging deployment block, stores a canonical block-hash cursor, and creates the shared PostgreSQL token bucket. Verify that the canonical E2E settlement is indexed, then enable the scheduled indexer. Run the staging monitor manually with `CONFIRM_ALERT_WEBHOOK_TEST=SEND_TEST_ALERT`; it requires both RPCs, a fresh canonical staging index, the shared rate limiter, `requireStaging=1 -> 200`, and `requireExecution=1 -> 503`. Enable its schedule only after the real webhook test succeeds. Run pool discovery manually with the managed RPC, review the generated registry diff, and only then set `PERM_POOL_DISCOVERY_ENABLED=1`; scheduled discovery remains intentionally skipped while the RPC secret is absent.

Then configure Vercel Production for the same non-release staging deployment:

```dotenv
RH_TESTNET_RPC_URL=<managed chain-46630 HTTPS RPC>
RH_TESTNET_FALLBACK_RPC_URL=https://rpc.testnet.chain.robinhood.com
PERM_INDEXER_DATABASE_URL=<pooled PostgreSQL URL>
PERM_RATE_LIMIT_DATABASE_URL=<pooled PostgreSQL URL>
PERM_ALERT_WEBHOOK_URL=<HTTPS JSON webhook>
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<public project ID>
PERM_REQUIRE_INDEXER=1
PERM_REQUIRE_SHARED_RATE_LIMIT=1
```

Redeploy and verify PostgreSQL-backed history, RPC failover configuration, the WalletConnect option, staging health `200`, and release health `503`. Keep `NEXT_PUBLIC_PERM_EXECUTION_READY=0`, `PERM_STRICT_OPERATIONS=0`, the staging-local signer boundary, and `PERM_AGGREGATOR_HOOKS_JSON=[]`. Hosted operations improve staging reliability; they do not convert burner custody or direct pools into release or Aggregator Hook evidence.

## Disable or rotate staging

To stop execution immediately, set `PERM_STAGING_ALLOW_BURNER_SIGNER=0`, remove the allowlist, or remove the staging-local key and redeploy. If a key may have leaked, pause the staging router, rotate the signer onchain, generate new testnet-only identities, and discard the old keys. Never promote staging evidence or burner identities into the official manifest.
