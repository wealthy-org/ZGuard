# D4 isolated test-hook evidence runbook

## Status and boundary

This runbook is for one optional Robinhood Chain Testnet (`46630`) evidence operation. The contract is permanently labelled:

> `Perm test hook - not an official Aggregator Hook`

It is **not** an official Uniswap Labs Aggregator Hook, does not close provenance or independent-audit gaps, must never enter either deployment manifest, and must never enable Production Aggregator Hook routing. Router v2 remains non-release staging with `executionReady=false`.

As of 2026-11-17, the package has passed local fork rehearsal only. No D4 live transaction has been sent.

## Irreversible testnet effects

A successful first live run makes permanent public testnet writes:

1. deploys the ownerless test hook at the reviewed CREATE2 address if it is still vacant;
2. initializes its canonical WETH/TSLA PoolKey if it is not already initialized;
3. deploys a fresh isolated Router and adapter;
4. executes one bounded WETH→TSLA swap;
5. claims the isolated Router's WETH fee back to the operator and verifies zero route-token balances;
6. pauses the isolated Router; and
7. renounces ownership of both isolated contracts, making that stack permanently frozen.

The hook deployment and PoolKey initialization cannot be removed. The isolated Router cannot be unpaused after ownership is renounced. Depending on existing hook/pool state, the command submits **12–14 testnet transactions**. It never writes either official/staging manifest or configures an existing Router.

## Reviewed identity

| Field | Reviewed value |
|---|---|
| Chain | `46630` only |
| Provider identity | `PERM_TEST_AGGREGATOR_HOOK` |
| CREATE2 deployer | `0x4e59b44847b379578588920cA78FbF26c0B4956C` |
| Salt nonce | `6218` |
| Predicted hook | `0x4B6aDd241E2bF18Fdd570b664a8fc642Ff0D6888` |
| Init-code hash | `0x5d33494be3c63be9cf163d217a3e74ef1360e525ea2380c3bf7c9d2e15a78a63` |
| Runtime codehash | `0x3908f518529f4e2e5b961cfed36d44df9c08eee2722cbd5c42e82043f964cdca` |
| PoolId | `0xdffa836390fce6d1288ea90737aeed11af20557ce24932289ef802a4a4ffd881` |

Any mismatch aborts the operation; all pre-existing dependency, plan, and configuration mismatches are checked before the first deployment transaction.

## Mandatory preconditions

Run from the repository root and from the exact reviewed commit.

- The checkout must be committed and `git status --porcelain --untracked-files=all` must be empty.
- Use only a locally configured, testnet-only operator key. Never paste a key, seed phrase, RPC credential, or secret-manager value into chat, a commit, or a ticket.
- The operator needs testnet native ETH for the bounded WETH input and 12–14 transactions.
- Reproduce the full local gates from that clean checkout:

```bash
corepack pnpm check
corepack pnpm contracts:test:fork
corepack pnpm contracts:coverage
corepack pnpm contracts:coverage:test-hook
corepack pnpm audit:prod
corepack pnpm audit:security
corepack pnpm contracts:plan:test-hook
corepack pnpm contracts:rehearse:test-hook
```

Run the exact Slither CI command with project Hardhat first on `PATH`:

```bash
PATH="$PWD/node_modules/.bin:$HOME/.local/bin:$PATH" \
  slither . --exclude-dependencies --filter-paths 'contracts/src/mocks|contracts/test'
```

The planner must reproduce every value in the reviewed-identity table and report either the exact reviewed runtime or `vacant`. Rehearsal output is local-only and is not D4 evidence.

## Local secret setup

Load these values only through the operator's local shell or secret manager:

- `DEPLOYER_PRIVATE_KEY` — a testnet-only key;
- `RH_TESTNET_RPC_URL` — optional managed chain-46630 RPC; the public default is used when omitted.

Do not include either value in a command copied to chat. The key must not be a production, mainnet, treasury, governance, or long-lived signer key.

The default input is `100000000000000` wei (`0.0001 WETH`). An override is accepted only in this closed interval:

```text
1000000000000 <= TEST_HOOK_AMOUNT_IN_WEI <= 1000000000000000
0.000001 WETH <= input <= 0.001 WETH
```

## Live operation

Set the exact acknowledgement locally, then run the single operator command:

```bash
export CONFIRM_NON_OFFICIAL_TEST_HOOK=I_UNDERSTAND_THIS_IS_A_NON_OFFICIAL_TESTNET_FIXTURE
corepack pnpm contracts:deploy:test-hook
```

The runner fails closed on the wrong chain, a dirty checkout, a source/compiler/hash drift, changed dependencies or pool configuration, wrong label/immutables, an unbounded amount, missing settlement events, retained route tokens, or failure to freeze the isolated stack.

It maintains a mode-`0600` local operation journal at `.staging/test-hook-operation.json`. On success it writes mode-`0600` evidence to `.staging/test-hook-evidence.json`. Both files are ignored and must not be committed as release manifests.

After the command exits, remove the signing key from the shell before doing anything else:

```bash
unset DEPLOYER_PRIVATE_KEY
```

## Independent read-only verification

Wait for the desired confirmation depth, then run:

```bash
TEST_HOOK_EVIDENCE_CONFIRMATIONS=3 corepack pnpm staging:verify-test-hook
```

This command does not send transactions. It recompiles from the clean evidence commit and independently verifies:

- every recorded receipt, sender, nonce sequence, target, calldata, and deployment init code;
- CREATE2 identity, hook/PoolManager/external-pool runtime hashes, PoolKey, and external-pool configuration;
- isolated Router/adapter state, provider identity, codehash pins, consumed quote, zero token balances, fee cleanup, pause, and ownership renunciation;
- exact one-step WETH→TSLA calldata and the bounded amount;
- canonical external `Swap`, `HookSwap`, `RouteStepSettled`, `SwapSettled`, `FeeClaimed`, `Paused`, and ownership events;
- zero hook admission on the existing public staging Router/adapter; and
- unchanged official/staging manifests, disabled Aggregator Hooks, and `executionReady=false`.

If verification fails only because confirmation depth is insufficient, wait for more blocks and rerun **the verifier**, not the deployment command.

## Failure handling

The runner writes each submitted hash to the private operation journal before awaiting its receipt. On an ordinary caught failure after an isolated Router exists, it makes a best-effort attempt to claim any isolated fee, pause the Router, and renounce adapter/Router ownership. Its final error report states either:

- `isolatedStackSecure: true` — cleanup was verified; or
- `isolatedStackSecure: false` — manual review is required.

Do not blindly rerun the deployment command after any failure. Preserve the local journal, keep the key private, and inspect one recovery fact at a time. A failed or rehearsal file cannot pass the live verifier and must not be described as D4 evidence.

## What D4 can and cannot establish

A verified live package can establish only that the explicitly non-official fixture settled one bounded testnet route through an isolated, subsequently frozen Router stack. It does **not** establish official provenance, official hook admission, Production safety, independent audit approval, governance approval, unrestricted execution readiness, or mainnet readiness.
