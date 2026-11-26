/**
 * Shared SP1 quote fixtures (gap H3): one JSON file consumed by
 *   - the native Rust rules test (`packages/zk/quote-rules`, `cargo test`),
 *   - the SP1 host `parity` binary (`packages/zk/sp1-host`, executes the real guest ELF in the zkVM),
 *   - the TypeScript freshness test (`apps/api/test/sp1-fixtures.test.ts`).
 * Each fixture is computed by the SAME TypeScript pipeline the API uses: `evaluateQuoteMatch` →
 * `buildInitialZkAttestation` → `encodeQuotePublicValues`, and `buildSp1GuestInput` for the guest stdin.
 */
import { evaluateQuoteMatch, type GuardRequest } from "@zguard/sdk";
import { buildInitialZkAttestation, buildSp1GuestInput, encodeQuotePublicValues } from "./index.js";

export interface Sp1QuoteFixture {
  name: string;
  quoteJson: string;
  txJson: string;
  hints: { asset_mismatch: boolean; chain_mismatch: boolean; unexpected_approval: boolean; domain_verified: boolean };
  tsVerdict: "allow" | "deny" | "abstain";
  tsCodes: string[];
  /** abi.encode(scopeHash, quoteHash, txHash, uint8 verdict, uint32 ruleBitmask), lowercase 0x-hex */
  expectedPublicValues: string;
}

const USDG_TESTNET = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const USDG_DOMAIN = { name: "Global Dollar", version: "1", chainId: 46630, verifyingContract: USDG_TESTNET };
const PAYER = "0x3d2faC269954487a63f51bF059701fbD9647e3Bf";
const PAYEE = "0xad5501954A52792280D868F7e613Efcc4F80fa6c";
const OTHER = "0x000000000000000000000000000000000000bEEF";
const NETWORK = "eip155:46630";

type Req = Pick<GuardRequest, "network" | "quote" | "payload">;

function auth(over: Record<string, unknown> = {}) {
  return {
    kind: "TransferWithAuthorization" as const,
    from: PAYER,
    to: PAYEE,
    value: "15000",
    validAfter: "0",
    validBefore: "4102444800",
    nonce: `0x${"11".repeat(32)}`,
    domain: USDG_DOMAIN,
    ...over,
  };
}

const quote = { asset: USDG_TESTNET, payTo: PAYEE, amount: "15000", chainId: 46630 };

export const SP1_FIXTURE_REQUESTS: Array<{ name: string; request: Req }> = [
  { name: "allow", request: { network: NETWORK, quote, payload: { type: "eip3009", authorization: auth() } } },
  { name: "deny-q001-recipient", request: { network: NETWORK, quote, payload: { type: "eip3009", authorization: auth({ to: OTHER }) } } },
  { name: "deny-q002-amount", request: { network: NETWORK, quote, payload: { type: "eip3009", authorization: auth({ value: "14999" }) } } },
  { name: "deny-q005-no-quote", request: { network: NETWORK, payload: { type: "eip3009", authorization: auth() } } },
  { name: "abstain-qdecode-evm-tx", request: { network: NETWORK, quote, payload: { type: "evm_tx", tx: "0xdeadbeef" } } },
  {
    name: "deny-q003-asset-hinted",
    request: { network: NETWORK, quote: { ...quote, asset: "0x0000000000000000000000000000000000c0FFEE" }, payload: { type: "eip3009", authorization: auth() } },
  },
  {
    name: "abstain-q007-domain-unverified",
    request: { network: NETWORK, quote, payload: { type: "eip3009", authorization: auth({ domain: { ...USDG_DOMAIN, name: "Global Dollar Fake" } }) } },
  },
];

export function buildSp1QuoteFixtures(): Sp1QuoteFixture[] {
  return SP1_FIXTURE_REQUESTS.map(({ name, request }) => {
    const q = evaluateQuoteMatch({ network: request.network, quote: request.quote, payload: request.payload });
    const att = buildInitialZkAttestation({
      decisionId: `fixture_${name}`,
      system: "groth16-sp1",
      request,
      quoteVerdict: q.decision,
      quoteCodes: q.codes,
    });
    const input = buildSp1GuestInput(request, q.codes);
    return {
      name,
      quoteJson: input.quoteJson,
      txJson: input.txJson,
      hints: input.hints as Sp1QuoteFixture["hints"],
      tsVerdict: q.decision,
      tsCodes: q.codes,
      expectedPublicValues: encodeQuotePublicValues(att).toLowerCase(),
    };
  });
}
