# Aggregator Hook chain review

## Decision

No Aggregator Hook is approved for Perm on Robinhood Chain Testnet (`46630`). Keep all of the following unchanged:

- `providers.uniswapV4AggregatorHook.enabled: false`;
- `reviewedHooks: []`;
- Router `hookProviderIds(v4Adapter)` at the zero sentinel; and
- no `setVerifiedHook` or `configureHookProvider` governance action.

Mainnet (`4663`) observations are research context only. They do not establish testnet availability and must never be copied into a chain-`46630` manifest.

## Isolated Perm test fixture — explicitly non-official

The repository now contains `PermTestAggregatorHook`, an ownerless chain-`46630` fixture for testing settlement mechanics. This carve-out does **not** change the decision above: it is not an official Uniswap Labs Aggregator Hook, it cannot satisfy official provenance or audit gates, and it must not be entered in `reviewedHooks` or enabled through the Production Aggregator Hook provider.

Its on-chain label is fixed to `Perm test hook - not an official Aggregator Hook`. If admitted to an allowlisted test environment later, its distinct Router-v2 provider identity is `PERM_TEST_AGGREGATOR_HOOK` (`0x67f39816b175ceb3cdf2f397ce1cb1a16dfc3835367cb517875789b7abfaee6e`), never `UNISWAP_V4_AGGREGATOR_HOOK`.

### Predeployment containment

- Constructor deployment is forbidden unless `block.chainid == 46630`.
- The immutable PoolManager must be `0x8366a39CC670B4001A1121B8F6A443A643e40951` with runtime codehash `0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626`.
- The planned immutable external venue is Synthra WETH/TSLA pool `0x593e2e0EF3869616Ec3Fbe989dCFf2699D52b69B`, pinned to runtime codehash `0x957b9c75dd4bb82220fe2058038825c5ba1633543526ef6e3d61c0560d501115`.
- The only accepted PoolKey is WETH `0x33e4191705c386532ba27cBF171Db86919200B94` / TSLA `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`, fee `3000`, tick spacing `60`, and the fixture itself as hook.
- Liquidity and exact-output paths fail closed. Callback sender, active-swap context, PoolId, amount, direction/currency, one-payment semantics, external runtime codehash, and exact output settlement are checked.
- Transient callback state is cleared after every successful swap; transaction rollback clears it on every failure.
- Router-v2 independently pins the fixture runtime codehash before a hook-backed route can execute.

The current deterministic CREATE2 plan, produced by `pnpm contracts:plan:test-hook`, is:

- singleton deployer: `0x4e59b44847b379578588920cA78FbF26c0B4956C`;
- salt: `0x000000000000000000000000000000000000000000000000000000000000184a`;
- init-code hash: `0x5d33494be3c63be9cf163d217a3e74ef1360e525ea2380c3bf7c9d2e15a78a63`;
- predicted address: `0x4B6aDd241E2bF18Fdd570b664a8fc642Ff0D6888`;
- low permission bits: `0x2888`; and
- expected runtime codehash: `0x3908f518529f4e2e5b961cfed36d44df9c08eee2722cbd5c42e82043f964cdca`.

These values are compiler- and source-sensitive. The planning command and fork suite must reproduce all of them immediately before any transaction is signed.

### Predeployment proof

The isolated suite performs a local CREATE2 deployment through the singleton deployer, initializes the canonical PoolKey, and settles WETH→TSLA and TSLA→WETH exact-input routes through Perm Router-v2. It checks canonical `AggregatorPoolRegistered`, `HookSwap`, external-pool `Swap`, `RouteStepSettled`, and `SwapSettled` evidence. Negative cases cover wrong-chain construction, bad initialization and swap keys, unauthorized PoolManager and callback callers, callback-without-active-swap, hook data, liquidity, exact output, callback replay, nested swap reentrancy, wrong callback currency, partial input, short output, external venue code drift, and adapter-pinned hook code drift.

Run all isolated gates before considering a live testnet transaction:

```sh
pnpm contracts:test
pnpm contracts:test:fork
pnpm contracts:coverage:test-hook
pnpm contracts:plan:test-hook
pnpm contracts:rehearse:test-hook
```

