# Security policy

## Status

ZGuard is a pre-signature guard for agents and terminals on Robinhood Chain. The hosted API (`https://zguard-delta.vercel.app`) runs on **testnet 46630 by default**; mainnet 4663 is supported per request but is not the default yet (gap doc Bagian L). **Nothing here has had an independent audit.** The zk layer is not live: the SP1 guest is built in CI and its `programVKey` is pinned (`packages/zk/artifacts/sp1-quote-guest.json`), but no Groth16 proof is produced and no verifier is deployed, so every attestation is `pending` with `proof: null`. Halo2 is a separate, non-default research path.

## Supported components

| Component | Path | In scope |
|---|---|---|
| API (Hono, Vercel) | `apps/api` | ✅ |
| Web (Next.js) | `apps/web` | ✅ |
| SDK: quote-match, signer wrapper, client, CLI | `packages/sdk` | ✅ |
| MCP server | `packages/mcp` | ✅ |
| Local trading terminal `zguard-terminal` | `packages/terminal` | ✅ |
| zk: SP1 guest, quote rules, `ZGuardQuoteVerifier.sol`, Halo2 circuit | `packages/zk` | ✅ (contract not deployed) |

Only `main` is supported.

## Security model

- **Fail-closed.** `allow` is the only verdict that lets a wallet sign. `deny`, `abstain`, an expired receipt, a `payload_hash` that does not match the exact bytes being signed, an unreachable API or a missing API key all stop the signature (`guardEvmSigner`, `createPermRouterGuard`, `createTerminalSwapGuard`, `zguard-terminal`).
- **Abstain is not permission.** It can only be overridden explicitly (`allowAbstainOverride`), and the override is recorded in the receipt.
- **Guard off is loud, never silent.** `enabled: false` throws `GuardDisabledError`. `ZGUARD_TERMINAL_MODE=off` makes the terminal refuse to sign. In Perm, `PERM_ZGUARD_MODE=off` shows a red "UNGUARDED" banner.
- **The model never writes the intent.** Router, terminal and payment intents are built by deterministic code. The intent is re-encoded and compared byte for byte with the calldata being signed (QM-1).
- **Receipts are not signed by the API.** Use only a receipt your own code fetched from ZGuard over HTTPS. Never trust one taken from tool output, an LLM, a URL or any other untrusted channel.
- **API keys** are stored only as SHA-256 hashes. The SDK refuses to send a key over plain HTTP to a non-loopback host. The admin key is compared in constant time. `/v1/register` is limited per IP, and a global per-IP rate limit is applied.
- **Payments** (x402 deposit mode) go to the 2-of-3 Safe `0xad5501954A52792280D868F7e613Efcc4F80fa6c`. Credit claims are bound to the transaction hash and the chain, and require 3 confirmations.

## Governance

- **`ZGuardQuoteVerifier`** (not deployed yet):
  - Ownership moves in two steps (`transferOwnership` → `acceptOwnership`).
  - Gateway and vkey changes go through `proposeGatewayAndVKey` → `applyGatewayAndVKey` after a 2-day `CONFIG_DELAY`.
  - Its owner is set to the Safe as soon as it is deployed.
- **Perm contracts** (PermRouter and adapters, separate repository):
  - Owner: the Safe, moving to a 48-hour `PermTimelock`.
  - The Safe proposes and can cancel; the pause guardian can cancel.
  - See Perm `SECURITY.md`.
- **Operational secrets** (`ZGUARD_ADMIN_API_KEY`, `DATABASE_URL`, `PERM_ZGUARD_API_KEY`) live only in Vercel and GitHub encrypted settings, never in the repository.

## Reporting a vulnerability

Report privately through GitHub: **Security → Report a vulnerability** on `wealthy-org/ZGuard`. Do not open a public issue while the problem is exploitable. Please include:

- the affected commit, endpoint or package;
- chain, transaction hash or request/response pair and steps to reproduce;
- expected versus actual behavior (for example a non-`allow` verdict that still reached a signature);
- impact, and any funds or credit at risk.

Never include seed phrases, private keys, API keys or database credentials. Expect an acknowledgement within 72 hours. A fix or mitigation is coordinated with you before public disclosure.
