# Aggregator Hook evidence schema

No Aggregator Hook is currently approved for the Robinhood testnet release. The bounded chain review found only a third-party Realm ETF emitter for the canonical event topics, on a different PoolManager; see [`AGGREGATOR_HOOK_RESEARCH.md`](AGGREGATOR_HOOK_RESEARCH.md). Mainnet observations are not testnet availability.

Fresh Router-v2 candidates leave `hookProviderIds(v4Adapter)` at the zero sentinel, so hook steps fail closed even though direct v4 is enabled. Do not copy the example values below into a candidate. A real entry is added only after official chain-specific provenance, independent source/runtime/dependency review, and a scoped audit artifact exist; governance then codehash-pins the hook and configures the distinct provider identity so a controlled staging settlement can produce canonical evidence.

Each object in candidate-manifest `aggregatorHooks` must use this shape:

```json
{
  "id": "0x<PoolId>",
  "currency0": "0x<currency0>",
  "currency1": "0x<currency1>",
  "fee": 3000,
  "tickSpacing": 60,
  "hooks": "0x<hook>",
  "hookData": "0x<reviewed-static-probe-data>",
  "sourceType": "aggregator-hook",
  "initializationBlock": 1,
  "expectedCodehash": "0x<keccak256-runtime-bytecode>",
  "review": {
    "reviewer": "independent reviewer or firm",
    "reviewedAt": "2026-01-01T00:00:00.000Z",
    "specificationUrl": "https://...",
    "auditReportUrl": "https://...",
    "auditReportSha256": "<64 lowercase hex characters>",
    "calldataSemantics": "Explain every hookData field, bound, recipient and trust assumption.",
    "permissionModel": "Explain owners, upgradeability, pause powers and every privileged actor."
  },
  "quoteProbe": {
    "zeroForOne": true,
    "amountIn": "1000000000000",
    "minimumAmountOut": "1"
  },
  "evidence": {
    "transactionHash": "0x<canonical Router-v2 transaction>",
    "receiptId": "0x<SwapSettled receipt id>",
    "stepIndex": 0
  }
}
```

`pnpm release:verify-hooks` independently checks:

- PoolId recomputation from PoolKey;
- current hook runtime bytecode and expected codehash;
- adapter `verifiedHookCodehashes` state;
- Router hook-provider identity;
- an actual quoter call using the reviewed probe;
- canonical block and confirmation depth;
- exact official-router `RouteStepSettled` evidence; and
- matching `SwapSettled` evidence.

The verifier intentionally requires a real audit artifact URL/hash. If no audited hook exists, the correct status is `pending` and promotion remains blocked.