The dedicated rehearsal runner reproduces the reviewed CREATE2/init/runtime hashes, deploys and configures only a fresh isolated Router/adapter stack with provider `PERM_TEST_AGGREGATOR_HOOK`, executes a bounded WETH→TSLA route, clears isolated fee/token balances, pauses the Router, and renounces both owners. Its independent verifier was exercised end-to-end against a persistent latest-state local fork; rehearsal hashes remain local and are rejected as live evidence.

The live runner additionally requires the exact non-official acknowledgement and a clean committed checkout. It writes a private operation journal before awaiting each receipt. The read-only verifier binds evidence to the same clean commit, recompiles source, validates every canonical transaction/calldata/event and current contract state, proves the isolated stack is paused/ownerless/token-clean, and confirms the existing staging stack and both manifests still exclude the hook. The complete operator procedure and irreversible effects are in [`TEST_HOOK_EVIDENCE.md`](TEST_HOOK_EVIDENCE.md).

As of 2026-11-17, no live fixture deployment, PoolKey initialization, isolated live Router deployment, hook-provider configuration, or manifest admission has occurred. Production routing remains disabled and `executionReady` remains false.

## Evidence standard

A nonzero hook address, expected address flags, matching event topics, a hooklist submission, or successful swaps are not sufficient authentication. Before onboarding, one chain-specific candidate must have all of the following:

1. an official deployment record and exact correspondence to a pinned `Uniswap/v4-hooks-public` commit;
2. reproducible compiler settings, constructor arguments, immutable values, and runtime codehash;
3. the expected PoolManager and reviewed external factories, pools, proxies, callbacks, and privileged actors;
4. a published audit artifact whose scope covers the deployed implementation;
5. a canonical PoolKey and initialization transaction on chain `46630`;
6. a bounded quote probe; and
7. a successful hook-backed Perm Router-v2 settlement with canonical `HookSwap`, `RouteStepSettled`, and `SwapSettled` evidence.

## Robinhood testnet (`46630`)

### Topic scan

A bounded public-RPC scan covered blocks `121317900` through `155850845`. It used 1,152 requests of at most 30,000 blocks and searched all emitters for:

- `AggregatorPoolRegistered(bytes32)`: `0xe4e250d624b5ed2f65699d87988884c47eac735ffb1dcccead084c5254b14373`
- `HookSwap(bytes32,address,int256,int256,uint24)`: `0x6150bb53cd76c5702d6074239fc7b6c2a5495d339eb122fdc06252f3efdbbc1b`

The scan found 26 logs: 13 registrations and 13 swaps. Every log came from one emitter:

`0xB5623BD9c3df7cce689D8332D9eD9cf2E43168c8`

That emitter is rejected:

