# Mainnet readiness policy

> Operational steps for the non-release `allowlisted-mainnet` mode on chain 4663 are in [`MAINNET_RUNBOOK.md`](MAINNET_RUNBOOK.md). The gates below still apply to a public mainnet release.

Perm is **not approved for mainnet deployment**. The repository may prepare and validate a Router-v2 testnet release, but no mainnet transaction may be sent until every gate below is complete and independently reviewed.

## 1. Product-completeness gate

- Direct v4, reviewed v3, multi-hop, Permit2 and recipient-balance settlement evidence pass on testnet.
- At least one real Aggregator Hook is independently reviewed, codehash-pinned, quote-probed and proven by canonical Router-v2 events.
- Route ranking compares net output after gas only when a trustworthy unit conversion exists; otherwise gas is presented separately.
- No unsupported venue, hook or price-impact value is presented as verified.

The testnet manifest cannot be promoted while `aggregatorHooks` is empty or while `aggregatorHookVerification`, `e2eVerification`, `operationsVerification`, or cryptographically checked `assuranceVerification` is not `passed`. The assurance gate binds four distinct external attesters (audit, incident drill, active funded bug bounty, and signer custody) plus four distinct formal approvers to the exact Git commit, codehash maps, and canonical source/ownership/hook/E2E/operations evidence commitment.

## 2. Contract and governance gate

- Final artifacts are reproduced from a clean checkout and matched to deployed runtime bytecode.
- Router, adapters and timelock are source-verified.
- An independent audit covers Router, both adapters, Permit2 flow, hook trust assumptions, timelock and release scripts; all critical/high findings are fixed and retested.
- A public bug-bounty policy and funded response process exist.
- Final owner is a timelock controlled by a reviewed multisig; treasury, quote signer and deployer are separate identities.
- Mainnet timelock delay, proposer/executor roles, pause guardian and recovery procedures receive a governance review.
- The deployer is unfunded and revoked after deployment where the target chain permits it.

## 3. Mainnet address-book gate

A separate, reviewed mainnet manifest must be created only after the target chain is selected. Every external dependency must have:

- chain ID and explorer;
- canonical address and deployment transaction;
- runtime codehash;
- verified source and version;
- owner/upgradeability analysis;
- incident and deprecation policy; and
- fork-test coverage at a documented block.

Testnet addresses, token metadata, PoolManager, Permit2, quoters, WETH and Synthra addresses must never be copied into a mainnet manifest by default.

## 4. Operations gate

- Dedicated primary, fallback and archive RPCs pass chain/freshness/failover drills.
- Hosted PostgreSQL, canonical reorg-aware indexer and shared rate limiter pass load, restart and backup/restore drills.
- Quote signer is held in KMS/HSM or equivalent isolated custody with rotation and emergency-disable procedures.
- Monitoring covers chain freshness, source/config drift, signer, policy, adapter/hook codehash, pause state, timelock, indexer cursor, RPC failure and treasury claims.
- A real alert test reaches the on-call destination.
- WalletConnect and injected-wallet settlement E2E pass on supported desktop and mobile wallets.
- SLOs, on-call ownership, incident severity levels, status communication and rollback procedures are documented and rehearsed.

## 5. Economic and launch gate

- Token and venue allowlists receive liquidity, decimals, transfer-behavior and manipulation review.
- Gas assumptions and price-impact estimates are calibrated against canonical receipts.
- Slippage defaults, maximum trade size, per-token exposure and daily volume caps are defined.
- MEV/front-running assumptions and any private-transaction option are documented.
- The initial launch uses conservative caps and staged increases approved through governance.
- Legal, privacy, sanctions and jurisdictional review is complete for the intended product and users.

## 6. Required evidence package

The release owner must preserve:

1. clean CI run and coverage artifact;
2. Slither report and independent audit report hashes;
3. fork and testnet E2E transaction list;
4. Aggregator Hook review and canonical evidence;
5. source-verification results and bytecode hashes;
6. multisig/timelock role review;
7. infrastructure preflight, failover, load and restore reports;
8. alert and incident-drill evidence;
9. signed release approval from engineering, security, governance and operations; and
10. exact mainnet manifest diff and deployment calldata simulation.

A missing item is a release blocker, not a documentation warning. “No known gap” may be stated only after an independent reviewer checks this package; it must never be inferred solely from local tests.
