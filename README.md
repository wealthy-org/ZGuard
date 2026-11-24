# ZGuard — Scanner & Guard Layer on Robinhood Chain (`4663` / Testnet `46630`)

Pre-signing guard & scanner layer for AI agents, wallets, and operators on **Robinhood Chain** (`eip155:4663`, testnet `46630`).

Before an agent or wallet signs a payment or swap on RHC, **ZGuard** runs three deterministic checks plus content scanning and asynchronous BN254 zero-knowledge quote attestations:
1. **`checks.quote` (Offline Quote-Match)**: Verifies `payTo`, `asset`, `amount`, and `chainId` against the out-of-band `402` quote or router `intent` (`Q-001`..`Q-007`), blocks unexpected `approve`/`permit` selectors (`Q-006`), verifies EIP-712 domains strictly from installed contracts (`Q-007` abstain otherwise), and fails closed on undecodable bytes (`Q-DECODE`).
2. **`checks.simulation` (Live RHC Simulation)**: Simulates transactions on Robinhood Chain `4663` **or** `46630` via `eth_simulateV1` (`traceTransfers: true`), extracting balance deltas, surfaced allowances (`S-APPROVE`), revert reasons (`S-REVERT`), output mismatches (`S-DIFF`), L2 sequencer health (`S-SEQUENCER`), and named calls (`PoolManager` v4, pons V2 `memeHook`, curves, routers).
3. **`checks.token_risk` (Live RHC Token Risk)**: Classifies tokens strictly by contract address — never by ticker — into `usdg`, `stock_token` (official Robinhood `https://api.robinhood.com/rhj/assets` registry + Chainlink feeds + ERC-8056 `uiMultiplier`), `pons_curve` (pons V2/V1 curve state, reserves, snipe tax, graduation progress), `pons_graduated_v4` (permanently locked Uniswap v4 pool + meme hook), and `other` (mint/owner/pause & ticker-twin impersonation checks).

**Default target is Robinhood Chain Testnet (`46630`)** — zero real fees, live `eth_simulateV1`, live Blockscout holder scans, and browser-wallet EIP-712 signing. Switch to Mainnet (`4663`) via `ZGUARD_ACTIVE_CHAIN_ID=4663`.

---

## Monorepo Architecture (`pnpm` Workspaces — Zero Vite)

```text
ZGuard/
├── apps/
│   ├── web/            # @zguard/web — Next.js 15 (App Router) + Tailwind CSS v4 UI (zero Vite)
│   └── api/            # @zguard/api — Hono /v1/* server + Neon Serverless Postgres + x402 USDG billing
└── packages/
    ├── sdk/            # @zguard/sdk — Offline quote-match, content scanner, guardEvmSigner, CLI (`zguard`)
    ├── mcp/            # @zguard/mcp — MCP stdio server for Claude Code, Cursor & OpenClaw (5 tools, offline-capable)
    └── zk/             # @zguard/zk  — SP1 Rust guest, Halo2-KZG circuit, ZGuardQuoteVerifier.sol & BN254 prover
```

---

## Live Onchain Verification Summary

All `[PERLU CEK]` items from the Dev Brief were verified directly against live RHC endpoints:

### Mainnet (`4663`)
- **USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`)**: `name() = "Global Dollar"`, `version = "1"`, `decimals() = 6`, `DOMAIN_SEPARATOR() = 0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036`, EIP-3009 `TransferWithAuthorization` & `ReceiveWithAuthorization` active.
- **Official Stock Token Registry**: `GET https://api.robinhood.com/rhj/assets` (`chainId: 4663`, `ASSET_STATUS_ACTIVE`) + ERC-8056 `uiMultiplier()` + Chainlink feeds (`https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`).
- **Simulation RPC**: `eth_simulateV1` with `traceTransfers: true` active on public RHC mainnet RPC.
- **BN254 ZK Precompiles**: `0x06` (`ecAdd`), `0x07` (`ecMul`), and `0x08` (`ecPairing`) active on RHC `4663`.
- **Pons V2 Factory (`0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`)**: `getLaunchedToken(token)` resolves `phase` (`0` curve → `pons_curve`, `2` PoolCreated → `pons_graduated_v4` with `memeHook` `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044`), curve reserves, and fee policies.

