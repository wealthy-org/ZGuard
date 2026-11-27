# Chain 46630 V2 venue review

## Decision

**Withhold venue admission. Do not deploy, register, or expose the V2 adapter.**

This is a non-release staging decision. A source-verifiable Uniswap-v2-compatible implementation exists on Robinhood Chain Testnet, but implementation integrity is not enough to establish venue provenance, durable liquidity, or current independent use.

The machine-readable review is committed at `deployments/robinhood-testnet.v2-venue-review.json`. Re-run it with:

```bash
corepack pnpm staging:review-v2
```

The review command reads canonical chain state, all factory pairs, exact `Swap` logs for supported-token pairs, Blockscout verification metadata, and all 11 upstream `Uniswap/v2-core` source files.

## Strong evidence

Factory `0x6C4cA684D84761E193cB23d62b22fA83bB35E54E` has:

- fully verified, unchanged bytecode on Blockscout;
- Solidity `0.5.16`, Istanbul EVM, optimizer enabled with `999999` runs;
- 11 published source files, all exact byte-for-byte matches to `Uniswap/v2-core`;
- runtime codehash `0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0`;
- 175 pairs at the recorded review block;
- `feeTo` unset.

Both supported-token pairs have the canonical pair runtime codehash `0x5b83bdbcc56b2e630f2807bbadd2b0c21619108066b92a58de081261089e9ce5`, report the reviewed factory, and have balances equal to reserves.

| Pair | Address | Current alternate-WETH reserve | All-time swaps | Last swap | All-time WETH-side volume |
|---|---|---:|---:|---|---:|
| WETH/TSLA | `0x3Ca1d41f238949F3c033d5C35c5F01A43036a288` | `0.001603765963958263` | 3 | 2026-07-18 | `0.002396234036041737` |
| WETH/AMZN | `0x37bF748d0808f8AA61e469d98539D91B2C98187d` | `0.015` | 5 | 2026-08-01 | `0.005` |

No factory pair exists for the other currently supported assets: NVDA, AAPL, SPCX, OPENAI, ANTHROPIC, PLTR, NFLX, or AMD.

## Failed admission gates

1. **Provenance is not established.** The creator and current `feeToSetter` are the same unattributed EOA, `0xDBc971fD9D533F1AcDf69597a0B2eadC3Edd9dd7`. Public searches found no protocol-owner attribution. The official Uniswap Robinhood deployment uses different mainnet addresses and has no deployment at these addresses on chain 46630.
2. **Activity is stale and sparse.** The two relevant pairs have eight swaps in total and zero swaps in the most recent 30-day review window.
3. **Meaningful liquidity is not established.** The WETH-side reserves are small, and the project has no reviewed minimum-liquidity or price-impact threshold that would justify calling this a shared venue.
4. **The evidence is testnet-only.** Pair names such as `Uniswap V2` and exact upstream source do not prove that Uniswap or another accountable protocol operates the deployment.

Perm-generated transactions must not be counted as independent activity when reconsidering this decision.

## Dormant implementation boundary

`contracts/src/adapters/PermV2Adapter.sol` is retained only as reviewed, dormant engineering work. It is:

- restricted to the immutable Perm Router;
- pinned to factory, WETH, and pair runtime codehashes;
- restricted to a factory-returned direct pair;
- fail-closed when pair balances differ from reserves;
- based on the canonical `997/1000` exact-input formula;
- tested for ERC-20 and native wrapping paths, malformed routes, wrong pairs, changed code, reserve donations, caller restrictions, and governance rescue;
- covered by an opt-in live-fork test against the reviewed pair.

The hosted quote path additionally requires both an adapter address and an explicit server-side staging flag. The client path requires a separate public flag. Neither is configured, no adapter is deployed, and no router entry is registered.

## Reconsideration requirements

All of the following require a fresh review before any activation:

- credible public venue ownership or protocol attribution;
- an approved quantitative liquidity and maximum-price-impact policy;
- recent independent swaps and sustained volume;
- fresh exact-source, runtime-codehash, reserve, and fork-execution checks;
- explicit non-release deployment approval and new canonical evidence;
- continued `executionReady=false` until every unrelated release gate also passes.
