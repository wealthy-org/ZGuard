#!/usr/bin/env node
/** Independently verifies the public non-release staging evidence suite on canonical chain 46630. */
const fs = require("node:fs");
const path = require("node:path");
const { verifyWalletConnectSignature } = require("./lib/wallet-attestation.cjs");
const {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  defineChain,
  getAddress,
  http,
  isAddress,
  isHash,
  keccak256,
  parseAbi,
  stringToHex,
} = require("viem");

const manifestPath = path.resolve(process.cwd(), process.env.STAGING_PUBLIC_MANIFEST || "deployments/robinhood-testnet.v2-staging.json");
if (!fs.existsSync(manifestPath)) throw new Error(`Public staging manifest not found: ${manifestPath}`);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const suite = manifest.stagingEvidenceSuite;
const zeroAddress = "0x0000000000000000000000000000000000000000";

function required(condition, message) {
  if (!condition) throw new Error(message);
}
function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

required(manifest.schemaVersion === 2 && manifest.routerVersion === 2 && manifest.chainId === 46_630, "Evidence requires the chain-46630 Router-v2 public staging manifest");
required(manifest.nonRelease === true && manifest.releaseStatus === "non-release" && manifest.executionReady === false, "Public manifest is not explicitly non-release");
required(suite && suite.nonRelease === true && suite.status === "eight-of-nine-staging-scenarios-recorded", "Public staging evidence suite is incomplete");
required(isAddress(suite.account) && isAddress(suite.referrer) && !same(suite.account, suite.referrer), "Evidence account or referrer is invalid");

const router = getAddress(manifest.contracts.permRouter.address);
const v4Adapter = getAddress(manifest.contracts.v4Adapter.address);
const v3Adapter = getAddress(manifest.contracts.v3Adapter.address);
const treasury = getAddress(manifest.roles.treasury);
const providers = {
  v4: keccak256(stringToHex("UNISWAP_V4_DIRECT")),
  v3: keccak256(stringToHex("SYNTHRA_V3")),
  v2: keccak256(stringToHex("REVIEWED_V2_THIRD_PARTY")),
};
const routerAbi = parseAbi([
  "function swapExactInput((address tokenIn,address tokenOut,uint256 amountIn,uint256 minAmountOut,uint256 gasEstimate,address recipient,uint256 deadline,uint64 quotedAt,uint32 policyVersion,uint256 chainId,bytes32 quoteId,address referrer,bytes routeData) request,bytes quoteSignature,(uint256 nonce,uint256 deadline,bytes signature) permitInput) payable returns (bytes32 receiptId,(uint256 grossFee,uint256 rebate,uint256 netFee,uint256 referralFee,uint256 treasuryFee,uint256 routedInput,uint256 amountOut) settled)",
  "event RouteStepSettled(bytes32 indexed receiptId,uint8 indexed stepIndex,bytes32 indexed providerId,address adapter,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,bytes32 stepRouteId,address hook,bytes32 hookCodehash)",
  "event SwapSettled(bytes32 indexed receiptId,bytes32 indexed quoteId,address indexed account,address recipient,address tokenIn,address tokenOut,uint256 amountIn,uint256 routedInput,uint256 amountOut,uint256 grossFee,uint256 rebate,uint256 netFee,uint256 referralFee,uint256 treasuryFee,uint32 policyVersion,bytes32 routeId,bytes32 routeHash)",
  "event FeeAccrued(address indexed token,address indexed beneficiary,uint256 amount)",
  "event FeeClaimed(address indexed token,address indexed beneficiary,address indexed recipient,uint256 amount)",
]);

const rpcUrl = process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const chain = defineChain({
  id: 46_630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Testnet Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
});
const client = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 2, timeout: 20_000 }) });
const minimumConfirmations = BigInt(process.env.STAGING_EVIDENCE_CONFIRMATIONS || "1");

function decodedLogs(receipt) {
  const decoded = { steps: [], settlements: [], accruals: [], claims: [] };
  for (const log of receipt.logs.filter((item) => same(item.address, router))) {
    try {
      const event = decodeEventLog({ abi: routerAbi, data: log.data, topics: log.topics, strict: true });
      if (event.eventName === "RouteStepSettled") decoded.steps.push(event.args);
      if (event.eventName === "SwapSettled") decoded.settlements.push(event.args);
      if (event.eventName === "FeeAccrued") decoded.accruals.push(event.args);
      if (event.eventName === "FeeClaimed") decoded.claims.push(event.args);
    } catch {
      // Ignore unrelated exact-router logs.
    }
  }
  return decoded;
}

