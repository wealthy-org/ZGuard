import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, isAddress, toHex, type Address, type Hex } from "viem";
import { quoteSignerConfiguration, signPermQuote, type PermQuoteMessage } from "../lib/server/quote-signer";

const candidatePath = path.resolve(process.cwd(), process.env.CANDIDATE_MANIFEST || "deployments/robinhood-testnet.v2-candidate.json");
const candidate = JSON.parse(await readFile(candidatePath, "utf8")) as {
  schemaVersion?: number;
  routerVersion?: number;
  chainId?: number;
  permRouter?: string;
  quoteSigner?: string;
  policy?: { version?: number };
};
assert(candidate.schemaVersion === 2 && candidate.routerVersion === 2 && candidate.chainId === 46_630,
  "Remote signer probe requires a chain-46630 Router-v2 candidate");
const candidateRouterValue = candidate.permRouter || "";
const candidateSignerValue = candidate.quoteSigner || "";
assert(isAddress(candidateRouterValue) && isAddress(candidateSignerValue), "Candidate router or quote signer is invalid");
const candidateRouter = getAddress(candidateRouterValue);
const candidateSigner = getAddress(candidateSignerValue);
const accountValue = process.env.RELEASE_SIGNER_PROBE_ACCOUNT || process.env.RELEASE_TEST_ACCOUNT || "";
const tokenInValue = process.env.RELEASE_SIGNER_PROBE_TOKEN_IN || "";
const tokenOutValue = process.env.RELEASE_SIGNER_PROBE_TOKEN_OUT || "";
assert(isAddress(accountValue), "RELEASE_SIGNER_PROBE_ACCOUNT or RELEASE_TEST_ACCOUNT must be an address");
assert(isAddress(tokenInValue) && isAddress(tokenOutValue) && getAddress(tokenInValue) !== getAddress(tokenOutValue),
  "RELEASE_SIGNER_PROBE_TOKEN_IN and RELEASE_SIGNER_PROBE_TOKEN_OUT must be distinct addresses");

const configuration = quoteSignerConfiguration();
assert(configuration.mode === "remote" && configuration.configured && configuration.custodyReady && configuration.address,
  configuration.reason || "Authenticated remote quote signer custody is not ready");
assert(getAddress(configuration.address) === candidateSigner, "Remote signer address does not match the candidate");
assert(!process.env.PERM_QUOTE_SIGNER_PRIVATE_KEY, "Remote signer probe refuses a local private key");

const now = BigInt(Math.floor(Date.now() / 1_000));
const message: PermQuoteMessage = {
  account: getAddress(accountValue) as Address,
  tokenIn: getAddress(tokenInValue) as Address,
  tokenOut: getAddress(tokenOutValue) as Address,
  amountIn: 1n,
  minAmountOut: 1n,
  gasEstimate: 330_000n,
  recipient: getAddress(accountValue) as Address,
  deadline: now + 60n,
  quotedAt: now,
  policyVersion: Number(candidate.policy?.version || 1),
  chainId: BigInt(candidate.chainId),
  referrer: `0x${"0".repeat(40)}`,
  // No routeData preimage is retained, so this custody probe cannot be submitted as an executable quote.
  routeHash: toHex(randomBytes(32)) as Hex,
};
const result = await signPermQuote({
  name: "Perm",
  version: "2",
  chainId: candidate.chainId,
  verifyingContract: candidateRouter as Address,
}, message);
assert(getAddress(result.address) === candidateSigner, "Recovered probe signer does not match the candidate");

console.log(JSON.stringify({
  status: "passed",
  mode: "remote",
  candidateRouter,
  recoveredSigner: getAddress(result.address),
  custodyReady: configuration.custodyReady,
  signatureDisclosed: false,
  routePreimageRetained: false,
}, null, 2));