- Sourcify identifies it as third-party `RealmEtfHook`, not a contract from `Uniswap/v4-hooks-public`.
- Its runtime codehash is `0x403739434f9802fd1c4b24d9fd10ce28ea36942bebc3983d02f27706b8040941`.
- Its immutable PoolManager is `0x552815eF68E6eb418A3d65D0AA1043d93204F612`.
- Perm and the reviewed Uniswap deployment use PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`.
- Its source and deployment belong to the Realm ETF system. Implementing `IAggregatorHook` and emitting the same topics does not make it a canonical Uniswap Labs Aggregator Hook.

References:

- [Sourcify exact runtime match](https://repo.sourcify.dev/46630/0xB5623BD9c3df7cce689D8332D9eD9cf2E43168c8)
- [Testnet explorer contract](https://explorer.testnet.chain.robinhood.com/address/0xB5623BD9c3df7cce689D8332D9eD9cf2E43168c8)
- [Realm ETF implementation pull request](https://github.com/RealmLaunchpad/realm-contracts/pull/19)

### Official-PoolManager scan

A separate scan decoded all 23,193 `Initialize` logs emitted by PoolManager `0x8366…0951` from block `121317900` through `155850689`. It observed 1,423 unique nonzero hook addresses. Twenty addresses had the same low-14-bit permission pattern (`0x2888`) used by the official `BaseAggregatorHook`; none emitted the canonical registration topic in their sampled initialization receipts. The all-emitter topic scan above likewise found no registration or swap event from an official-source candidate attached to this PoolManager.

This is a point-in-time negative result, not proof that a deployment can never appear. A fresh bounded scan is required before any future review.

## Robinhood mainnet (`4663`) context

The strongest mainnet-only Slipstream research candidate is:

`0xA1AD09c98710d2C709e3bea03708823255312888`

Verified observations:

- Sourcify reports a source/bytecode Match for `SlipstreamAggregator`.
- All ten repository-owned source files in the Sourcify compilation match official commit `09a9dc5f9a8f10d7c9ed275261a75201e9d2b48c` byte for byte.
- Compiler settings match that commit's default profile: Solidity `0.8.29+commit.ab55807c`, optimizer enabled with `44,444,444` runs, Cancun EVM, no IR, and no metadata bytecode hash.
- Constructor/immutable values bind PoolManager `0x8366…0951` and CL factory `0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3`.
- Runtime codehash is `0x537d4b59539aa00520d3f9885e00707e9a7bfe6670455ae54a3099e9b53129c7`.
- Registration transaction `0xba4c1cbcb74281f405b168c3cc93240bb0494b0ae84ad2357edaffa60544ca5d` created PoolId `0x9ef343fe68e0702b7013a38444b2123e61e8cab2ede3f575a0d5b77cb1f8c95b` for WETH/UP, dynamic fee `0x800000`, tick spacing `200`, and that hook.
- `poolIdToExternalPool` resolves the PoolId to `0x23D641FeCcD207E8794c593e8240444A0674C4Ba`.
- Successful transaction `0xdbd70c66a82bf6814be3c9896e18668a09cd1929da301e7709d7a3898a31c9ee` contains the external pool's V3-compatible `Swap`, the hook's `HookSwap`, and PoolManager's `Swap` logs.

A local read-only chain-`4663` fork now also proves PermV4Adapter compatibility. `pnpm contracts:test:mainnet-hook` executes WETH→UP through the existing hook and requires canonical `HookSwap`, a Router-v2 `RouteStepSettled` with nonzero hook, and exact runtime codehash `0x537d…29c7`. The provider identity is deliberately `UNAPPROVED_MAINNET_HOOK_COMPATIBILITY`, and the test cannot authorize admission or send a mainnet transaction.

A same-state snapshot comparison at source block `119976784` is recorded in [`TRADE_COMPARISON.md`](TRADE_COMPARISON.md). For `0.001 WETH`, Perm routed `0.0009985 WETH` after its net `0.15%` platform fee and delivered `16.486093291644107017 UP`; the minimal direct same-pool harness routed the full input and delivered `16.510859559280844704 UP`. Gas remains separate because no pinned native→UP conversion was used.

This evidence establishes a functioning mainnet implementation and Perm adapter compatibility, not a Perm-approved provider. The public official sources reviewed so far do not publish a deployment-address map tying this address to an authorized Uniswap Labs rollout, and the official repository does not publish an Aggregator Hook audit report in its audit table. Those provenance and assurance gaps remain blocking even on `4663`.

References:

- [Official source anchor](https://github.com/Uniswap/v4-hooks-public/tree/09a9dc5f9a8f10d7c9ed275261a75201e9d2b48c/src/aggregator-hooks)
- [Sourcify mainnet match](https://repo.sourcify.dev/4663/0xA1AD09c98710d2C709e3bea03708823255312888)
- [Official launch announcement](https://blog.uniswap.org/aggregator-hooks-are-now-live)

Other resolved mainnet addresses remain unapproved. In particular, bounded observations for `0xA1f9CDa5fB5c662eA7712302e3aB7BDAAcd92888` found one registration and no `HookSwap`, while `0xb091eC27074C7a0C1bA896C063cc677F89202888` is a third-party PonsCurve deployment.

## Unblock conditions

Do not create a reviewed registry entry until an official chain-`46630` record supplies an address and audit artifact. Then repeat the source/compiler/runtime comparison, verify PoolManager and every external dependency, reconstruct the PoolKey from the canonical initialization receipt, execute the quote probe, and produce a controlled allowlisted Router-v2 settlement. If any identity or settlement check fails, leave the provider disabled.
