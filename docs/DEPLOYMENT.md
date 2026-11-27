# Router v2 · Robinhood Chain testnet release runbook

> Robinhood Chain **mainnet 4663** (allowlisted showcase mode): see [`MAINNET_RUNBOOK.md`](MAINNET_RUNBOOK.md). This document covers the testnet release-candidate process.

## Network and current public state

- Chain ID: `46630`
- RPC: `https://rpc.testnet.chain.robinhood.com`
- Explorer: `https://explorer.testnet.chain.robinhood.com`
- Gas asset: testnet ETH

The official release manifest currently remains on Router v1:

- Router: `0x3e350b79D4983a0e86Ad4eE25dB1DBBbfB55114d`
- v4 adapter: `0xC4Df49493a828F681160056cb6D46143B56593D0`

A distinct Router-v2 deployment is live only as wallet-allowlisted, non-release staging:

- Router: `0xFdC667735C8998fEB83C4c3c7B4eCFB404DAFA87`
- v4 adapter: `0x9F05AA13b333d4FB780c8A343f4663de9C9c798c`
- v3 adapter: `0x1D608E676b3bF506d15f4C9Ee0fAAa9aC87ce6Ba`
- public record: `deployments/robinhood-testnet.v2-staging.json`

All three staging contracts are source-verified exact matches on Blockscout. This publication does not promote them: the staging still uses a single-EOA governance boundary, local testnet burner signer, direct routes only, and `executionReady: false`. Only the explicit promotion flow in this runbook may replace the official manifest.

## Safety prerequisites

- Use a dedicated testnet-only deployer and quote signer. Never paste keys into chat or source files.
- Use a Safe/multisig as proposer/guardian and a timelock as final owner for a shared rehearsal.
- Use dedicated primary/fallback RPC endpoints for hosted traffic.
- Create a PostgreSQL database for durable history.
- Require peer review of constructor targets, manifest diff and verification results.
- Do not reuse this address book or any key on mainnet.

Recommended runtime is Node `22.12+`. Dependency build policy explicitly allows `keccak` and denies the nonessential Reown version-check postinstall script.

## 1. Preflight

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm audit:security
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm contracts:compile
corepack pnpm contracts:export
corepack pnpm contracts:test
corepack pnpm contracts:coverage
corepack pnpm server:test
corepack pnpm indexer:test-schema
corepack pnpm build
```

Current local contract checkpoint: 36 passing tests plus three opt-in fork suites skipped in the default run. Current coverage checkpoint: 89.12% statements, 56.49% branches, 89.47% functions and 88.79% lines (Router: 97.56% statements; dormant V2 adapter: 96.55%). The exact count can increase as regressions are added; any failure or material coverage regression blocks release.

Exercise the migration on a disposable PostgreSQL database (the command is destructive and refuses an unlabelled database):

```bash
PGSSLMODE=disable TEST_DATABASE_URL='postgres://.../perm_test' corepack pnpm indexer:test-postgres
```

Run static analysis:

```bash
python -m pip install slither-analyzer==0.11.3
slither . --exclude-dependencies --filter-paths 'contracts/src/mocks|contracts/test'
```

Expected: `0 result(s) found`. Suppressions in source are narrowly scoped and include the design rationale.

Run latest-state integrations and a complete fork deployment rehearsal:

```bash
unset FORK_BLOCK_NUMBER
corepack pnpm contracts:test:fork
corepack pnpm contracts:rehearse:testnet
```

The fork suite executes:

- real v4 native→token and token→native settlement;
- real Synthra v3 native→TSLA and TSLA→native settlement;
- an actual Permit2 EIP-712 signature transfer;
- the dormant V2 adapter against its exact-source, codehash-pinned testnet pair; and
- fee/rebate accounting through Router v2.

The V2 fork test proves compatibility only; `docs/V2_VENUE_REVIEW.md` withholds deployment and registration. The rehearsal deploys Router plus the admitted v4/v3 adapters, registers their provider identities and runs post-deploy reads. Its manifest is ignored by Git.

The optional non-official D4 test-hook operation is **not** part of candidate deployment and must never use the commands below. It has irreversible testnet writes, a distinct isolated/frozen stack, exact acknowledgement, and a separate verifier. Follow [`TEST_HOOK_EVIDENCE.md`](TEST_HOOK_EVIDENCE.md) in full.

## 2. Prepare release identities

Set shell variables locally:

```bash
export RH_TESTNET_RPC_URL='https://your-dedicated-rpc.example'
export DEPLOYER_PRIVATE_KEY='0x...testnet-only...'
export QUOTE_SIGNER_ADDRESS='0x...public-address-only...'
export OWNER_ADDRESS='0x...governance-proposer-or-safe...'
export TREASURY_ADDRESS='0x...fee-beneficiary...'
export PAUSE_GUARDIAN_ADDRESS='0x...emergency-safe...'

