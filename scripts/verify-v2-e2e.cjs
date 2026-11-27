#!/usr/bin/env node
/** Verifies the mandatory Router-v2 testnet release transactions on canonical chain. */
const fs = require("node:fs");
const path = require("node:path");
const {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  defineChain,
  http,
  id,
  isAddress,
  isHash,
  parseAbi,
} = require("viem");
const { verifyWalletConnectSignature } = require("./lib/wallet-attestation.cjs");

const root = path.resolve(__dirname, "..");
const candidatePath = path.resolve(process.cwd(), process.env.CANDIDATE_MANIFEST || "deployments/robinhood-testnet.v2-candidate.json");
if (!fs.existsSync(candidatePath)) throw new Error(`Candidate manifest not found: ${candidatePath}`);
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
if (candidate.schemaVersion !== 2 || candidate.routerVersion !== 2 || candidate.chainId !== 46630) {
  throw new Error("E2E evidence requires a chain-46630 Router-v2 candidate");
}
for (const field of ["permRouter", "v4Adapter", "v3Adapter", "treasury"]) {
  if (!isAddress(candidate[field])) throw new Error(`Candidate ${field} is invalid`);
}
const evidence = candidate.releaseEvidence;
if (!evidence || typeof evidence !== "object") throw new Error("Candidate releaseEvidence is required");
const rpcUrl = process.env.RH_TESTNET_RPC_URL || candidate.rpcUrl;
if (!rpcUrl) throw new Error("RH_TESTNET_RPC_URL is required");
const chain = defineChain({
  id: candidate.chainId,
  name: candidate.network || "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) });
const minimumConfirmations = BigInt(process.env.E2E_EVIDENCE_CONFIRMATIONS || "12");
const maximumGasEstimateErrorBps = Number(process.env.MAX_GAS_ESTIMATE_ERROR_BPS || "3000");
if (!Number.isInteger(maximumGasEstimateErrorBps) || maximumGasEstimateErrorBps < 0 || maximumGasEstimateErrorBps > 3_000) {
  throw new Error("MAX_GAS_ESTIMATE_ERROR_BPS must be an integer between 0 and 3000");
}
const zeroAddress = "0x0000000000000000000000000000000000000000";

const routerAbi = parseAbi([
  "function swapExactInput((address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 gasEstimate,address recipient,uint256 deadline,uint64 quotedAt,uint32 policyVersion,uint256 chainId,bytes32 quoteId,address referrer,bytes routeData) request,bytes quoteSignature,(uint256 nonce,uint256 deadline,bytes signature) permitInput) payable returns (bytes32 receiptId,(uint256 grossFee,uint256 rebate,uint256 netFee,uint256 referralFee,uint256 treasuryFee,uint256 routedInput,uint256 amountOut) settled)",
  "event RouteStepSettled(bytes32 indexed receiptId,uint8 indexed stepIndex,bytes32 indexed providerId,address adapter,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,bytes32 stepRouteId,address hook,bytes32 hookCodehash)",
  "event SwapSettled(bytes32 indexed receiptId,bytes32 indexed quoteId,address indexed account,address recipient,address tokenIn,address tokenOut,uint256 amountIn,uint256 routedInput,uint256 amountOut,uint256 grossFee,uint256 rebate,uint256 netFee,uint256 referralFee,uint256 treasuryFee,uint32 policyVersion,bytes32 routeId,bytes32 routeHash)",
  "event FeeAccrued(address indexed token,address indexed beneficiary,uint256 amount)",
  "event FeeClaimed(address indexed token,address indexed beneficiary,address indexed recipient,uint256 amount)",
]);
const providers = {
  directV4: id("UNISWAP_V4_DIRECT"),
  v3: id("SYNTHRA_V3"),
  hook: id("UNISWAP_V4_AGGREGATOR_HOOK"),
};

function required(condition, message) {
  if (!condition) throw new Error(message);
}
function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}
function logsFor(receipt) {
  const steps = [];
  const settlements = [];
  const accruals = [];
  const claims = [];
  for (const log of receipt.logs.filter((item) => same(item.address, candidate.permRouter))) {
    try {
      const decoded = decodeEventLog({ abi: routerAbi, data: log.data, topics: log.topics, strict: true });
      if (decoded.eventName === "RouteStepSettled") steps.push(decoded.args);
      if (decoded.eventName === "SwapSettled") settlements.push(decoded.args);
      if (decoded.eventName === "FeeAccrued") accruals.push(decoded.args);
      if (decoded.eventName === "FeeClaimed") claims.push(decoded.args);
    } catch {
      // Ignore unrelated exact-router logs.
    }
  }
  return { steps, settlements, accruals, claims };
}

async function canonicalReceipt(transactionHash, latest, label) {
  required(isHash(transactionHash), `${label}.transactionHash is invalid`);
  const receipt = await client.getTransactionReceipt({ hash: transactionHash });
  required(receipt.status === "success", `${label} reverted`);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  required(Boolean(block.hash) && same(block.hash, receipt.blockHash), `${label} is not canonical`);
  const confirmations = latest >= receipt.blockNumber ? latest - receipt.blockNumber + 1n : 0n;
  required(confirmations >= minimumConfirmations, `${label} has only ${confirmations} confirmations`);
  return { receipt, confirmations };
}

function settlementFor(decoded, item, label) {
  required(item && isHash(item.receiptId), `${label}.receiptId is required`);
  const settlement = decoded.settlements.find((value) => same(value.receiptId, item.receiptId));
  required(settlement, `${label} has no matching SwapSettled event`);
  required(!same(settlement.account, candidate.treasury), `${label} must use a non-treasury account`);
  required(!same(settlement.account, candidate.owner), `${label} must use a non-governance account`);
  required(settlement.amountIn > 0n && settlement.amountOut > 0n, `${label} has zero settlement amounts`);
  required(settlement.grossFee >= settlement.rebate, `${label} has invalid fee/rebate accounting`);
  required(settlement.netFee === settlement.grossFee - settlement.rebate, `${label} has inconsistent net fee`);
  required(settlement.referralFee + settlement.treasuryFee === settlement.netFee, `${label} fee split is inconsistent`);
  return settlement;
}

async function verifySettlementEvidence(item, latest, label, predicate) {
  required(item && isHash(item.transactionHash), `${label}.transactionHash is required`);
  const { receipt, confirmations } = await canonicalReceipt(item.transactionHash, latest, label);
  const decoded = logsFor(receipt);
  const settlement = settlementFor(decoded, item, label);
  const steps = decoded.steps
    .filter((step) => same(step.receiptId, item.receiptId))
    .sort((a, b) => Number(a.stepIndex) - Number(b.stepIndex));
  required(steps.length > 0, `${label} has no route-step evidence`);
  for (let index = 0; index < steps.length; index += 1) {
    required(Number(steps[index].stepIndex) === index, `${label} route-step indices are not contiguous`);
    if (index > 0) required(same(steps[index - 1].tokenOut, steps[index].tokenIn), `${label} route steps are not continuous`);
  }
  required(predicate({ receipt, decoded, settlement, steps }), `${label} does not satisfy its required route semantics`);
  const transaction = await client.getTransaction({ hash: item.transactionHash });
  required(same(transaction.to, candidate.permRouter) && same(transaction.from, settlement.account), `${label} did not call the candidate router from the settled account`);
  const call = decodeFunctionData({ abi: routerAbi, data: transaction.input });
  required(call.functionName === "swapExactInput", `${label} calldata is not swapExactInput`);
  const signedRequest = call.args[0];
  required(same(signedRequest.quoteId, settlement.quoteId), `${label} calldata quoteId does not match settlement evidence`);
  const quotedGasEstimate = BigInt(signedRequest.gasEstimate);
  if (item.quotedGasEstimate !== undefined) {
    required(typeof item.quotedGasEstimate === "string" && /^\d+$/.test(item.quotedGasEstimate)
      && BigInt(item.quotedGasEstimate) === quotedGasEstimate, `${label}.quotedGasEstimate does not match signed calldata`);
  }
  const actualGasUsed = receipt.gasUsed;
  required(quotedGasEstimate > 0n && actualGasUsed > 0n, `${label} gas evidence is invalid`);
  const gasDelta = quotedGasEstimate > actualGasUsed ? quotedGasEstimate - actualGasUsed : actualGasUsed - quotedGasEstimate;
  const gasEstimateErrorBps = Number(gasDelta * 10_000n / actualGasUsed);
  required(gasEstimateErrorBps <= maximumGasEstimateErrorBps,
    `${label} gas estimate error is ${gasEstimateErrorBps} bps (limit ${maximumGasEstimateErrorBps})`);
  return {
    transactionHash: item.transactionHash,
    receiptId: item.receiptId,
    account: settlement.account,
    steps: steps.length,
    confirmations: confirmations.toString(),
    quotedGasEstimate: quotedGasEstimate.toString(),
    actualGasUsed: actualGasUsed.toString(),
    gasEstimateErrorBps,
  };
}

async function main() {
  const [chainId, latest] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  required(chainId === candidate.chainId, `RPC chain ${chainId} does not match candidate ${candidate.chainId}`);

  const results = {};
  results.directV4 = await verifySettlementEvidence(evidence.directV4, latest, "releaseEvidence.directV4", ({ settlement, steps }) => (
    steps.length === 1 && (same(settlement.tokenIn, zeroAddress) || same(settlement.tokenOut, zeroAddress))
      && same(steps[0].providerId, providers.directV4)
      && same(steps[0].adapter, candidate.v4Adapter) && same(steps[0].hook, zeroAddress)
  ));
  results.v3 = await verifySettlementEvidence(evidence.v3, latest, "releaseEvidence.v3", ({ settlement, steps }) => (
    (same(settlement.tokenIn, zeroAddress) || same(settlement.tokenOut, zeroAddress))
      && steps.some((step) => same(step.providerId, providers.v3) && same(step.adapter, candidate.v3Adapter))
  ));
  results.multiHop = await verifySettlementEvidence(evidence.multiHop, latest, "releaseEvidence.multiHop", ({ settlement, steps }) => (
    !same(settlement.tokenIn, zeroAddress) && !same(settlement.tokenOut, zeroAddress) && steps.length >= 2
  ));
  results.permit2 = await verifySettlementEvidence(evidence.permit2, latest, "releaseEvidence.permit2", ({ settlement }) => {
    if (same(settlement.tokenIn, zeroAddress)) return false;
    return true;
  });

  const permitTransaction = await client.getTransaction({ hash: evidence.permit2.transactionHash });
  required(same(permitTransaction.to, candidate.permRouter), "Permit2 evidence did not call the candidate router");
  const permitCall = decodeFunctionData({ abi: routerAbi, data: permitTransaction.input });
  required(permitCall.functionName === "swapExactInput", "Permit2 evidence is not swapExactInput");
  const permitInput = permitCall.args[2];
  required(permitInput.signature && permitInput.signature !== "0x", "Permit2 evidence used ERC-20 allowance instead of a Permit2 signature transfer");
  required(BigInt(permitInput.deadline) > 0n, "Permit2 evidence has no permit deadline");

  const referral = evidence.referral || {};
  required(isAddress(referral.referrer), "Referral evidence requires a referrer address");
  results.referral = await verifySettlementEvidence(referral, latest, "releaseEvidence.referral", ({ decoded, settlement }) => (
    !same(settlement.account, referral.referrer)
      && settlement.referralFee > 0n
      && decoded.accruals.some((item) => same(item.beneficiary, referral.referrer) && item.amount === settlement.referralFee)
      && decoded.accruals.some((item) => same(item.beneficiary, candidate.treasury) && item.amount === settlement.treasuryFee)
  ));

  const wallet = evidence.walletConnect || {};
  required(isHash(wallet.transactionHash), "WalletConnect evidence transaction is required");
  required(typeof wallet.walletName === "string" && wallet.walletName.trim().length >= 2, "WalletConnect walletName is required");
  required(typeof wallet.device === "string" && wallet.device.trim().length >= 2, "WalletConnect device is required");
  required(typeof wallet.attestedBy === "string" && wallet.attestedBy.trim().length >= 3, "WalletConnect attestedBy is required");
  const walletTestedAt = Date.parse(wallet.testedAt);
  required(Number.isFinite(walletTestedAt) && walletTestedAt <= Date.now() + 5 * 60_000
    && Date.now() - walletTestedAt <= 7 * 24 * 60 * 60_000, "WalletConnect testedAt must be within the last seven days");
  required(isHash(wallet.sessionTopicHash), "WalletConnect sessionTopicHash is required (store only its hash, never the session topic)");
  await verifyWalletConnectSignature(candidate, wallet, process.env.WALLETCONNECT_QA_SIGNERS);
  results.walletConnect = await verifySettlementEvidence(wallet, latest, "releaseEvidence.walletConnect", () => true);
  required(!same(wallet.attestationSigner, results.walletConnect.account)
    && !same(wallet.attestationSigner, candidate.treasury) && !same(wallet.attestationSigner, candidate.owner),
  "WalletConnect QA attester must be independent of the test account, treasury and governance");
  const walletReceipt = await client.getTransactionReceipt({ hash: wallet.transactionHash });
  const walletBlock = await client.getBlock({ blockNumber: walletReceipt.blockNumber });
  required(Math.abs(Number(walletBlock.timestamp) * 1_000 - walletTestedAt) <= 24 * 60 * 60_000,
    "WalletConnect attestation time is not close to the canonical transaction time");
  results.walletConnect.attestationSigner = wallet.attestationSigner;
  results.walletConnect.sessionTopicHash = wallet.sessionTopicHash;

  const claim = evidence.treasuryClaim || {};
  const claimReceiptResult = await canonicalReceipt(claim.transactionHash, latest, "releaseEvidence.treasuryClaim");
  const claimEvents = logsFor(claimReceiptResult.receipt).claims;
  const treasuryClaim = claimEvents.find((item) => same(item.beneficiary, candidate.treasury) && item.amount > 0n);
  required(treasuryClaim, "Treasury pull-payment claim evidence was not found");
  results.treasuryClaim = {
    transactionHash: claim.transactionHash,
    token: treasuryClaim.token,
    recipient: treasuryClaim.recipient,
    amount: treasuryClaim.amount.toString(),
    confirmations: claimReceiptResult.confirmations.toString(),
  };

  const referralClaim = evidence.referralClaim || {};
  const referralClaimReceipt = await canonicalReceipt(referralClaim.transactionHash, latest, "releaseEvidence.referralClaim");
  const referralClaimEvent = logsFor(referralClaimReceipt.receipt).claims
    .find((item) => same(item.beneficiary, referral.referrer) && item.amount > 0n);
  required(referralClaimEvent, "Referral pull-payment claim evidence was not found");
  results.referralClaim = {
    transactionHash: referralClaim.transactionHash,
    token: referralClaimEvent.token,
    beneficiary: referralClaimEvent.beneficiary,
    recipient: referralClaimEvent.recipient,
    amount: referralClaimEvent.amount.toString(),
    confirmations: referralClaimReceipt.confirmations.toString(),
  };

  candidate.e2eVerification = "passed";
  candidate.e2eVerifiedAt = new Date().toISOString();
  candidate.e2eVerificationResults = results;
  candidate.executionReady = false;
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ candidate: path.relative(root, candidatePath), status: "passed", results }, null, 2));
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exitCode = 1;
});
