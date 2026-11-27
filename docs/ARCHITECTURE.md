# Perm Router v2 architecture

## Release state

The repository contains Router v2 and its full application path. The committed public manifest still identifies the already-deployed Router v1, so the quote service intentionally returns read-only candidates with `executable: false`. Signed execution becomes available only after a reviewed v2 candidate is verified, governance ownership is accepted, and `deployments:promote` marks the official manifest `executionReady: true`.

## Quote and route flow

1. The client submits an exact input, token pair, recipient, slippage and routing mode to `/api/quote`.
2. The server validates the token registry against onchain decimals and reads the active fee policy from the official router.
3. It discovers candidates from the persisted PoolManager event registry and Synthra v3 factory:
   - direct Uniswap v4 pools;
   - Synthra v3 pools at reviewed fee tiers;
   - bounded two-step routes through every distinct supported intermediary (including, but not limited to, ETH/WETH), retaining only the strongest first/second legs; and
   - manifest-reviewed Aggregator Hook pools only.
4. Every venue quote is obtained from its onchain quoter. Reverting or empty candidates are discarded.
5. Network gas is converted into output-token units through a separate ETH-to-output market quote. Candidates are ranked by output after estimated gas when that conversion is available.
6. The server computes price impact from a small-size requote and applies the selected slippage floor.
7. An executable Router v2 quote is signed with EIP-712 domain `Perm`, version `2`. It binds account, pair, exact input, minimum output, quoted gas estimate, recipient, expiry, quote time, policy version, chain, referrer and route hash.
8. The client verifies that the displayed input still exactly matches the quote, optionally prepares a one-use Permit2 signature, simulates the complete call, and only then requests wallet submission.

A shared release signs through an authenticated remote non-exportable KMS/HSM endpoint; the service independently recovers every returned signature. Raw local-key mode is development-only and cannot satisfy execution health. A missing/mismatched signer, non-promoted manifest, zero recipient/account, or Router v1 makes the quote non-executable.

## Router v2 settlement

`PermRouter` accepts up to four continuous route steps. Before external calls it:

- verifies chain, expiry, freshness, self-referral, replay status and EIP-712 signer;
- verifies the first/last tokens and continuity of every step;
- computes integer fee settlement from the signed policy version;
- records quote consumption, settlement nonce and pull-payment reserves.

For every step it verifies the allowlisted adapter's current runtime codehash against the value pinned at registration, approves only the exact routed amount, calls the adapter, clears the allowance, and independently measures the router's output balance. Reported and measured output must match. Final ERC-20 output is checked from the recipient's actual balance delta; native output must be delivered successfully.

The final evidence consists of one `RouteStepSettled` event per step and one `SwapSettled` event. Fresh candidates leave the hook-provider identity at zero. Only after governed hook onboarding may hooked v4 steps use the distinct `UNISWAP_V4_AGGREGATOR_HOOK` identity, so they cannot be mislabeled as direct v4 execution.

## Fee accounting

The active default policy is:

- gross fee: 20 bps of exact input;
- rebate: 25% of gross fee;
- net fee: 15 bps after integer floor rounding.

`routedInput + netFee == amountIn`. Referral fees are a share of the net fee, and `referralFee + treasuryFee == netFee`.

Fees are pull payments in `claimableFees`. A reverting treasury or referrer cannot block user settlement. `totalClaimableFees` reserves are excluded from owner rescue for both native and ERC-20 assets.

## Adapter boundaries

### `PermV4Adapter`

- immutable Router and PoolManager;
- exact-input, one-pool step only;
- pool key must exactly match the requested pair;
- no-hook pools reject non-empty hook data;
- hooks require owner registration of their current runtime `extcodehash`;
- runtime codehash is checked again on every swap;
- PoolManager settlement amount and adapter output are verified;
- adapter entry is reentrancy guarded.

A registry entry alone never makes a hook executable. The manifest, adapter codehash registry, live bytecode and v4 quoter must all agree.

### `PermV3Adapter`

- immutable Router, Synthra SwapRouter02 and WETH;
- runtime codehashes for external router and WETH are pinned at deployment;
- reviewed v3 fee tiers only;
- native input is wrapped and native output unwrapped;
- exact external-router allowance is cleared after execution;
- adapter entry and rescue are reentrancy guarded.

Latest-state fork tests execute both directions through the real v4 PoolManager and real Synthra router, including an actual Permit2 signature transfer.

## Governance and release controls

Router and adapters use two-step ownership. The optional `PermTimelock` becomes final owner after all three `acceptOwnership()` calls are scheduled and executed. Router v2 also has an independent pause guardian that may pause immediately; only the owner/timelock may unpause.

Deployment produces a **candidate** manifest, never the official manifest. Promotion requires:

- onchain post-deploy checks passed;
- final ownership accepted;
- all release contracts source-verified and runtime-matched to local compiler artifacts;
- reviewed Aggregator Hook, canonical direct/v3/multi-step/Permit2/referral/WalletConnect/claim evidence, and measured gas calibration;
- hosted database/indexer, RPC failover, security headers and real alert test;
- signed independent audit, incident drill, funded bug bounty and distinct engineering/security/governance/operations approvals;
- exact router-address confirmation; and
- explicit promotion phrase.

## Data and proof path

`/api/receipts` rejects router overrides and decodes only exact event ABIs from the official router address. It reads all settlements in a transaction, enforces successful status and a configurable confirmation floor, and preserves per-step route/hook evidence.

For durable history, `scripts/indexer.cjs` scans finalized official-router logs into PostgreSQL. `/api/history` prefers the index and falls back to bounded official-chain scans when the database is optional. The indexer stores settlement amounts as decimal-safe numeric values and maintains a per-router cursor.

## Operational controls

- token-bucket request limiting and short-lived RPC cache with in-flight request coalescing;
- optional primary/fallback RPC configuration;
- incremental, reorg-aware pool discovery with reviewed-hook filtering;
- scheduled deployment/config/indexer monitoring with optional webhook alerts;
- CI typecheck, contract tests, fuzz/invariants, production build and Slither;
- weekly latest-state v4/v3 fork integration and full deployment rehearsal.

## Trust boundaries

- Testnet symbols are unvalued fixtures and do not represent equity or issuer affiliation.
- Pool discovery does not imply liquidity quality or hook approval; live quoters and adapter checks remain authoritative.
- The committed Router v1 is not silently treated as v2.
- No contract or frontend in this repository is approved for mainnet value without independent audit and a separate mainnet release.