### Testnet (`46630`)
- **USDG (`0x7E955252E15c84f5768B83c41a71F9eba181802F`)**: `name() = "Global Dollar"`, `version = "1"`, `decimals = 6`, EIP-3009 active, `DOMAIN_SEPARATOR = 0xb1debe91e09d82163fd9cddaab89359061c0671664e1611258a3c3de7c2d950b`.
- **WETH (`0x33e4191705c386532ba27cBF171Db86919200B94`)**, **Stock Tokens** (TSLA, AMZN, AMD, PLTR, NFLX), **Pons curve** (KOIP, PONSIDOOG), **PoolManager v4** — all deployed and verified.
- **Mock USDG (`0x8F9231B0F448bA9AD045348437458721676c23BC`)**: open faucet/mint, USDG ticker lookalike → denied with `T-MINT` + `C-FINDING` + `T-LP`.
- **Testnet Blockscout v2 API**: `https://explorer.testnet.chain.robinhood.com/api/v2/*` returns `200 OK` with holders, verified proxies, and token metadata.
- **Faucet**: `https://faucet.testnet.chain.robinhood.com`.

---

## MVP Status (Dev Brief §8.1)

| # | Brief Item | Status | Notes |
|---|---|---|---|
| 1 | `POST /v1/register` | ✅ | Tenant + API key creation; optional `X-PAYMENT` top-up |
| 2 | `GET /v1/token/{chainId}/{address}` | ✅ | 404 = not observed (never `allow`) |
| 3 | `POST /v1/verify` | ✅ | x402 quote-match; HTTP 402 with payable quote when credit = 0 |
| 4 | `POST /v1/simulate` | ✅ | `eth_simulateV1` on RHC 4663/46630; `S-REVERT`, `S-APPROVE`, `S-FAIL`, `S-SEQUENCER` |
| 5 | `POST /v1/token-risk` | ✅ | All 5 TokenKind classes; holders, oracle, pons state, tax, authorities |
| 6 | `POST /v1/check` | ✅ | SSRF-protected URL scanner + text shape rules; `C-FINDING`, `C-SSRF`; `$0.005` fee waiver |
| 7 | `POST /v1/guard` | ✅ | All 3 checks in one call; `P-UNAVAIL` fail-closed; spend policy support |
| 8 | `GET /v1/balance` | ✅ | Credit ledger; free credit for dev |
| 9 | `GET /v1/receipts` | ✅ | Tenant receipt ledger (balance, log, payload hashes) |
| 10 | SDK TypeScript (quote-match offline) | ✅ | `<10ms` offline; `Q-001`..`Q-007`, `Q-DECODE` |
| 11 | SDK wrapper signer (`guardEvmSigner`) | ✅ | Blocks deny/abstain/expired; allows only valid `allow` |
| 12 | SDK API client (`ZGuardClient`) | ✅ | Typed client for all `/v1/*` endpoints |
| 13 | SDK CLI (`zguard`) | ✅ | `verify`, `check-text`, `guard`, `token-risk`, `register`, `balance` |
| 14 | MCP server (5 tools) | ✅ | `guard_payment`, `guard_transaction`, `check_token`, `check_before_use`, `guard_bundle` |
| 15 | Three checks in `POST /v1/guard` on `4663` | ✅ | Live-verified with fixtures (allow + deny Q-001) |
| 16 | Asset awareness (USDG, WETH, Stock Token, Pons, v4) | ✅ | All verified live on both chains |
| 17 | Default-on: Perm / Terminal | ✅ | `createPermRouterGuard`, `createTerminalSwapGuard` in SDK |
| 18 | Billing x402 in USDG RHC | ✅ | Onchain `transferWithAuthorization` relayer settlement |
| 19 | Receipt/dashboard page | ✅ | Live tenant ledger in Web UI (`/api` view) |
| 20 | Integration docs (Perm, Terminal, MCP) | ✅ | DocsPage + MCP host configs (Claude Code, Cursor, OpenClaw) |
| 21 | Treasury buyback/burn config | ✅ | Config present; auto-buyback = Phase 2 |
| 22 | ZK layer: Groth16 (SP1) | ✅ | Rust guest + BN254 verifier + `eth_simulateV1` gas measurement |
| 23 | ZK layer: Halo2-KZG (target) | ✅ | Rust circuit + Solidity verifier via `snark-verifier` |
| 24 | `GET /v1/attestation/{decisionId}` | ✅ | Async proof status, public inputs, `verifierGasUsed` |
| 25 | BN254 precompiles on 4663/46630 | ✅ | `0x06`, `0x07`, `0x08` verified active |
| 26 | OpenClaw MCP host config | ✅ | `mcp-hosts.example.json` includes `openclaw` block |

