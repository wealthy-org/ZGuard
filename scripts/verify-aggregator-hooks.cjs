#!/usr/bin/env node
/**
 * Fail-closed Aggregator Hook release gate.
 *
 * A hook is not accepted because it has a nonzero address. Every manifest entry
 * must carry review metadata, an expected runtime codehash, a successful quote
 * probe and a canonical Router-v2 settlement whose RouteStepSettled evidence
 * reports that same hook and codehash.
 */
const fs = require("node:fs");
const path = require("node:path");
const {
  createPublicClient,
  decodeEventLog,
  defineChain,
  encodeAbiParameters,
  getAddress,
  http,
  id,
  isAddress,
  isHash,
  keccak256,
  parseAbi,
  parseAbiParameters,
} = require("viem");

const root = path.resolve(__dirname, "..");
const candidatePath = path.resolve(process.cwd(), process.env.CANDIDATE_MANIFEST || "deployments/robinhood-testnet.v2-candidate.json");
if (!fs.existsSync(candidatePath)) throw new Error(`Candidate manifest not found: ${candidatePath}`);
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
if (candidate.schemaVersion !== 2 || candidate.routerVersion !== 2 || candidate.chainId !== 46630) {
  throw new Error("Aggregator Hook evidence requires a chain-46630 Router-v2 candidate");
}
if (!isAddress(candidate.permRouter) || !isAddress(candidate.v4Adapter) || !isAddress(candidate.v4Quoter)) {
  throw new Error("Candidate router, v4 adapter and v4 quoter must be valid addresses");
}
const hooks = Array.isArray(candidate.aggregatorHooks) ? candidate.aggregatorHooks : [];
if (!hooks.length) throw new Error("No reviewed Aggregator Hook is declared; brief-complete promotion must remain blocked");

const rpcUrl = process.env.RH_TESTNET_RPC_URL || candidate.rpcUrl;
if (!rpcUrl) throw new Error("RH_TESTNET_RPC_URL is required");
const chain = defineChain({
  id: candidate.chainId,
  name: candidate.network || "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) });
const minimumConfirmations = BigInt(process.env.HOOK_EVIDENCE_CONFIRMATIONS || "12");

const v4AdapterAbi = parseAbi([
  "function verifiedHookCodehashes(address) view returns (bytes32)",
]);
const routerAbi = parseAbi([
  "function hookProviderIds(address) view returns (bytes32)",
  "event RouteStepSettled(bytes32 indexed receiptId,uint8 indexed stepIndex,bytes32 indexed providerId,address adapter,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,bytes32 stepRouteId,address hook,bytes32 hookCodehash)",
  "event SwapSettled(bytes32 indexed receiptId,bytes32 indexed quoteId,address indexed account,address recipient,address tokenIn,address tokenOut,uint256 amountIn,uint256 routedInput,uint256 amountOut,uint256 grossFee,uint256 rebate,uint256 netFee,uint256 referralFee,uint256 treasuryFee,uint32 policyVersion,bytes32 routeId,bytes32 routeHash)",
]);
const v4QuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const poolKeyParameters = parseAbiParameters("address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks");
const zeroHash = `0x${"0".repeat(64)}`;

function required(condition, message) {
  if (!condition) throw new Error(message);
}
function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}
function validHttps(value) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}
function decodeRouterLogs(receipt) {
  const steps = [];
  const settlements = [];
  for (const log of receipt.logs.filter((item) => same(item.address, candidate.permRouter))) {
    try {
      const decoded = decodeEventLog({ abi: routerAbi, data: log.data, topics: log.topics, strict: true });
      if (decoded.eventName === "RouteStepSettled") steps.push(decoded.args);
      if (decoded.eventName === "SwapSettled") settlements.push(decoded.args);
    } catch {
      // Exact ABI decoding intentionally ignores all unrelated router logs.
    }
  }
  return { steps, settlements };
}

