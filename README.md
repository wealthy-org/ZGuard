# ZGuard — pre-signing guard for Robinhood Chain (testnet `46630`)

ZGuard checks a payment or swap **before** an agent or wallet signs it, and refuses to let the signer
run unless the verdict is `allow` for exactly the bytes being signed.

> **Status: testnet only.** Run ZGuard on Robinhood Chain Testnet `46630`. Mainnet `4663` stays
> read-only (registry and simulation reads in tests) until the contracts are audited and owned by a
> multisig. Do not treat any output as a mainnet production guarantee.

## What it does

Every request goes through three deterministic checks. Any `deny` gives `deny`, any `abstain` gives
`abstain`, and only three `allow`s give `allow`. If a required check is missing, the result is never `allow`.

1. **`checks.quote` — offline quote-match** (`packages/sdk/src/quote-match.ts`)
   - Compares `payTo`, `asset`, `amount` and `chainId` with the signed 402 quote or router intent (`Q-001`…`Q-005`).
   - Rejects unexpected `approve`/`permit` calls unless an allow-list entry matches token, spender and a capped amount (`Q-006`).
   - Requires the signed EIP-712 domain `chainId` + `verifyingContract`; otherwise it returns `abstain Q-007`. The
     domain is also compared with the onchain domain read at startup.
   - Any bytes it cannot decode or re-encode return `abstain Q-DECODE`. This includes intents without the exact `tx`,
     and recursive `multicall`/`execute`.
   - Rejects ETH `value` on ERC-20 calls.
2. **`checks.simulation`** runs `eth_simulateV1` (`traceTransfers`) on RHC and reports balance deltas,
   `S-APPROVE`, `S-REVERT`, `S-DIFF` and `S-SEQUENCER`.
3. **`checks.token_risk`** classifies a token by contract address, never by ticker, into one of:
   `usdg`, `stock_token` (Robinhood registry + Chainlink), `pons_curve`, `pons_graduated_v4` or `other`.

`guardEvmSigner` (`packages/sdk/src/signer.ts`) throws before the wallet is called in these cases:
the verdict is not `allow`, the `payload_hash` does not match the bytes being signed, the TTL has expired,
or the guard is disabled (`GuardDisabledError`).

## What is real and what is not yet

| Area | State | Evidence |
|---|---|---|
| Quote-match, signer wrapper, API client, CLI | Implemented | `pnpm test` (offline suites) |
| `/v1/*` API (Hono) + Neon store | Implemented. Production needs `DATABASE_URL` (no JSON fallback) | `apps/api/test/offline.test.ts`, `poc-store.test.ts` |
| x402 billing in USDG | Credit is given only after real settlement: an `onchain` relayer **or** a `deposit` tx bound to the payer by `claimSignature`, both with N confirmations. `offchain` is dev only and refused in production | `poc-x402.test.ts`, `deposit.test.ts` |
| Rate limits, admin-only revenue, CORS allow-list, p50/p95/p99 metrics | Implemented | `offline.test.ts` |
| Perm / Terminal guards (`createPermRouterGuard`, `createTerminalSwapGuard`) | **SDK helpers only.** They must be wired into the external Perm/Terminal repos | `c8-integrations.test.ts` |
| MCP server (5 tools) | Implemented in `packages/mcp`; **not published to npm** (run from the repo) | live acceptance §9.6 |
| ZK verifier contract `ZGuardQuoteVerifier.sol` | Accepts only SP1 gateway proofs. Config changes go through a 2-day timelock; ownership transfer is two-step. **Not deployed** | `forge test` (7 tests; fake proofs revert) |
| ZK rule engine `packages/zk/quote-rules` | Rust `no_std`. Its public values are byte-identical to the TypeScript SDK | `cargo test` (5 tests) |
| SP1 guest `packages/zk/sp1-quote-guest` | **Scaffold.** It has not been built with `cargo prove build`, has no vkey and no prover service | — |
| Halo2 circuit `packages/zk/halo2-quote-circuit` | **Skeleton.** It has no prover, verifier or tests. Disabled by default (`ZGUARD_ZK_HALO2_ENABLED=false`) | — |
| ZK attestations from the API | Stay `pending` until a prover URL, a vkey and a verifier are configured. `verified` is set only from a `verifySp1QuoteProof` receipt | `zk-honesty.test.ts` |
| Browser wallet in the web app | Connect uses `eth_requestAccounts` + `wallet_switchEthereumChain` only; nothing is signed on connect | `apps/web/test/wallet.test.ts` |