### Phase 2 Items (Not Yet Built — Outside MVP)

| # | Brief Item | Status | Notes |
|---|---|---|---|
| P1 | USDC Base & Solana payment rails | ⚠️ Partial | Quote-match logic exists in SDK (`solana_spl`, Base USDC EIP-712 domains); no live settlement relayer for Base/Solana |
| P2 | Hook coding-agent (`wormhole-guard` equivalent) | ❌ | Write/read/outbound/harden baseline hash — not implemented |
| P3 | Signed metadata attestation + badge + 24h expiry | ❌ | Not implemented |
| P4 | `/v1/watch` + signed webhooks | ❌ | Webhook delivery exists in ZK prover options, but `/v1/watch` endpoint not built |
| P5 | `inspectTransaction` with preset intent (Universal Router v4, Permit2) | ❌ | Not implemented |
| P6 | Own holder index, reputation, velocity cap, human-approval dashboard | ❌ | Using Blockscout API; no custom indexer or dashboard |
| P7 | LLM as text scanner supplement | ❌ | Shape rules only; no LLM evaluator |
| P8 | Chain expansion beyond 4663 for simulation/token risk | ❌ | RHC only |
| P9 | Automatic onchain buyback/burn from API revenue | ❌ | Config present; mechanism = Phase 2 |
| P10 | Shielded x402 payment | ❌ | Explicitly deferred (non-MVP) |

---

## Quickstart

### 1. Install Dependencies (`pnpm`)
```bash
pnpm install
cp .env.example .env
```

### 2. Connect Neon Serverless Postgres (Optional in Dev, Required in Prod)
Set `DATABASE_URL` in `.env` from your Neon Console (`postgresql://user:pass@ep-...neon.tech/neondb?sslmode=require`):
```bash
# Push schema via Drizzle Kit (apps/api also auto-bootstraps tables on first request)
pnpm db:push
```
- When `ZGUARD_STORAGE_MODE="auto"` and `DATABASE_URL` is unset, `@zguard/api` uses `.data/zguard-dev-store.json` for zero-config local development.
- When `ZGUARD_STORAGE_MODE="neon"` (or if Neon becomes unreachable), policy/storage errors fail closed with `decision: "abstain"` and `codes: ["P-UNAVAIL"]` — never `allow`.

### 3. Run Development Servers (`apps/api` + `apps/web`)
```bash
pnpm dev
```
- **API (`@zguard/api`)**: `http://0.0.0.0:8787` (`/health`, `/v1/config`, `/v1/register`, `/v1/balance`, `/v1/receipts`, `/v1/token/:chainId/:address`, `/v1/verify`, `/v1/simulate`, `/v1/token-risk`, `/v1/check`, `/v1/guard`, `/v1/attestation/:decisionId`)
- **Web (`@zguard/web`, Next.js 15)**: `http://0.0.0.0:3000` (proxies `/v1/*` cleanly to `apps/api`)
- **Default chain**: Testnet `46630` (zero real fees). Set `ZGUARD_ACTIVE_CHAIN_ID=4663` for Mainnet.

### 4. Build & Run Live Acceptance Tests
```bash
pnpm build
pnpm test
```
- **20/20 tests passing**: 10 Mainnet `4663` acceptance + 10 Testnet `46630` acceptance (quote-match, simulation, token-risk, guard, signer, SSRF, ZK attestation, registry, content scanning).

### 5. Deploy ZK Verifier to RHC
```bash
pnpm deploy:verifier
```
Deploys `ZGuardQuoteVerifier.sol` (solc 0.8.28) to RHC Testnet `46630` (zero fees) or Mainnet `4663`. Set `ZGUARD_ZK_VERIFIER_ADDRESS` in `.env` after deployment.

---

## Web UI Views

The Next.js SPA includes 9 interactive views with Testnet `46630` ↔ Mainnet `4663` toggle:

| View | Description |
|---|---|
| **Home** | Hero, positioning, three-check pipeline overview |
| **Console** | Live `POST /v1/guard` runner with 6 scenarios + Browser Wallet EIP-3009 demo |
| **Registry** | Live token kind resolver, Stock Token table, Pons stack, v4 references |
| **ZK** | Groth16 / Halo2-KZG prove workbench with live `verifierGasUsed` |
| **Checks** | Three-check reference with aggregation rules |
| **Architecture** | Data path, exploded 3D stack, fail-closed simulator |
| **API** | Endpoint reference, live tenant ledger (balance, receipts, charge log) |
| **Docs** | Integration docs for Perm, Terminal, MCP |
| **FAQ** | Brief-aligned FAQ |