async function verifyEntry(entry, index, latest) {
  const label = `aggregatorHooks[${index}]`;
  required(entry && entry.sourceType === "aggregator-hook", `${label}.sourceType must be aggregator-hook`);
  for (const field of ["currency0", "currency1", "hooks"]) required(isAddress(entry[field]), `${label}.${field} is invalid`);
  required(entry.hooks !== "0x0000000000000000000000000000000000000000", `${label}.hooks must be nonzero`);
  required(isHash(entry.id), `${label}.id must be bytes32`);
  required(isHash(entry.expectedCodehash) && entry.expectedCodehash !== zeroHash, `${label}.expectedCodehash is required`);
  required(/^0x[0-9a-fA-F]*$/.test(entry.hookData || ""), `${label}.hookData must be hex`);
  required(Number.isInteger(entry.fee) && entry.fee >= 0 && entry.fee <= 0xffffff, `${label}.fee is invalid`);
  required(Number.isInteger(entry.tickSpacing), `${label}.tickSpacing is invalid`);
  required(Number.isSafeInteger(entry.initializationBlock) && entry.initializationBlock > 0, `${label}.initializationBlock is invalid`);

  const computedPoolId = keccak256(encodeAbiParameters(poolKeyParameters, [
    getAddress(entry.currency0), getAddress(entry.currency1), entry.fee, entry.tickSpacing, getAddress(entry.hooks),
  ]));
  required(same(computedPoolId, entry.id), `${label}.id does not match its PoolKey`);

  const review = entry.review || {};
  required(typeof review.reviewer === "string" && review.reviewer.trim().length >= 3, `${label}.review.reviewer is required`);
  required(Number.isFinite(Date.parse(review.reviewedAt)), `${label}.review.reviewedAt is invalid`);
  required(validHttps(review.specificationUrl), `${label}.review.specificationUrl must use HTTPS`);
  required(validHttps(review.auditReportUrl), `${label}.review.auditReportUrl must use HTTPS`);
  required(/^[0-9a-f]{64}$/i.test(review.auditReportSha256 || ""), `${label}.review.auditReportSha256 is invalid`);
  required(typeof review.calldataSemantics === "string" && review.calldataSemantics.trim().length >= 20, `${label}.review.calldataSemantics is required`);
  required(typeof review.permissionModel === "string" && review.permissionModel.trim().length >= 20, `${label}.review.permissionModel is required`);

  const code = await client.getCode({ address: getAddress(entry.hooks) });
  required(code && code !== "0x", `${label} has no runtime bytecode`);
  const actualCodehash = keccak256(code);
  required(same(actualCodehash, entry.expectedCodehash), `${label} runtime codehash changed`);
  const configuredCodehash = await client.readContract({
    address: getAddress(candidate.v4Adapter), abi: v4AdapterAbi, functionName: "verifiedHookCodehashes", args: [getAddress(entry.hooks)],
  });
  required(same(configuredCodehash, entry.expectedCodehash), `${label} is not codehash-pinned in the candidate adapter`);

  const probe = entry.quoteProbe || {};
  required(probe.zeroForOne === true || probe.zeroForOne === false, `${label}.quoteProbe.zeroForOne is required`);
  required(typeof probe.amountIn === "string" && /^\d+$/.test(probe.amountIn) && BigInt(probe.amountIn) > 0n, `${label}.quoteProbe.amountIn is invalid`);
  required(BigInt(probe.amountIn) <= (1n << 128n) - 1n, `${label}.quoteProbe.amountIn exceeds uint128`);
  required(typeof probe.minimumAmountOut === "string" && /^\d+$/.test(probe.minimumAmountOut), `${label}.quoteProbe.minimumAmountOut is invalid`);
  const quote = await client.simulateContract({
    account: "0x0000000000000000000000000000000000000000",
    address: getAddress(candidate.v4Quoter),
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{
      poolKey: {
        currency0: getAddress(entry.currency0), currency1: getAddress(entry.currency1), fee: entry.fee,
        tickSpacing: entry.tickSpacing, hooks: getAddress(entry.hooks),
      },
      zeroForOne: probe.zeroForOne,
      exactAmount: BigInt(probe.amountIn),
      hookData: entry.hookData,
    }],
  });
  required(quote.result[0] >= BigInt(probe.minimumAmountOut) && quote.result[0] > 0n, `${label} quote probe returned insufficient output`);

  const evidence = entry.evidence || {};
  required(isHash(evidence.transactionHash), `${label}.evidence.transactionHash is required`);
  required(isHash(evidence.receiptId), `${label}.evidence.receiptId is required`);
  required(Number.isInteger(evidence.stepIndex) && evidence.stepIndex >= 0 && evidence.stepIndex < 4, `${label}.evidence.stepIndex is invalid`);
  const receipt = await client.getTransactionReceipt({ hash: evidence.transactionHash });
  required(receipt.status === "success", `${label} evidence transaction reverted`);
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
  required(Boolean(canonical.hash) && same(canonical.hash, receipt.blockHash), `${label} evidence block is not canonical`);
  const confirmations = latest >= receipt.blockNumber ? latest - receipt.blockNumber + 1n : 0n;
  required(confirmations >= minimumConfirmations, `${label} evidence has only ${confirmations} confirmations`);
  const decoded = decodeRouterLogs(receipt);
  const step = decoded.steps.find((item) => same(item.receiptId, evidence.receiptId) && Number(item.stepIndex) === evidence.stepIndex);
  required(step, `${label} evidence has no matching RouteStepSettled event`);
  required(same(step.providerId, id("UNISWAP_V4_AGGREGATOR_HOOK")), `${label} evidence has the wrong provider identity`);
  required(same(step.adapter, candidate.v4Adapter), `${label} evidence used a different adapter`);
  required(same(step.hook, entry.hooks), `${label} evidence used a different hook`);
  required(same(step.hookCodehash, entry.expectedCodehash), `${label} evidence reports a different hook codehash`);
  required(decoded.settlements.some((item) => same(item.receiptId, evidence.receiptId)), `${label} evidence has no matching SwapSettled event`);

  return {
    id: entry.id,
    hook: getAddress(entry.hooks),
    expectedCodehash: entry.expectedCodehash,
    configuredCodehash,
    actualCodehash,
    quoteAmountOut: quote.result[0].toString(),
    transactionHash: evidence.transactionHash,
    receiptId: evidence.receiptId,
    confirmations: confirmations.toString(),
  };
}

async function main() {
  const [chainId, latest, hookProviderId] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.readContract({ address: getAddress(candidate.permRouter), abi: routerAbi, functionName: "hookProviderIds", args: [getAddress(candidate.v4Adapter)] }),
  ]);
  required(chainId === candidate.chainId, `RPC chain ${chainId} does not match candidate ${candidate.chainId}`);
  required(same(hookProviderId, id("UNISWAP_V4_AGGREGATOR_HOOK")), "Router hook provider identity is not configured correctly");

  const results = [];
  for (let index = 0; index < hooks.length; index += 1) results.push(await verifyEntry(hooks[index], index, latest));
  candidate.aggregatorHookVerification = "passed";
  candidate.aggregatorHookVerifiedAt = new Date().toISOString();
  candidate.aggregatorHookVerificationResults = results;
  candidate.providers = { ...(candidate.providers || {}), uniswapV4AggregatorHook: id("UNISWAP_V4_AGGREGATOR_HOOK") };
  candidate.hookProviderStatus = "verified";
  candidate.executionReady = false;
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ candidate: path.relative(root, candidatePath), status: "passed", hooks: results }, null, 2));
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exitCode = 1;
});