# Required for promotion: deploy a timelock as final owner (minimum 48 hours).
export TIMELOCK_PROPOSER_ADDRESS="$OWNER_ADDRESS"
export TIMELOCK_DELAY_SECONDS=172800
export VERIFY=1
```

`QUOTE_SIGNER_PRIVATE_KEY` may be used instead of `QUOTE_SIGNER_ADDRESS` only for a local rehearsal. A shared deployment requires the public EOA address only; the production quote service uses authenticated remote signing (`PERM_QUOTE_SIGNER_MODE=remote`) and must never receive the raw key or expose signer credentials as `NEXT_PUBLIC_*` values. Shared `OWNER_ADDRESS`/proposer, `TREASURY_ADDRESS`, and `PAUSE_GUARDIAN_ADDRESS` must be separate contract wallets; deployment rejects EOAs for those operational multisig roles.

## 3. Deploy a candidate

```bash
corepack pnpm contracts:deploy:testnet
```

The script refuses any chain other than `46630`, refuses a shared deployment from a dirty/uncommitted tree, records the exact Git commit (`RELEASE_COMMIT_SHA` can pin the expected value), checks bytecode at PoolManager, V4Quoter, Permit2 and Synthra targets, then deploys:

1. optional `PermTimelock`;
2. `PermRouter` v2;
3. codehash-pinned `PermV4Adapter`;
4. immutable-target `PermV3Adapter`;
5. direct-v4 and Synthra-v3 adapter registrations with runtime-codehash pins;
6. emergency pause guardian configuration; and
7. two-step ownership transfers.

The Aggregator Hook provider identity is deliberately left unset. The manifest records exact runtime codehashes for Router, adapters, timelock, PoolManager, V4Quoter, Permit2, factory, Synthra router/quoters and WETH. Post-deploy checks verify policy, signer, guardian, Permit2, adapter registry/codehashes, the zero hook-provider sentinel, immutable venue targets and pending ownership from chain.

The output is `deployments/robinhood-testnet.v2-candidate.json`. It does **not** overwrite the official manifest and has `executionReady: false`.

## 4. Complete timelock ownership

When a timelock is used, prepare deterministic schedule/execute calldata:

```bash
export CANDIDATE_MANIFEST=deployments/robinhood-testnet.v2-candidate.json
export TIMELOCK_PROPOSER_ADDRESS='0x...'
corepack pnpm contracts:prepare-ownership
```

Review `deployments/ownership-acceptance.json`, then:

1. submit `scheduleCalldata` to the timelock from an authorized proposer;
2. wait the full minimum delay;
3. submit `executeCalldata` to the timelock;
4. confirm Router, v4 adapter and v3 adapter owners equal the timelock;
5. confirm pending owners are cleared.

The pause guardian can pause immediately, but only final governance can unpause.

## 5. Verify sources and candidate state

`VERIFY=1` submits verification during deployment. Wait until Blockscout publishes source for Router, both adapters and the timelock, then run:

```bash
corepack pnpm deployments:verify-candidate
```

This reruns official onchain configuration checks, queries Blockscout source metadata, updates candidate ownership/source status and exits nonzero until both gates are complete.

For a candidate monitor check without promotion:

```bash
PERM_MANIFEST_PATH=deployments/robinhood-testnet.v2-candidate.json \
  corepack pnpm monitor:testnet
