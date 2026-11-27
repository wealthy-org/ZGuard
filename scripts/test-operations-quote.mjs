import assert from "node:assert/strict";
import { hashTypedData, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import operationsQuoteModule from "./lib/operations-quote.cjs";

const { quoteTypes, verifyExecutableQuote } = operationsQuoteModule;
const signer = privateKeyToAccount(`0x${"41".repeat(32)}`);
const attacker = privateKeyToAccount(`0x${"42".repeat(32)}`);
const candidate = {
  chainId: 46_630,
  permRouter: `0x${"10".repeat(20)}`,
  quoteSigner: signer.address,
};
const domain = { name: "Perm", version: "2", chainId: candidate.chainId, verifyingContract: candidate.permRouter };
const routeData = "0x1234abcd";
const message = {
  account: `0x${"11".repeat(20)}`,
  tokenIn: `0x${"12".repeat(20)}`,
  tokenOut: `0x${"13".repeat(20)}`,
  amountIn: 1_000_000n,
  minAmountOut: 900_000n,
  gasEstimate: 330_000n,
  recipient: `0x${"14".repeat(20)}`,
  deadline: 2_000_000_000n,
  quotedAt: 1_999_999_900n,
  policyVersion: 1,
  chainId: 46_630n,
  referrer: `0x${"0".repeat(40)}`,
  routeHash: keccak256(routeData),
};
const quoteId = hashTypedData({ domain, types: quoteTypes, primaryType: "PermQuote", message });
const quoteSignature = await signer.signTypedData({ domain, types: quoteTypes, primaryType: "PermQuote", message });
const quote = {
  contractVersion: 2,
  executable: true,
  chainId: candidate.chainId,
  quoteId,
  quoteSignature,
  account: message.account,
  tokenIn: message.tokenIn,
  tokenOut: message.tokenOut,
  amountIn: message.amountIn.toString(),
  recipient: message.recipient,
  deadline: Number(message.deadline),
  quotedAt: Number(message.quotedAt),
  policyVersion: message.policyVersion,
  referrer: message.referrer,
  selected: {
    minAmountOut: message.minAmountOut.toString(),
    gasEstimate: message.gasEstimate.toString(),
    routeData,
  },
};

const verified = await verifyExecutableQuote(quote, candidate);
assert.equal(verified.computedQuoteId, quoteId);
assert.equal(verified.recoveredQuoteSigner, signer.address);

const gasMutation = structuredClone(quote);
gasMutation.selected.gasEstimate = "330001";
await assert.rejects(() => verifyExecutableQuote(gasMutation, candidate), /quoteId does not match/i);
for (const invalidGas of ["0", "30000001"]) {
  const invalid = structuredClone(quote);
  invalid.selected.gasEstimate = invalidGas;
  await assert.rejects(() => verifyExecutableQuote(invalid, candidate), /gas estimate.*bounds/i);
}
const chainMutation = { ...structuredClone(quote), chainId: 1 };
await assert.rejects(() => verifyExecutableQuote(chainMutation, candidate), /chain mismatch/i);
const malformedRoute = structuredClone(quote);
malformedRoute.selected.routeData = "0x123";
await assert.rejects(() => verifyExecutableQuote(malformedRoute, candidate), /binding fields/i);
const staleTiming = structuredClone(quote);
staleTiming.deadline = staleTiming.quotedAt;
await assert.rejects(() => verifyExecutableQuote(staleTiming, candidate), /deadline must be after/i);
const nonExecutable = { ...structuredClone(quote), executable: false };
await assert.rejects(() => verifyExecutableQuote(nonExecutable, candidate), /not Router-v2 executable/i);
const attackerQuote = structuredClone(quote);
attackerQuote.quoteSignature = await attacker.signTypedData({ domain, types: quoteTypes, primaryType: "PermQuote", message });
await assert.rejects(() => verifyExecutableQuote(attackerQuote, candidate), /does not match the candidate quote signer/i);

console.log("Hosted operations quote: full EIP-712 payload and authorized remote signer recover; field, gas, route, timing, and signer mutations fail closed");
