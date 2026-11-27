# Perm remote quote signer

An isolated, policy-checked EIP-712 signer for `PermRouter` quotes. On Robinhood Chain mainnet (4663) the Perm web app only accepts `PERM_QUOTE_SIGNER_MODE=remote`, so this service is the only place the quote-signing key lives. It never holds funds and never touches the web app's runtime or env scope.

Full operator steps, in Indonesian: [`docs/MAINNET_RUNBOOK.md` §3](../../docs/MAINNET_RUNBOOK.md#3--remote-quote-signer).

> **Custody boundary.** The key sits in the host's secret store. That fits the non-release `allowlisted-mainnet` showcase mode, with an allowlist and an amount cap. A public release still needs a non-exportable KMS/HSM backend behind the same HTTP contract (see the root README, "Quote signing").

## Endpoints

| Host | Sign | Health (no secrets) |
|---|---|---|
| Vercel (`api/sign.mjs`) | `POST https://<project>.vercel.app/api/sign` | `GET https://<project>.vercel.app/api/sign` |
| Node (`server.mjs`) | `POST /sign` (or `/`) | `GET /health` |

The health response is `{ ok, address, chainId, router }`.

The sign request is what `lib/server/quote-signer.ts → signPermQuote()` sends:

```
Authorization: Bearer <PERM_QUOTE_SIGNER_TOKEN>
Content-Type: application/json
{ "schemaVersion": 1, "purpose": "perm-eip712-quote", "domain": {…}, "types": {…}, "primaryType": "PermQuote", "message": {…bigints as strings} }
```

The response is `{ "address": "0x…", "signature": "0x…(65 bytes)" }`. The web app re-verifies that the signature recovers to `QUOTE_SIGNER_ADDRESS`.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `SIGNER_PRIVATE_KEY` | ✓ | Dedicated key with no funds. It must never be the owner or deployer key. |
| `PERM_QUOTE_SIGNER_TOKEN` | ✓ | At least 32 characters (`openssl rand -hex 32`), and the same value as in the web app. |
| `SIGNER_CHAIN_ID` | ✓ | `4663` |
| `SIGNER_ROUTER_ADDRESS` | ✓ | `permRouter` from `deployments/robinhood-mainnet.json` |
| `SIGNER_EXPECTED_ADDRESS` | | The service refuses to start if the key derives a different address. |
| `SIGNER_ACCOUNT_ALLOWLIST` | | Comma-separated. Quotes for any other account get 403. |
| `SIGNER_MAX_AMOUNT_IN_WEI` | | Per-quote input cap. |
| `SIGNER_MAX_TTL_SECONDS` | | Default 180 (range 30–900). Perm quotes use 90 s. |
| `SIGNER_MAX_CLOCK_SKEW_SECONDS` | | Default 30. |
| `PORT`, `HOST`, `TLS_CERT_FILE`, `TLS_KEY_FILE` | | Node host only. |

## Policy (fail closed)

The service rejects a request unless every check passes:

- The bearer token matches, compared in a timing-safe way.
- The body is JSON and at most 16 KiB.
- The schema matches exactly:
  - the type list is the exact `PermQuote` type list;
  - the domain is exactly `{name:"Perm", version:"2", chainId, verifyingContract}` with no extra keys;
  - the message has exactly 13 fields.
- The chain and router are pinned, and `message.chainId` equals the configured chain.
- `account` and `recipient` are nonzero, and `amountIn` is greater than 0.
- `quotedAt` ≤ now + skew, now < `deadline` ≤ now + TTL, and `deadline` is greater than `quotedAt`.
- The account is on the allowlist.
- `amountIn` is within the amount cap.
- The signature recovers to the service's own address (self-check).

On top of that, the service rate-limits per IP and writes a JSON audit line for every `signed` or `rejected` request. The audit log never contains secrets.

## Test

```bash
node test-signer.mjs          # or, from the repo root: pnpm test:signer
```

`pnpm mainnet:fork-e2e` exercises the service over HTTPS against the real web-app quote route on a 4663 fork.