```

## 6. Configure services before promotion

Quote service (shared release):

```bash
export PERM_QUOTE_SIGNER_MODE=remote
export QUOTE_SIGNER_ADDRESS='0x...matching-candidate-signer...'
export PERM_QUOTE_SIGNER_URL='https://authenticated-kms-or-hsm-signer...'
export PERM_QUOTE_SIGNER_TOKEN='server-only bearer credential'
unset PERM_QUOTE_SIGNER_PRIVATE_KEY
export RH_TESTNET_RPC_URL='https://primary...'
export RH_TESTNET_FALLBACK_RPC_URL='https://fallback...'
```

The remote endpoint receives the exact EIP-712 domain/types/message and must return `{ "address": "0x...", "signature": "0x..." }`. The quote service caps the response stream, recovers the signer locally, and rejects malformed, oversized, mismatched, or redirected responses. Raw `PERM_QUOTE_SIGNER_PRIVATE_KEY` mode remains development-only; `/api/health?requireExecution=1` rejects it.

Before hosted E2E, set `RELEASE_SIGNER_PROBE_ACCOUNT`, `RELEASE_SIGNER_PROBE_TOKEN_IN`, and `RELEASE_SIGNER_PROBE_TOKEN_OUT` to real testnet addresses, then run `pnpm --silent release:probe-signer | tee quote-signer-probe.json` and SHA-256 the resulting file. The probe uses a random route hash whose preimage is discarded, never prints the signature, and succeeds only when the real remote signer recovers to the candidate-authorized address. Publish that log at immutable `remoteSignerProbeUrl` and put its digest in the signed custody payload as `remoteSignerProbeSha256`; promotion downloads and hashes it again. Mocked signer tests do not satisfy this requirement.

Indexer:

```bash
export DATABASE_URL='postgres://...'
export INDEXER_CONFIRMATIONS=12
corepack pnpm indexer:run       # cron/one-shot
# or
corepack pnpm indexer:watch     # dedicated worker
```

The first index run creates indexer tables and the shared PostgreSQL token bucket from `indexer/schema.sql`. Configure `PERM_REQUIRE_INDEXER=1` and `PERM_REQUIRE_SHARED_RATE_LIMIT=1` only after the cursor and shared limiter are healthy. Configure `PERM_ALERT_WEBHOOK_URL` for critical deployment/indexer alerts. An execution-ready release must use all three fail-closed controls; process-local limiting is development-only.

WalletConnect QR sessions require a public WalletConnect project ID:

```bash
export NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID='...'
```

Injected wallets continue to work without it.

## 7. Produce candidate E2E evidence before promotion

Deploy a controlled release-candidate staging build while the shared public manifest remains Router v1. This full release-evidence environment is distinct from the interim wallet-allowlisted, burner-signer path in `docs/ALLOWLISTED_STAGING.md`; interim staging transactions do not satisfy the release custody, operations, WalletConnect, assurance, or hook gates. From wallets that are neither treasury nor governance, execute and record:

1. native↔token through direct v4;
2. native↔token through Synthra v3;
3. token→token with at least two continuous route steps;
4. an ERC-20 input using a real Permit2 signature transfer;
5. a referral settlement where account and referrer are different, followed by the referral claim;
6. a settlement submitted through a real WalletConnect QR session; and
7. a treasury pull-payment claim.

Put the transaction hashes, receipt IDs and WalletConnect attestation metadata in candidate `releaseEvidence`, then run:

```bash
pnpm release:verify-e2e
```

The verifier checks canonical blocks, minimum confirmations, exact official-router events, non-treasury/non-governance accounts, continuous steps, provider identities, fee invariants, Permit2 calldata, separate-account referral accrual/claim, gas-estimate calibration, WalletConnect attestation metadata and the treasury claim. It writes `e2eVerification: "passed"` only after every check succeeds.

## 8. Onboard and prove an Aggregator Hook

No Aggregator Hook deployment is currently established on this testnet. Therefore brief-complete promotion is intentionally blocked until a real reviewed hook exists. Never use an ordinary v4 pool to satisfy this gate.

For each hook candidate:

1. independently review source, permissions, upgradeability, quote semantics and hook-data schema;
2. record specification and audit-report URLs plus the audit artifact SHA-256;
3. record the exact PoolKey, initialization block, hook data and expected runtime codehash;
4. call `setVerifiedHook` and `configureHookProvider(v4Adapter, id("UNISWAP_V4_AGGREGATOR_HOOK"))` through the timelock only after that review;
5. add the structured entry to candidate `aggregatorHooks`, including a bounded quote probe;
6. execute a non-treasury Router-v2 staging settlement through the hook; and
7. add its transaction hash, receipt ID and step index to the entry.

Then run:

```bash
pnpm release:verify-hooks
```

The verifier recomputes PoolId and runtime codehash, checks the adapter's pinned codehash, executes the quote probe, verifies canonical confirmations and requires matching `RouteStepSettled` plus `SwapSettled` evidence. It writes `aggregatorHookVerification: "passed"` only on success. Any bytecode change fails closed.

## 9. Verify hosted operations

The staging deployment must set dedicated primary/fallback RPCs, hosted PostgreSQL, `PERM_REQUIRE_INDEXER=1`, `PERM_REQUIRE_SHARED_RATE_LIMIT=1`, quote signer, WalletConnect project ID and the real alert webhook. The indexer must have a current canonical cursor for the candidate router.

Set `PERM_STAGING_URL` and the release environment, then explicitly authorize one test notification:

```bash
export CONFIRM_ALERT_WEBHOOK_TEST=SEND_TEST_ALERT
pnpm release:verify-operations
```

This checks both RPCs and chain IDs, the shared PostgreSQL token bucket, indexer freshness, `/api/health?requireExecution=1`, PostgreSQL-backed history, an official v2 receipt, production security headers and the real alert destination. For the executable v2 quote it independently rebuilds the complete EIP-712 payload (including route hash and bounded gas estimate), checks the quote ID, and recovers the candidate-authorized remote signer; a merely well-formed signature is insufficient. Promotion also requires the operations report to bind the exact candidate router, verified direct-v4 receipt, RPC/indexer cursors, HTTPS staging origin, and complete security-header set. It writes `operationsVerification: "passed"` only on success.

## 10. Verify independent assurance and approvals

Add the signed independent-audit, incident-drill, active bug-bounty/funding, and four-role approval payloads defined in `docs/RELEASE_EVIDENCE.md`. Configure the trusted signer allowlists outside the candidate, then run:

```bash
pnpm release:prepare-assurance
pnpm release:verify-assurance
```

The verifier checks release/commit binding, EOA signatures, distinct approvers, auditor independence, evidence freshness and immutable HTTPS artifact hashes. Every evidence hop is restricted to port 443, resolved to public addresses, pinned for the TLS request, redirect-revalidated, stream-capped at 10 MiB, and hash checked. Promotion downloads and verifies the artifacts again. Run `pnpm release:test-evidence:live` before a release (with the real artifact URL/hash overrides when available) to exercise the production downloader.

Re-run candidate verification after source, ownership and all evidence gates:

```bash
pnpm deployments:verify-candidate
```

`promotionReady` is true only when source, ownership, role separation, hook evidence, E2E evidence, hosted operations and signed assurance all pass.

## 11. Promote explicitly

Promotion is the only step that changes the frontend's official router:

```bash
export CONFIRM_PROMOTION=ROBINHOOD_TESTNET_V2
export CONFIRM_ROUTER_ADDRESS='0x...exact candidate router...'
pnpm deployments:promote
```

The command additionally requires treasury and quote-signer role separation, fresh hook/E2E/operations/assurance verification from the last seven days, and revalidates all signed assurance artifacts. It archives the v1 manifest, writes the v2 official manifest with `executionReady: true`, and records the previous router. There is no bypass for an empty Aggregator Hook registry.

Restart all services, rerun the strict monitor and verify `/api/health?requireExecution=1` remains ready. `NEXT_PUBLIC_PERM_EXECUTION_READY=1` is reserved for the fully provisioned release-candidate operations environment described above and still requires every strict health gate; never use it with burner staging or leave it on as a substitute for official-manifest promotion. The public release must derive readiness from the promoted official manifest and authenticated remote custody. `allowlisted-testnet-staging`, staging-local keys, and `/api/health?requireStaging=1` can never substitute for that gate.

## 12. Incident and rollback

1. Pause Router v2 immediately through the pause guardian.
2. Run `monitor:testnet` and preserve its report.
3. Disable affected adapter/hook through governance if needed.
4. Stop quote signing and set services read-only.
5. Restore the archived v1 manifest only as a read-only frontend fallback; Router v1 is not a substitute for fixed v2 execution.
6. Publish an incident note and deploy a new reviewed candidate rather than mutating evidence.

Mainnet requires a separate audit, address book, governance review, infrastructure review, simulations and release approval.
