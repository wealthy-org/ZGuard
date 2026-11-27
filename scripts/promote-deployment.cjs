#!/usr/bin/env node
/** Explicitly promotes a verified, ownership-complete v2 candidate to the shared
 * manifest. This is the only script that changes the frontend's official router. */
const fs = require("node:fs");
const path = require("node:path");
const { getAddress, isAddress, isHash } = require("viem");
const { validateAssurance } = require("./lib/release-assurance.cjs");

const root = path.resolve(__dirname, "..");
const candidatePath = path.resolve(process.cwd(), process.env.CANDIDATE_MANIFEST || "deployments/robinhood-testnet.v2-candidate.json");
const officialPath = path.join(root, "deployments/robinhood-testnet.json");
const archiveDir = path.join(root, "deployments/archive");

function required(condition, message) {
  if (!condition) throw new Error(message);
}
function validHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.href === `${url.origin}/`;
  } catch { return false; }
}

async function main() {
  required(fs.existsSync(candidatePath), `Candidate manifest not found: ${candidatePath}`);
  const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
  required(candidate.schemaVersion === 2 && candidate.routerVersion === 2 && candidate.chainId === 46630, "Only a chain-46630 Router v2 candidate can be promoted");
  required(candidate.releaseStatus === "candidate", `Unexpected releaseStatus: ${candidate.releaseStatus}`);
  required(/^[0-9a-f]{40}$/i.test(candidate.releaseCommitSha || "") && candidate.repositoryDirtyAtDeployment === false,
    "Candidate must be deployed from a clean, commit-bound repository");
  required(candidate.postDeploymentChecks === "passed", "Onchain post-deployment checks have not passed");
  required(candidate.sourceVerification === "verified", "All release contracts must be source-verified on Blockscout");
  required(Array.isArray(candidate.sourceVerificationResults) && candidate.sourceVerificationResults.length === 4
    && candidate.sourceVerificationResults.every((entry) => entry.explorerVerified === true && entry.bytecode?.matches === true),
  "Explorer publication and local-artifact runtime bytecode matches are required for all release contracts");
  const verifiedAddresses = new Set(candidate.sourceVerificationResults.map((entry) => String(entry.address).toLowerCase()));
  for (const address of [candidate.permRouter, candidate.v4Adapter, candidate.v3Adapter, candidate.timelock]) {
    required(address && verifiedAddresses.has(String(address).toLowerCase()), `Missing source/bytecode verification for ${address || "release contract"}`);
  }
  required(candidate.ownershipStatus === "accepted", "Router and adapter ownership must be accepted by final governance");
  required(candidate.currentOwner && candidate.currentOwner.toLowerCase() === candidate.owner.toLowerCase(), "Current owner does not match target owner");
  for (const field of ["permRouter", "v4Adapter", "v3Adapter", "quoteSigner", "owner", "treasury", "pauseGuardian", "permit2", "timelock"]) {
    required(candidate[field] && isAddress(candidate[field]), `Missing or invalid ${field}`);
  }
  for (const field of ["permRouter", "v4Adapter", "v3Adapter", "timelock"]) {
    required(/^0x[0-9a-f]{64}$/i.test(candidate.runtimeCodehashes?.[field] || ""), `Missing pinned runtime codehash for ${field}`);
    const verification = candidate.sourceVerificationResults.find((entry) => getAddress(entry.address) === getAddress(candidate[field]));
    required(verification && String(verification.bytecode.runtimeCodehash).toLowerCase() === candidate.runtimeCodehashes[field].toLowerCase(),
      `Source verification runtime codehash does not match manifest pin for ${field}`);
  }
  for (const field of ["poolManager", "v4Quoter", "permit2", "synthraFactory", "synthraSwapRouter", "synthraQuoter", "synthraQuoterShim", "synthraWeth"]) {
    required(/^0x[0-9a-f]{64}$/i.test(candidate.dependencyCodehashes?.[field] || ""), `Missing dependency codehash pin for ${field}`);
  }
  required(getAddress(candidate.owner) === getAddress(candidate.timelock), "Final owner must be the manifest-declared timelock");
  required(getAddress(candidate.treasury) !== getAddress(candidate.owner), "Treasury must be separate from final governance");
  required(getAddress(candidate.quoteSigner) !== getAddress(candidate.owner), "Quote signer must be separate from final governance");
  required(getAddress(candidate.quoteSigner) !== getAddress(candidate.treasury), "Quote signer must be separate from treasury");
  required(Number.isSafeInteger(candidate.timelockDelaySeconds) && candidate.timelockDelaySeconds >= 172_800,
    "Timelock delay must be at least 172800 seconds");
  required(Array.isArray(candidate.aggregatorHooks) && candidate.aggregatorHooks.length > 0,
    "Brief-complete promotion requires at least one reviewed Aggregator Hook");
  required(candidate.aggregatorHookVerification === "passed", "Aggregator Hook evidence has not passed verification");
  required(Array.isArray(candidate.aggregatorHookVerificationResults)
    && candidate.aggregatorHookVerificationResults.length === candidate.aggregatorHooks.length,
  "Aggregator Hook verification results are incomplete");
  required(candidate.e2eVerification === "passed", "Required Router v2 E2E evidence has not passed verification");
  for (const key of ["directV4", "v3", "multiHop", "permit2", "referral", "walletConnect"]) {
    const result = candidate.e2eVerificationResults?.[key];
    required(result?.transactionHash && /^\d+$/.test(result.quotedGasEstimate || "") && /^\d+$/.test(result.actualGasUsed || "")
      && Number.isInteger(result.gasEstimateErrorBps) && result.gasEstimateErrorBps >= 0 && result.gasEstimateErrorBps <= 3_000,
    `Missing signed-calldata gas-calibrated E2E result: ${key}`);
  }
  required(candidate.e2eVerificationResults?.walletConnect?.attestationSigner
    && candidate.e2eVerificationResults?.walletConnect?.sessionTopicHash,
  "Missing independently signed WalletConnect QA result");
  for (const key of ["treasuryClaim", "referralClaim"]) {
    required(candidate.e2eVerificationResults?.[key]?.transactionHash, `Missing verified E2E result: ${key}`);
  }
  required(candidate.operationsVerification === "passed", "Hosted production-readiness checks have not passed verification");
  const operations = candidate.operationsVerificationResults;
  required(operations?.healthStatus === "ready" && operations?.indexedHistorySource === "postgres-indexer"
    && operations?.quoteSignerMode === "remote" && operations?.alertWebhookTest === "passed",
  "Hosted operations verification results are incomplete");
  required(isAddress(operations?.candidateRouter) && getAddress(operations.candidateRouter) === getAddress(candidate.permRouter),
    "Hosted operations report is bound to a different candidate router");
  required(validHttpsOrigin(operations?.stagingOrigin), "Hosted operations staging origin is invalid");
  required(/^\d+$/.test(operations?.primaryRpcBlock || "") && /^\d+$/.test(operations?.fallbackRpcBlock || ""),
    "Hosted operations RPC block evidence is invalid");
  required(/^\d+$/.test(operations?.indexer?.lastIndexedBlock || "")
    && isHash(operations?.indexer?.lastIndexedBlockHash)
    && Number.isSafeInteger(operations?.indexer?.updatedLagSeconds) && operations.indexer.updatedLagSeconds >= 0 && operations.indexer.updatedLagSeconds <= 900
    && /^\d+$/.test(operations?.indexer?.blockLag || "")
    && BigInt(operations.indexer.blockLag) <= 300n,
  "Hosted operations indexer evidence is invalid");
  required(isHash(operations?.executableQuoteId), "Hosted operations executable quote proof is invalid");
  required(isHash(operations?.verifiedReceipt)
    && String(operations.verifiedReceipt).toLowerCase() === String(candidate.e2eVerificationResults.directV4.transactionHash).toLowerCase(),
  "Hosted operations receipt does not match verified direct-v4 E2E evidence");
  const requiredSecurityHeaders = [
    "content-security-policy", "strict-transport-security", "cross-origin-opener-policy", "permissions-policy", "x-content-type-options", "x-frame-options",
  ];
  required(Array.isArray(operations?.securityHeaders) && requiredSecurityHeaders.every((header) => operations.securityHeaders.includes(header)),
    "Hosted operations security-header evidence is incomplete");
  required(isAddress(operations?.quoteSignerAddress) && getAddress(operations.quoteSignerAddress) === getAddress(candidate.quoteSigner)
    && isAddress(operations?.recoveredQuoteSigner) && getAddress(operations.recoveredQuoteSigner) === getAddress(candidate.quoteSigner),
  "Hosted operations remote-signer evidence is invalid");
  required(candidate.assuranceVerification === "passed", "External assurance and formal approvals have not passed verification");
  const assurance = await validateAssurance(candidate, { fetchArtifacts: true });
  required(candidate.assuranceVerificationResults?.releaseDigest === assurance.releaseDigest
    && candidate.assuranceVerificationResults?.independentAudit?.signer === assurance.independentAudit.signer
    && candidate.assuranceVerificationResults?.incidentDrill?.signer === assurance.incidentDrill.signer
    && candidate.assuranceVerificationResults?.bugBounty?.signer === assurance.bugBounty.signer
    && candidate.assuranceVerificationResults?.signerCustody?.signer === assurance.signerCustody.signer
    && candidate.assuranceVerificationResults?.signerCustody?.remoteSignerProbeSha256 === assurance.signerCustody.remoteSignerProbeSha256,
  "External assurance verification results do not match the signed evidence");
  for (const role of ["engineering", "security", "governance", "operations"]) {
    required(candidate.assuranceVerificationResults?.approvals?.[role]?.signer === assurance.approvals[role].signer,
      `Formal ${role} approval result does not match the signed evidence`);
  }
  const maxEvidenceAge = 7 * 24 * 60 * 60 * 1_000;
  for (const field of ["aggregatorHookVerifiedAt", "e2eVerifiedAt", "operationsVerifiedAt", "assuranceVerifiedAt"]) {
    const checkedAt = Date.parse(candidate[field]);
    required(Number.isFinite(checkedAt) && Date.now() - checkedAt >= 0 && Date.now() - checkedAt <= maxEvidenceAge,
      `${field} must be a successful verification from the last 7 days`);
  }
  required(process.env.CONFIRM_PROMOTION === "ROBINHOOD_TESTNET_V2", "Set CONFIRM_PROMOTION=ROBINHOOD_TESTNET_V2 after release review");
  required(process.env.CONFIRM_ROUTER_ADDRESS && getAddress(process.env.CONFIRM_ROUTER_ADDRESS) === getAddress(candidate.permRouter), "CONFIRM_ROUTER_ADDRESS must exactly match the candidate router");

  const previous = JSON.parse(fs.readFileSync(officialPath, "utf8"));
  required(previous.chainId === candidate.chainId, "Candidate and official manifest chain mismatch");
  fs.mkdirSync(archiveDir, { recursive: true });
  const archiveName = `robinhood-testnet-router-v${previous.routerVersion}-${previous.permRouter.toLowerCase()}.json`;
  fs.writeFileSync(path.join(archiveDir, archiveName), `${JSON.stringify(previous, null, 2)}\n`);

  const promoted = {
    ...candidate,
    releaseStatus: "active",
    executionReady: true,
    promotedAt: new Date().toISOString(),
    previousRouter: previous.permRouter,
  };
  fs.writeFileSync(officialPath, `${JSON.stringify(promoted, null, 2)}\n`);
  console.log(`Promoted Router v2 ${candidate.permRouter}`);
  console.log(`Archived Router v${previous.routerVersion} manifest at deployments/archive/${archiveName}`);
  console.log("Restart the quote service with the matching PERM_QUOTE_SIGNER_PRIVATE_KEY, then run monitor and wallet E2E checks.");
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