---

## MCP Server Configuration (Claude Code / Cursor / OpenClaw)

```json
{
  "mcpServers": {
    "zguard": {
      "command": "npx",
      "args": ["-y", "@zguard/mcp"],
      "env": {
        "ZGUARD_API_URL": "http://localhost:8787",
        "ZGUARD_API_KEY": "zg_live_..."
      }
    }
  }
}
```
Exposed tools: `guard_payment`, `guard_transaction`, `check_token`, `check_before_use`, `guard_bundle`. Without `ZGUARD_API_KEY`, offline quote-match (`guard_payment`) and local content scanning (`check_before_use`) run locally with zero network calls. See `packages/mcp/configs/mcp-hosts.example.json` for all three host configs.

---

## SDK & Signer Wrapper (`@zguard/sdk`)

```ts
import { ZGuardClient, guardEvmSigner, guardOffline } from "@zguard/sdk";

// 1. Offline quote-match (<10ms, zero RPC, zero API key)
const localVerdict = guardOffline({
  network: "eip155:46630",
  quote: {
    asset: "0x7E955252E15c84f5768B83c41a71F9eba181802F",
    payTo: "0x...",
    amount: "1000000",
    chainId: 46630,
  },
  payload: { type: "eip3009", authorization },
});

// 2. Fail-closed EVM signer wrapper (blocks deny, abstain, hash mismatch, and expired TTL)
const client = new ZGuardClient({ baseUrl: "http://localhost:8787", apiKey: process.env.ZGUARD_API_KEY });
const safeSigner = guardEvmSigner(walletClient, {
  guardFn: (req) => client.guard(req),
});
```

### Distribution Integrations

```ts
import { createPermRouterGuard, createTerminalSwapGuard } from "@zguard/sdk";

// Perm: every candidate route is guarded before signing
const permGuard = createPermRouterGuard({ guardFn: (req) => client.guard(req) });

// Terminal: every swap/launch-buy is guarded before signing
const terminalGuard = createTerminalSwapGuard({ guardFn: (req) => client.guard(req) });
```

---

## CLI (`zguard`)

```bash
zguard verify <request.json>         # Offline quote-match (no API key, no RPC)
zguard check-text "<text>"           # Scan untrusted text/metadata
zguard guard <request.json>          # POST /v1/guard
zguard token-risk <0xAddress>        # POST /v1/token-risk (default: eip155:46630)
zguard register                      # Create tenant API key
zguard balance                       # Check remaining USDG micro-credit
```

---

## Acceptance Test Results

**20/20 tests passing** against live RHC:

### Mainnet `4663` (§9 Acceptance)
- §9.1: Quote-match offline `<10ms` for `allow`, `Q-001`..`Q-007`, `Q-DECODE`
- §9.2: Live simulation — `S-REVERT`, `S-APPROVE`, `S-FAIL`
- §9.3: All 5 TokenKind classes on live RHC `4663`
- §9.4: `guardEvmSigner` blocks deny/abstain/expired, allows valid allow
- §9.5: `POST /v1/guard` all 3 checks; `P-UNAVAIL` fail-closed
- §9.6: MCP 5 tools with canonical §5.3 schema
- §9.7: HTTP 402 with payable quote; signed EIP-3009 USDG `X-PAYMENT` accepted
- §9.8: Prompt-injection, zero-width chars, ticker impersonation flagged
- §9.10: ZK Fixture A (allow) & Fixture B (deny Q-001) with BN254 pairing verified

### Testnet `46630` (Zero-fee)
- §9.1: Quote-match with real Testnet USDG address
- §9.3: Testnet token classification (USDG, Stock Token, Mock USDG spoof, WETH)
- §9.2: Live Testnet simulation (revert, approval, fail-closed)
- §9.5: `/v1/guard` allow for canonical USDG + holder; deny for Mock USDG `T-MINT`
- §9.4: `guardEvmSigner` on Testnet 46630
- §2.2: SSRF scanner blocks localhost/metadata with `C-SSRF`
- §9.10: Async ZK attestation on Testnet with BN254 verification
- §5.3: `GET /v1/registry` live Stock Token registry
- §9.8: Content scanning on Testnet