async function canonical(transactionHash, latest, label) {
  required(isHash(transactionHash), `${label} transaction hash is invalid`);
  const [receipt, transaction] = await Promise.all([
    client.getTransactionReceipt({ hash: transactionHash }),
    client.getTransaction({ hash: transactionHash }),
  ]);
  required(receipt.status === "success", `${label} reverted`);
  required(same(transaction.to, router), `${label} did not call the staging router`);
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  required(Boolean(block.hash) && same(block.hash, receipt.blockHash), `${label} is not canonical`);
  const confirmations = latest >= receipt.blockNumber ? latest - receipt.blockNumber + 1n : 0n;
  required(confirmations >= minimumConfirmations, `${label} has only ${confirmations} confirmations`);
  return { receipt, transaction, confirmations, decoded: decodedLogs(receipt) };
}

async function settlement(item, latest, label, expectedAccount = suite.account) {
  required(item && isHash(item.receiptId), `${label} receiptId is invalid`);
  const result = await canonical(item.transactionHash, latest, label);
  const swap = result.decoded.settlements.find((event) => same(event.receiptId, item.receiptId));
  required(swap, `${label} has no matching SwapSettled event`);
  required(same(swap.account, expectedAccount) && same(result.transaction.from, expectedAccount), `${label} used the wrong staging account`);
  required(swap.amountIn > 0n && swap.amountOut > 0n, `${label} has zero settlement amounts`);
  required(swap.grossFee >= swap.rebate && swap.netFee === swap.grossFee - swap.rebate, `${label} fee accounting is inconsistent`);
  required(swap.referralFee + swap.treasuryFee === swap.netFee, `${label} fee split is inconsistent`);
  const steps = result.decoded.steps.filter((event) => same(event.receiptId, item.receiptId)).sort((a, b) => Number(a.stepIndex) - Number(b.stepIndex));
  required(steps.length > 0, `${label} has no route steps`);
  for (let index = 0; index < steps.length; index += 1) {
    required(Number(steps[index].stepIndex) === index, `${label} route-step indices are not contiguous`);
    required(same(steps[index].hook, zeroAddress), `${label} unexpectedly used an unapproved hook`);
    if (index > 0) required(same(steps[index - 1].tokenOut, steps[index].tokenIn), `${label} route steps are not continuous`);
  }
  const call = decodeFunctionData({ abi: routerAbi, data: result.transaction.input });
  required(call.functionName === "swapExactInput" && same(call.args[0].quoteId, swap.quoteId), `${label} signed calldata does not match settlement evidence`);
  return { ...result, swap, steps, call };
}

