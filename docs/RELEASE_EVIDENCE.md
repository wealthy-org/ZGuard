# Router-v2 release evidence

A candidate manifest must contain canonical testnet evidence before promotion:

```json
{
  "releaseEvidence": {
    "directV4": { "transactionHash": "0x...", "receiptId": "0x..." },
    "v3": { "transactionHash": "0x...", "receiptId": "0x..." },
    "multiHop": { "transactionHash": "0x...", "receiptId": "0x..." },
    "permit2": { "transactionHash": "0x...", "receiptId": "0x..." },
    "referral": { "transactionHash": "0x...", "receiptId": "0x...", "referrer": "0x..." },
    "walletConnect": {
      "transactionHash": "0x...",
      "receiptId": "0x...",
      "walletName": "reviewed wallet",
      "device": "OS and device",
      "testedAt": "2026-01-01T00:00:00.000Z",
      "attestedBy": "reviewer",
      "sessionTopicHash": "0x<keccak256 or SHA-256 digest represented as bytes32>",
      "attestationSigner": "0x<trusted independent QA signer>",
      "attestationSignature": "0x<personal-sign signature>"
    },
    "treasuryClaim": { "transactionHash": "0x..." },
    "referralClaim": { "transactionHash": "0x..." }
  }
}
```

Never store the WalletConnect session topic itself. Store only a one-way bytes32 digest. `WALLETCONNECT_QA_SIGNERS` must list the trusted QA EOA(s). The attester must be independent of the transaction account, treasury and governance, and signs `Perm WalletConnect E2E attestation v1\n` followed by canonical sorted-key JSON containing schema version, kind, chain, router, transaction/receipt IDs, wallet/device, test time, reviewer name and topic hash. The verifier requires the timestamp within seven days and within 24 hours of the canonical transaction.

Router v2 binds `gasEstimate` inside the EIP-712 quote and transaction calldata. The verifier decodes that signed value directly—an optional JSON `quotedGasEstimate` is accepted only when it exactly matches calldata. By default its error against canonical `receipt.gasUsed` must be at most 3,000 bps; tighten `MAX_GAS_ESTIMATE_ERROR_BPS` after calibration.

Run `pnpm release:verify-e2e`. The script reads chain data and signed calldata rather than trusting labels in the JSON and writes `e2eVerification: "passed"` only after all required evidence and gas calibration checks succeed. The candidate remains `executionReady: false` until explicit promotion.

## Signed external assurance

A release also requires `releaseAssurance.schemaVersion: 1` with these signed entries:

- `independentAudit`: organization, completion time, immutable report URL/SHA-256, zero unresolved critical/high findings, and scope containing `PermRouter`, `PermV4Adapter`, `PermV3Adapter`, `PermTimelock`, and `release-tooling`;
- `incidentDrill`: a report URL/SHA-256, a passing result, and the `emergency-pause`, `quote-signer-compromise`, `rpc-failover`, and `indexer-reorg` scenarios;
- `bugBounty`: active status, in-scope Router/adapters, immutable public policy URL/SHA-256, and funding-evidence URL/SHA-256;
- `signerCustody`: the exact quote-signer address, custody provider, hashed key identifier, report URL/SHA-256, a successful real `release:probe-signer` custody log at immutable `remoteSignerProbeUrl` bound as `remoteSignerProbeSha256`, and `non-exportable-key`, `authenticated-remote-signing`, `rotation-tested`, and `emergency-disable-tested` controls; and
- `approvals.engineering`, `.security`, `.governance`, and `.operations`: four distinct signers approving `approve-robinhood-testnet-v2` with zero unresolved critical/high findings.

Every payload must include the exact common binding below:

```json
{
  "schemaVersion": 1,
  "chainId": 46630,
  "router": "0x<candidate Router>",
  "releaseCommitSha": "<40 hex Git commit>",
  "releaseDigest": "0x<digest printed by the assurance tooling>",
  "kind": "<entry-specific kind>"
}
```

The EOA signs this exact UTF-8 personal-sign message:

```text
Perm Robinhood testnet release attestation v1
<canonical JSON payload with recursively sorted object keys and no whitespace>
```

The committed `releaseCommitSha` and digest bind every signature to contract addresses, release/dependency runtime codehashes, role addresses, policy, deployment block, deployment transactions, and a canonical commitment over source/ownership, hook, E2E, WalletConnect, and hosted-operations evidence. Changing any verification result after signatures are collected invalidates the assurance package. Formal approvers must be distinct; the four external attesters must also be distinct, may not double as formal approvers, and all eight assurance identities must remain independent of candidate operational addresses. Run `pnpm release:prepare-assurance` to print the digest and, after unsigned payloads are entered, every exact message to sign. Configure comma-separated trust roots in `RELEASE_AUDITOR_SIGNERS`, `RELEASE_INCIDENT_SIGNERS`, `RELEASE_BUG_BOUNTY_SIGNERS`, `RELEASE_CUSTODY_ATTESTERS`, and the four `RELEASE_*_APPROVERS` variables. Trust roots are deployment configuration, never candidate-declared values.

Run `pnpm release:verify-assurance`. It recovers every signer, enforces independence/freshness/scope, accepts only credential-free HTTPS on port 443, rejects private/reserved DNS answers, pins each request to the vetted address, and re-resolves/revalidates every redirect. Artifact downloads are stream-capped at 10 MiB and SHA-256 verified before detailed `assuranceVerificationResults` are written. Promotion repeats signature and artifact verification rather than trusting a top-level `"passed"` label.

`pnpm release:test-evidence` runs deterministic redirect/SSRF/size/hash regressions. `pnpm release:test-evidence:live` additionally downloads a commit-pinned public artifact through the production TLS/DNS-pinning path; set `PERM_LIVE_EVIDENCE_URL` and `PERM_LIVE_EVIDENCE_SHA256` to exercise the actual release host.
