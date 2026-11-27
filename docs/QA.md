# Verification record

Date: 17 November 2026 (Asia/Jakarta; sandbox command logs use an independent UTC clock and may show 18 November)

## Release status and scope

This record validates the checked-in **Router v2 code, non-release staging path, and release gates**. Router v2 is live only as wallet-allowlisted staging; this record does not claim an official Router-v2 release.

The official manifest, `deployments/robinhood-testnet.json`, still identifies Router v1 and does not set `executionReady: true`. The separate public staging record is `deployments/robinhood-testnet.v2-staging.json`; it keeps `executionReady: false`, single-EOA testnet governance, local-burner signer custody, disabled Aggregator Hooks, and manual WalletConnect proof. Promotion remains fail-closed until the independent release path passes.

## Automated gates

| Gate | Result |
|---|---|
| Frozen dependency install | Passed: `corepack pnpm install --frozen-lockfile` |
| Production dependency audit | Passed with zero reported advisories and no workspace GHSA suppression |
| Full dependency audit | Exception-qualified: exactly one low-severity `elliptic` development-tool advisory remains, with no patched release; all other findings block |
| Moderate coverage-tool advisory | Resolved by overriding `bn.js <4.12.3` to `4.12.3` |
| ESLint | Passed with zero warnings |
| TypeScript | Passed |
| Production Next.js build | Passed; 10 static/dynamic routes generated |
| Router/adapters/timelock suite | **36 passing, 3 opt-in fork suites pending** in the regular run |
| Latest-state fork integrations | **3 passing**: real Robinhood v4, real Synthra v3/Permit2, and the dormant codehash-pinned V2 adapter against its reviewed pair |
| Solidity coverage | **89.12% statements, 56.49% branches, 89.47% functions, 88.79% lines**; Router is 97.56% statements and dormant V2 adapter is 96.55% |
| Coverage cleanup | Passed; the wrapper cleaned instrumented output, rebuilt production artifacts, and re-exported browser ABIs |
| Browser artifact integrity | Passed after coverage cleanup |
| Fuzz/invariants | Passed 1,024 deterministic uint127 fee inputs plus randomized conservation/reserve scenarios |
| Slither 0.11.3 | **77 contracts, 100 detectors, 0 findings** after the dormant V2 adapter was added and refactored |
| Server-runtime integration | Passed bounded settings, streamed body cap, proxy identity, token bucket, and in-flight cache coalescing |
| Quote-signer regression | Passed: production local-key signing is blocked; mocked authenticated remote signatures recover; redirect, content-type, size, identity, and signature failures close |
| Real KMS/HSM signer probe | **Pending operator endpoint/token and candidate addresses**; `release:probe-signer` is ready and its log digest is mandatory custody evidence |
| PGlite schema integration | Passed idempotency, 78-digit numerics, deferred evidence FK, state upsert, and cascade |
| PostgreSQL 17 schema integration | Passed the same behaviors through the whole-file migration path used in production |
| Release-gate regression | Passed: short-delay timelock promotion, unbounded monitor settings, zero-sized discovery chunks, and role/evidence tampering fail closed without changing the official manifest |
| Evidence downloader | Passed deterministic redirect/SSRF/size/hash regressions and a live commit-pinned HTTPS download through the DNS-pinned production path |
| Hosted quote proof | Passed full EIP-712 quote-ID reconstruction and authorized-signer recovery; field, route, gas, timing, and signer mutations fail closed |
| Non-release staging evidence | **8 of 9 scenarios recorded and independently reverified**; WalletConnect mobile QR attestation remains pending |
| Explicit cross-venue settlement | Passed canonical two-step `UNISWAP_V4_DIRECT → SYNTHRA_V3` transaction `0x994b…7290` |
| V2 venue admission | **Withheld**: exact upstream implementation, but unattributed ownership, zero 30-day swaps, and only `0.001604` / `0.015` alternate-WETH reserves |
| Manual pool discovery | Passed overlap rescan through block `155962684`; registry increased from 1,388 to 1,395 direct no-hook pools |
| Operations script syntax | Passed for deployment, ownership, discovery, indexer, monitoring, verification, and promotion scripts |
| Current official-manifest monitor | **0 failures** on Router v1; warnings correctly report absent local fallback/indexer/alert configuration and intentionally disabled v2 execution |

CI now supplies a PostgreSQL 17 service in addition to PGlite, runs the full-tree high-severity dependency gate, uploads Solidity coverage, and runs Slither independently.

## Contract behaviors exercised

The regression suite confirms:

- EIP-712 quote authorization binds account, pair, exact input, minimum output, gas estimate, recipient, timing, policy, chain, referrer, and route hash;
- forged, mutated, replayed, stale, future, expired, and wrong-chain quotes fail;
- self-referral fails even if included in a signed quote;
- up to four continuous steps can settle with per-step provider, adapter, pool/route, amount, hook, and hook-codehash evidence;
- hook routes fail closed unless the exact runtime codehash is reviewed;
- Permit2 signature transfer and exact-approval paths work;
- fee-on-transfer input fails before routing and rolls state back;
- treasury/referral liabilities use pull accounting and remain protected reserves;
- native output succeeds for a valid recipient and atomically rolls back for a rejecting recipient;
- minimum-output and adapter-reentrancy failures roll back quote consumption, fees, balances, and allowances;
- Router and deployed v4/v3 adapters can rescue only owner-authorized stranded balances outside active execution;
- the dormant V2 adapter accepts only its immutable Router as caller and settlement recipient, validates factory-selected direct pairs plus dependency/pair codehashes, rejects reserve/balance drift and fee-on-transfer behavior, and remains undeployed;
- forced native and ERC-20 balances were recovered from the deployed adapter implementations, while an unauthorized caller and a rejecting native recipient failed;
- zero fee, full rebate, dust rounding, referral conservation, and reserve accounting hold;
- emergency pause, signer rotation, and two-step ownership work; and
- a real OpenZeppelin timelock batch can schedule and atomically accept Router, v4-adapter, and v3-adapter ownership only after the delay.

The standard and timelock-enabled deployment rehearsals both passed. The timelock ownership plan remained deterministic with operation ID:

`0x6a4335d182623f28a1daf6f16fdf1afeeaa1ca1c8c1509dbe278f4c7f8afaef6`

Rehearsal manifests are local evidence only and are not official deployments.

## Live-chain and fork evidence

Latest-state fork tests used the current public Robinhood testnet state because the public RPC cannot serve the old pinned archival block.

- v4: native→token and token→native settlement through the real PoolManager, including signed quotes and rebate accounting;
- Synthra v3: native→TSLA and Permit2-backed TSLA→native settlement through the reviewed SwapRouter and WETH targets;
- dormant V2 adapter: native→TSLA through the exact-source, codehash-pinned direct pair;
- result: **3 passing**.

The V2 fork success proves adapter compatibility only. `deployments/robinhood-testnet.v2-venue-review.json` still withholds venue admission because provenance, recent activity, and meaningful liquidity are not established.

The finalized, overlap-rescanned v4 registry was refreshed through block `155962684` and contains **1,395 eligible direct pools**. The seven additions all have the zero hook address; no Aggregator Hook was admitted.

The official deployment monitor also ran against live chain state with **zero failures**. It confirmed chain freshness, runtime bytecode at all configured targets, owner/treasury, unpaused state, policy `20 / 2500`, and the enabled direct-v4 adapter. Its remaining warnings are expected and release-relevant: official Router v1, pending source verification, and no manifest-declared timelock.

## Router-v2 non-release staging evidence

The source-verified Router-v2 staging deployment has canonical evidence for direct v4, Synthra v3, token-to-token multi-hop, explicit v4→v3 cross-venue routing, Permit2, referral accrual, treasury claim, and referral claim. `corepack pnpm staging:verify-evidence` independently rereads transactions, canonical blocks, signed calldata, continuous route steps, exact provider/adapter identities, fee invariants, Permit2 data, accruals, and claims.

The explicit cross-venue transaction is `0x994b1b8ac83d8e3ae03d036c9d85cadc71e8b93e3144b8c6167d471716f77290`; its two settled providers are `UNISWAP_V4_DIRECT` followed by `SYNTHRA_V3`. Its local-loopback quote path is not represented as hosted-service evidence. WalletConnect remains the ninth, manual mobile QR-pairing scenario and requires an independent signed attestation.

The live staging health boundary remains `staging-ready-non-release` with `stagingReady=true` and `executionReady=false`. Governance is still a single testnet EOA and quote signing still uses explicitly allowed staging-local custody; neither can satisfy release readiness.

## Real PostgreSQL and indexer integration

PostgreSQL 17 was started locally and the actual `scripts/indexer.cjs` worker was run against the official Robinhood testnet RPC and Router v1 manifest.

The worker:

1. executed the complete `indexer/schema.sql` migration through PostgreSQL's simple-query path;
2. safely reran the migration;
3. indexed from deployment block `154833178` through finalized block `155000255` in bounded chunks;
4. persisted a canonical cursor hash;
5. recovered both historical official settlements; and
6. returned current data through `/api/history` with source `postgres-indexer`.

Indexed settlements:

- `0xf76cdc7e4c1d20b43b5d7bfb62314599b78355b55f5965b41d6553126e5ab60b` at block `154836799`;
- `0x17b294d4b5c212f83c8ea4536e9d2fd4f5b650a34297d46db2e5c27e59ab9904` at block `154842634`.

After a final one-shot sync, a database-aware monitor run reported zero failures, a canonical cursor hash, 12-block lag (the configured confirmation depth), and a fresh cursor timestamp. The later allowlisted staging path also returned Neon-backed canonical history after a successful manual indexer run. This proves the worker/schema/API path, but does not prove a continuously scheduled worker, backup/restore drill, or alert delivery. Scheduled monitoring remains deliberately disabled while alerting is deferred.

## Production server, API, and browser smoke tests

A production build was served with the real PostgreSQL connection.

HTTP checks:

- `/`, `/trade`, `/routes`, `/rebate`, `/proofs`, `/docs`, and `/setup` returned HTTP 200;
- CSP, COOP, Permissions Policy, HSTS, and `X-Content-Type-Options` headers were present;
- malformed quote content type returned 415;
- malformed receipt hash returned 400;
- `/api/history` returned both indexed settlements from PostgreSQL;
- a live ETH→NVDA quote returned one real v4 candidate, current block identity, and `executable: false` with the explicit Router-v1 reason; and
- both historical settlement hashes were re-decoded by `/api/receipts` with canonical transaction index, block hash, log identity, and more than 12 confirmations.

A headless Chromium test exercised the hydrated `/trade` page at desktop and mobile sizes:

- a live quote and candidate rendered;
- no horizontal overflow or Next.js error page appeared;
- no actionable browser console errors occurred;
- the token picker exposed a labelled modal dialog, autofocus, Escape close, and keyboard focus containment;
- the wallet chooser exposed a labelled dialog and correctly disabled WalletConnect when no project ID was configured; and
- the 390-pixel mobile layout rendered the menu, quote, and candidate without overflow.

## Historical Router v1 wallet evidence

These transactions remain valid evidence for the currently official Router v1 only; they are not presented as Router v2 evidence.

### ETH → NVDA:T

- settlement: `0xf76cdc7e4c1d20b43b5d7bfb62314599b78355b55f5965b41d6553126e5ab60b`
- block: `154836799`
- block hash: `0xa9d7f002677b043995525068a38d5967e30e60ed4f377169bf45398f2616a806`
- input: `0.0001 ETH`
- routed input: `0.00009985 ETH`
- output: `0.000013528386301086 NVDA:T`
- gross fee / rebate / net fee: `0.0000002 / 0.00000005 / 0.00000015 ETH`

### NVDA:T → ETH

- exact approval: `0xb7397a5bcaef65fccb911809469e70468f7469fe8ea74b610aaf36eca5123dbe`
- settlement: `0x17b294d4b5c212f83c8ea4536e9d2fd4f5b650a34297d46db2e5c27e59ab9904`
- block: `154842634`
- block hash: `0x60eea6bf48cd9b80e4992303d5a6e39c5ed652b45bdf9e07e2b69c33f9c1d0d8`
- input: `0.00001 NVDA:T`
- routed input: `0.000009985 NVDA:T`
- output: `0.000074313192980675 ETH`
- gross fee / rebate / net fee: `0.00000002 / 0.000000005 / 0.000000015 NVDA:T`
- allowance after settlement: zero

## Unfinished external release gates

Router v2 must remain non-executable until all of the following are complete:

1. deploy a release candidate with dedicated, separated governance, treasury, guardian, deployer, and remote-signer identities;
2. verify that candidate Router, deployed adapters, and timelock source on Blockscout;
3. use the enforced minimum 48-hour timelock, then schedule, wait for, and execute all ownership-acceptance calls;
4. run candidate verification until ownership and source gates both pass;
5. schedule the hosted PostgreSQL worker and complete fallback-RPC, backup/restore, load, and real alert-delivery drills; monitoring remains disabled while alerting is deferred;
6. configure and probe a non-exportable remote quote-signer key matching the onchain signer;
7. use the existing Reown configuration for a real external mobile WalletConnect QR session and obtain the independent signed attestation;
8. repeat the staging transaction suite against the release candidate with release custody and hosted operations; interim burner-staging evidence cannot be promoted;
9. keep Aggregator Hook mode disabled until a specific deployment, permissions, quote semantics, calldata, runtime codehash, and canonical settlement are independently reviewed;
10. keep third-party V2 routing disabled until every gate in `docs/V2_VENUE_REVIEW.md` passes; and
11. complete independent audit, governance review, incident drill, funded bug bounty, and four-role approvals before any use with assets of value.

No local rehearsal, fork test, or generated candidate should be described as the official Router v2 while the shared manifest remains Router v1.
