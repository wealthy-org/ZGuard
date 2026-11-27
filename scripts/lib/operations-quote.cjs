const {
  getAddress,
  hashTypedData,
  isAddress,
  isHash,
  keccak256,
  recoverTypedDataAddress,
} = require("viem");

const MAX_QUOTED_GAS = 30_000_000n;
const quoteTypes = {
  PermQuote: [
    { name: "account", type: "address" }, { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" },
    { name: "recipient", type: "address" }, { name: "deadline", type: "uint256" },
    { name: "quotedAt", type: "uint64" }, { name: "policyVersion", type: "uint32" },
    { name: "chainId", type: "uint256" }, { name: "referrer", type: "address" },
    { name: "routeHash", type: "bytes32" },
  ],
};

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function toUnsigned(value, label) {
  try {
    const parsed = BigInt(value);
    required(parsed >= 0n, `${label} must be unsigned`);
    return parsed;
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith(label)) throw cause;
    throw new Error(`${label} must be an unsigned integer`);
  }
}

async function verifyExecutableQuote(quote, candidate) {
  required(candidate && Number.isSafeInteger(candidate.chainId) && isAddress(candidate.permRouter) && isAddress(candidate.quoteSigner),
    "Candidate quote-verification identity is invalid");
  required(quote && quote.contractVersion === 2 && quote.executable === true, "Staging quote is not Router-v2 executable");
  required(isHash(quote.quoteId) && /^0x[0-9a-fA-F]{130}$/.test(quote.quoteSignature || ""), "Staging quote signature is invalid");
  required(quote.chainId === candidate.chainId, "Staging quote chain mismatch");
  required(isAddress(quote.tokenIn) && isAddress(quote.tokenOut) && isAddress(quote.account)
    && isAddress(quote.recipient) && isAddress(quote.referrer)
    && /^0x(?:[0-9a-fA-F]{2})+$/.test(quote.selected?.routeData || ""),
  "Staging quote binding fields are invalid");

  const amountIn = toUnsigned(quote.amountIn, "Staging quote amountIn");
  const minAmountOut = toUnsigned(quote.selected.minAmountOut, "Staging quote minAmountOut");
  const gasEstimate = toUnsigned(quote.selected.gasEstimate, "Staging quote gasEstimate");
  const deadline = toUnsigned(quote.deadline, "Staging quote deadline");
  const quotedAt = toUnsigned(quote.quotedAt, "Staging quote quotedAt");
  required(amountIn > 0n && minAmountOut > 0n, "Staging quote amounts must be positive");
  required(gasEstimate > 0n && gasEstimate <= MAX_QUOTED_GAS, "Staging quote gas estimate is outside Router bounds");
  required(deadline > quotedAt, "Staging quote deadline must be after quotedAt");
  required(Number.isSafeInteger(quote.policyVersion) && quote.policyVersion > 0, "Staging quote policyVersion is invalid");

  const domain = { name: "Perm", version: "2", chainId: candidate.chainId, verifyingContract: getAddress(candidate.permRouter) };
  const message = {
    account: getAddress(quote.account), tokenIn: getAddress(quote.tokenIn), tokenOut: getAddress(quote.tokenOut),
    amountIn, minAmountOut, gasEstimate, recipient: getAddress(quote.recipient), deadline, quotedAt,
    policyVersion: quote.policyVersion, chainId: BigInt(quote.chainId), referrer: getAddress(quote.referrer),
    routeHash: keccak256(quote.selected.routeData),
  };
  const computedQuoteId = hashTypedData({ domain, types: quoteTypes, primaryType: "PermQuote", message });
  required(same(computedQuoteId, quote.quoteId), "Staging quoteId does not match its EIP-712 payload");
  const recoveredQuoteSigner = await recoverTypedDataAddress({
    domain, types: quoteTypes, primaryType: "PermQuote", message, signature: quote.quoteSignature,
  });
  required(same(recoveredQuoteSigner, candidate.quoteSigner), "Staging remote signature does not match the candidate quote signer");
  return { computedQuoteId, recoveredQuoteSigner: getAddress(recoveredQuoteSigner), domain, message };
}

module.exports = { MAX_QUOTED_GAS, quoteTypes, verifyExecutableQuote };