Phase 2 (not built): Base/Solana settlement relayers, `/v1/watch` webhooks, signed metadata badges,
own holder indexer, LLM text scanner, automatic buyback/burn, and shielded payments.

## Monorepo

```text
apps/web    Next.js 15 UI. /v1/* and /health are proxied to the API (ZGUARD_INTERNAL_API_URL)
apps/api    Hono /v1/* server (Vercel function) + Neon Postgres + x402 USDG billing
packages/sdk  quote-match, signer wrapper, client, CLI, Perm/Terminal helpers
packages/mcp  MCP stdio server
packages/zk   ZGuardQuoteVerifier.sol + Foundry tests, quote-rules crate, SP1 guest scaffold, Halo2 skeleton
```

## Quickstart

```bash
corepack enable && pnpm install
cp .env.example .env          # every variable is documented there
pnpm dev                      # API :8787, web :3000 (default chain 46630)
```

Without `DATABASE_URL`, local development uses `.data/zguard-dev-store.json`. In production
(`NODE_ENV=production`) a missing or unreachable database fails closed (`abstain P-UNAVAIL`).

## Tests

```bash
pnpm test         # offline: build sdk/zk, run API + SDK + ZK-honesty suites, then the web wallet-store test
pnpm typecheck
pnpm test:live    # live RHC RPC: testnet 46630 suite + read-only 4663 acceptance suite
pnpm test:sol     # forge test (needs Foundry)
pnpm test:rust    # cargo test for quote-rules (needs Rust)
```

CI (`.github/workflows/ci.yml`) runs install, build, typecheck, offline tests, `forge test` and
`cargo test` on every push and PR. The live suites run only when started manually.

## Deploy (Vercel, two projects)

| Project | Root dir | Required env |
|---|---|---|
| Web | `apps/web` | `ZGUARD_INTERNAL_API_URL=https://<api-project>.vercel.app`. If it is missing, `/v1/*` returns 503 `misconfigured` (no redirect loop) |
| API | `apps/api` | `ZGUARD_ACTIVE_CHAIN_ID=46630`, `DATABASE_URL`, `ZGUARD_X402_PAY_TO`, `ZGUARD_ADMIN_API_KEY`, `ZGUARD_CORS_ORIGINS`, `ZGUARD_DEV_FREE_CREDIT_MICRO_USDG=0` |

## ZK path to "verified" (operator steps)

1. `cd packages/zk/sp1-quote-guest && cargo prove build`, then `cargo prove vkey`. Set `ZGUARD_ZK_SP1_PROGRAM_VKEY`.
2. Run an SP1 prover service and set `ZGUARD_ZK_SP1_PROVER_URL`.
3. `pnpm deploy:verifier` on **46630** with `ZGUARD_ZK_SP1_GATEWAY` and the vkey. Transfer ownership to a
   multisig (`transferOwnership` → `acceptOwnership`). Set `ZGUARD_ZK_VERIFIER_ADDRESS`.
4. Optionally set `ZGUARD_ZK_VERIFIER_PRIVATE_KEY` so the API records `verifySp1QuoteProof` and reports `verified`.

The proof covers the quote scope only: payTo/amount equality, commitments and the verdict bitmask.
Simulation and token risk are never part of the proof.

## SDK example

```ts
import { ZGuardClient, guardEvmSigner, guardOffline } from "@zguard/sdk";

const local = guardOffline({ network: "eip155:46630", quote, payload: { type: "eip3009", authorization } });

const client = new ZGuardClient({ baseUrl: process.env.ZGUARD_API_URL!, apiKey: process.env.ZGUARD_API_KEY });
const safeSigner = guardEvmSigner(walletClient, { guardFn: (req) => client.guard(req) });
```