async function main() {
  const [chainId, latest] = await Promise.all([client.getChainId(), client.getBlockNumber()]);
  required(chainId === 46_630, `RPC chain ${chainId} is not Robinhood testnet`);
  required((await client.getBytecode({ address: router })) !== undefined, "Staging router has no runtime code");
  const results = {};

  const direct = await settlement(manifest.canonicalStagingEvidence, latest, "directV4");
  required(direct.steps.length === 1 && same(direct.steps[0].providerId, providers.v4) && same(direct.steps[0].adapter, v4Adapter), "directV4 route semantics failed");
  results.directV4 = { transactionHash: manifest.canonicalStagingEvidence.transactionHash, steps: 1, confirmations: direct.confirmations.toString() };

  const v3 = await settlement(suite.scenarios.v3, latest, "v3");
  required(v3.steps.some((step) => same(step.providerId, providers.v3) && same(step.adapter, v3Adapter)), "v3 evidence did not use the deployed Synthra adapter");
  results.v3 = { transactionHash: suite.scenarios.v3.transactionHash, steps: v3.steps.length, confirmations: v3.confirmations.toString() };

  const multiHop = await settlement(suite.scenarios.multiHop, latest, "multiHop");
  required(multiHop.steps.length >= 2 && !same(multiHop.swap.tokenIn, zeroAddress) && !same(multiHop.swap.tokenOut, zeroAddress), "multiHop evidence is not token-to-token multi-step execution");
  results.multiHop = { transactionHash: suite.scenarios.multiHop.transactionHash, steps: multiHop.steps.length, confirmations: multiHop.confirmations.toString() };

  if (suite.scenarios.crossVenue) {
    const crossVenue = await settlement(suite.scenarios.crossVenue, latest, "crossVenue");
    required(
      crossVenue.steps.length === 2
        && crossVenue.steps.some((step) => same(step.providerId, providers.v4) && same(step.adapter, v4Adapter))
        && crossVenue.steps.some((step) => same(step.providerId, providers.v3) && same(step.adapter, v3Adapter)),
      "crossVenue evidence is not an explicit two-step v4/v3 execution",
    );
    results.crossVenue = { transactionHash: suite.scenarios.crossVenue.transactionHash, steps: 2, confirmations: crossVenue.confirmations.toString() };
  }

  const permit2 = await settlement(suite.scenarios.permit2, latest, "permit2");
  const permitInput = permit2.call.args[2];
  required(!same(permit2.swap.tokenIn, zeroAddress) && permitInput.signature && permitInput.signature !== "0x" && BigInt(permitInput.deadline) > 0n, "permit2 evidence lacks a signature transfer");
  results.permit2 = { transactionHash: suite.scenarios.permit2.transactionHash, steps: permit2.steps.length, confirmations: permit2.confirmations.toString() };

  const referral = await settlement(suite.scenarios.referral, latest, "referral");
  required(referral.swap.referralFee > 0n, "referral evidence has no referral fee");
  required(referral.decoded.accruals.some((event) => same(event.beneficiary, suite.referrer) && event.amount === referral.swap.referralFee), "referral accrual is missing");
  required(referral.decoded.accruals.some((event) => same(event.beneficiary, treasury) && event.amount === referral.swap.treasuryFee), "treasury accrual is missing from referral evidence");
  results.referral = { transactionHash: suite.scenarios.referral.transactionHash, steps: referral.steps.length, confirmations: referral.confirmations.toString() };

  for (const [name, beneficiary] of [["treasuryClaim", treasury], ["referralClaim", suite.referrer]]) {
    const item = suite.scenarios[name];
    const claim = await canonical(item.transactionHash, latest, name);
    const event = claim.decoded.claims.find((value) => same(value.token, zeroAddress) && same(value.beneficiary, beneficiary) && same(value.recipient, suite.account) && value.amount > 0n);
    required(event, `${name} has no matching native FeeClaimed event`);
    required(same(claim.transaction.from, beneficiary), `${name} was not submitted by its beneficiary`);
    results[name] = { transactionHash: item.transactionHash, amount: event.amount.toString(), confirmations: claim.confirmations.toString() };
  }

  const externalWalletPath = process.env.STAGING_WALLETCONNECT_EVIDENCE
    ? path.resolve(process.cwd(), process.env.STAGING_WALLETCONNECT_EVIDENCE)
    : null;
  if (externalWalletPath) required(fs.existsSync(externalWalletPath), `WalletConnect evidence not found: ${externalWalletPath}`);
  const wallet = externalWalletPath ? JSON.parse(fs.readFileSync(externalWalletPath, "utf8")) : suite.walletConnect;
  required(wallet && !("sessionTopic" in wallet), "Raw WalletConnect sessionTopic must never be stored");
  let walletConnect = { status: wallet.status };
  if (wallet.status === "pending-manual-mobile-pairing-and-independent-attestation") {
    required(process.env.STAGING_REQUIRE_WALLETCONNECT !== "1", "Manual WalletConnect evidence is required but still pending");
  } else {
    required(wallet.status === "passed-staging-only", "WalletConnect evidence status is invalid");
    required(isAddress(wallet.account), "WalletConnect evidence account is invalid");
    required(typeof wallet.walletName === "string" && wallet.walletName.trim().length >= 2, "WalletConnect walletName is required");
    required(typeof wallet.device === "string" && wallet.device.trim().length >= 2, "WalletConnect device is required");
    required(typeof wallet.attestedBy === "string" && wallet.attestedBy.trim().length >= 3, "WalletConnect attestedBy is required");
    required(isHash(wallet.sessionTopicHash), "WalletConnect sessionTopicHash is required (never store the raw topic)");
    const testedAt = Date.parse(wallet.testedAt);
    required(Number.isFinite(testedAt) && testedAt <= Date.now() + 5 * 60_000
      && Date.now() - testedAt <= 7 * 24 * 60 * 60_000, "WalletConnect testedAt must be within the last seven days");
    const operationalAddresses = [
      manifest.roles.owner,
      manifest.roles.treasury,
      manifest.roles.pauseGuardian,
      manifest.roles.quoteSigner,
      suite.referrer,
    ];
    required(!operationalAddresses.some((address) => same(address, wallet.account)), "WalletConnect account must be independent of staging operational roles");
    const trustedSigners = process.env.STAGING_WALLETCONNECT_QA_SIGNERS || process.env.WALLETCONNECT_QA_SIGNERS;
    await verifyWalletConnectSignature({ chainId: manifest.chainId, permRouter: router }, wallet, trustedSigners);
    required(!same(wallet.attestationSigner, wallet.account)
      && !operationalAddresses.some((address) => same(address, wallet.attestationSigner)),
    "WalletConnect QA attester must be independent of the test account and staging operational roles");
    const verified = await settlement(wallet, latest, "walletConnect", wallet.account);
    const block = await client.getBlock({ blockNumber: verified.receipt.blockNumber });
    required(Math.abs(Number(block.timestamp) * 1_000 - testedAt) <= 24 * 60 * 60_000,
      "WalletConnect attestation time is not close to the canonical transaction time");
    walletConnect = {
      status: wallet.status,
      transactionHash: wallet.transactionHash,
      receiptId: wallet.receiptId,
      account: getAddress(wallet.account),
      attestationSigner: getAddress(wallet.attestationSigner),
      sessionTopicHash: wallet.sessionTopicHash,
      confirmations: verified.confirmations.toString(),
    };
  }

  console.log(JSON.stringify({ status: "passed", nonRelease: true, chainId, latestBlock: latest.toString(), results, walletConnect }, null, 2));
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exitCode = 1;
});
