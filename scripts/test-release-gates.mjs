import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const officialPath = path.join(root, "deployments/robinhood-testnet.json");
const hash = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const temp = await mkdtemp(path.join(os.tmpdir(), "perm-release-gates-"));

try {
  const timelock = `0x${"10".repeat(20)}`;
  const router = `0x${"11".repeat(20)}`;
  const v4Adapter = `0x${"12".repeat(20)}`;
  const v3Adapter = `0x${"13".repeat(20)}`;
  const runtimeCodehashes = {
    permRouter: `0x${"a1".repeat(32)}`,
    v4Adapter: `0x${"a2".repeat(32)}`,
    v3Adapter: `0x${"a3".repeat(32)}`,
    timelock: `0x${"a4".repeat(32)}`,
  };
  const candidatePath = path.join(temp, "candidate.json");
  await writeFile(candidatePath, JSON.stringify({
    schemaVersion: 2,
    routerVersion: 2,
    chainId: 46630,
    releaseStatus: "candidate",
    releaseCommitSha: "ab".repeat(20),
    repositoryDirtyAtDeployment: false,
    postDeploymentChecks: "passed",
    sourceVerification: "verified",
    sourceVerificationResults: [
      [router, runtimeCodehashes.permRouter],
      [v4Adapter, runtimeCodehashes.v4Adapter],
      [v3Adapter, runtimeCodehashes.v3Adapter],
      [timelock, runtimeCodehashes.timelock],
    ].map(([address, runtimeCodehash]) => ({
      address,
      explorerVerified: true,
      bytecode: { matches: true, runtimeCodehash },
    })),
    ownershipStatus: "accepted",
    currentOwner: timelock,
    owner: timelock,
    timelock,
    timelockDelaySeconds: 60,
    permRouter: router,
    v4Adapter,
    v3Adapter,
    runtimeCodehashes,
    dependencyCodehashes: Object.fromEntries([
      "poolManager", "v4Quoter", "permit2", "synthraFactory", "synthraSwapRouter", "synthraQuoter", "synthraQuoterShim", "synthraWeth",
    ].map((field, index) => [field, `0x${(index + 177).toString(16).padStart(2, "0").repeat(32)}`])),
    quoteSigner: `0x${"14".repeat(20)}`,
    treasury: `0x${"15".repeat(20)}`,
    pauseGuardian: `0x${"16".repeat(20)}`,
    permit2: `0x${"17".repeat(20)}`,
  }));

  const before = await hash(officialPath);
  const runPromotion = () => spawnSync(process.execPath, [path.join(root, "scripts/promote-deployment.cjs")], {
    cwd: root,
    env: {
      ...process.env,
      CANDIDATE_MANIFEST: candidatePath,
      CONFIRM_PROMOTION: "ROBINHOOD_TESTNET_V2",
      CONFIRM_ROUTER_ADDRESS: router,
    },
    encoding: "utf8",
  });
  const promotion = runPromotion();
  assert.notEqual(promotion.status, 0, "unsafe short-delay candidate must not promote");
  assert.match(`${promotion.stdout}${promotion.stderr}`, /at least 172800 seconds/i);
  assert.equal(await hash(officialPath), before, "failed promotion must not modify the official manifest");

  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  candidate.timelockDelaySeconds = 172_800;
  await writeFile(candidatePath, JSON.stringify(candidate));
  const missingHook = runPromotion();
  assert.notEqual(missingHook.status, 0, "candidate without reviewed hooks must not promote");
  assert.match(`${missingHook.stdout}${missingHook.stderr}`, /requires at least one reviewed Aggregator Hook/i);
  assert.equal(await hash(officialPath), before, "missing-hook promotion must not modify the official manifest");

  candidate.aggregatorHooks = [{ hooks: `0x${"18".repeat(20)}`, expectedCodehash: `0x${"19".repeat(32)}` }];
  candidate.aggregatorHookVerification = "passed";
  candidate.aggregatorHookVerifiedAt = new Date().toISOString();
  candidate.aggregatorHookVerificationResults = [{ transactionHash: `0x${"20".repeat(32)}` }];
  await writeFile(candidatePath, JSON.stringify(candidate));
  const missingE2e = runPromotion();
  assert.notEqual(missingE2e.status, 0, "candidate without E2E evidence must not promote");
  assert.match(`${missingE2e.stdout}${missingE2e.stderr}`, /E2E evidence has not passed/i);

  candidate.e2eVerification = "passed";
  candidate.e2eVerifiedAt = new Date().toISOString();
  candidate.e2eVerificationResults = Object.fromEntries(
    ["directV4", "v3", "multiHop", "permit2", "referral", "walletConnect", "treasuryClaim", "referralClaim"].map((key, index) => [key, {
      transactionHash: `0x${String(index + 21).padStart(2, "0").repeat(32)}`,
      ...(!["treasuryClaim", "referralClaim"].includes(key)
        ? { quotedGasEstimate: "300000", actualGasUsed: "300000", gasEstimateErrorBps: 0 }
        : {}),
      ...(key === "walletConnect"
        ? { attestationSigner: `0x${"31".repeat(20)}`, sessionTopicHash: `0x${"32".repeat(32)}` }
        : {}),
    }]),
  );
  await writeFile(candidatePath, JSON.stringify(candidate));
  const missingOperations = runPromotion();
  assert.notEqual(missingOperations.status, 0, "candidate without hosted operations evidence must not promote");
  assert.match(`${missingOperations.stdout}${missingOperations.stderr}`, /production-readiness checks have not passed/i);
  assert.equal(await hash(officialPath), before, "failed release gates must never modify the official manifest");

  candidate.operationsVerification = "passed";
  candidate.operationsVerifiedAt = new Date().toISOString();
  candidate.operationsVerificationResults = {
    candidateRouter: candidate.permRouter,
    stagingOrigin: "https://staging.perm.example",
    primaryRpcBlock: "155000100",
    fallbackRpcBlock: "155000099",
    indexer: {
      lastIndexedBlock: "155000088",
      lastIndexedBlockHash: `0x${"33".repeat(32)}`,
      updatedLagSeconds: 12,
      blockLag: "12",
      maxIndexerBlockLag: "300",
    },
    healthStatus: "ready",
    executableQuoteId: `0x${"34".repeat(32)}`,
    indexedHistorySource: "postgres-indexer",
    verifiedReceipt: candidate.e2eVerificationResults.directV4.transactionHash,
    quoteSignerMode: "remote",
    quoteSignerAddress: candidate.quoteSigner,
    recoveredQuoteSigner: candidate.quoteSigner,
    securityHeaders: [
      "content-security-policy", "strict-transport-security", "cross-origin-opener-policy", "permissions-policy", "x-content-type-options", "x-frame-options",
    ],
    alertWebhookTest: "passed",
  };
  const validOperations = structuredClone(candidate.operationsVerificationResults);
  candidate.operationsVerificationResults.candidateRouter = candidate.v4Adapter;
  await writeFile(candidatePath, JSON.stringify(candidate));
  const tamperedOperations = runPromotion();
  assert.notEqual(tamperedOperations.status, 0, "operations evidence for another router must not promote");
  assert.match(`${tamperedOperations.stdout}${tamperedOperations.stderr}`, /different candidate router/i);
  assert.equal(await hash(officialPath), before, "tampered operations evidence must never modify the official manifest");
  candidate.operationsVerificationResults = validOperations;
  await writeFile(candidatePath, JSON.stringify(candidate));
  const missingAssurance = runPromotion();
  assert.notEqual(missingAssurance.status, 0, "candidate without signed external assurance must not promote");
  assert.match(`${missingAssurance.stdout}${missingAssurance.stderr}`, /External assurance and formal approvals have not passed/i);
  assert.equal(await hash(officialPath), before, "missing-assurance promotion must not modify the official manifest");

  const monitor = spawnSync(process.execPath, [path.join(root, "scripts/monitor.cjs")], {
    cwd: root,
    env: { ...process.env, MONITOR_MAX_BLOCK_LAG_SECONDS: "Infinity" },
    encoding: "utf8",
  });
  assert.notEqual(monitor.status, 0, "unbounded monitor configuration must fail closed");
  assert.match(`${monitor.stdout}${monitor.stderr}`, /must be an integer/i);

  const discovery = spawnSync(process.execPath, [path.join(root, "scripts/discover-pools.cjs")], {
    cwd: root,
    env: { ...process.env, POOL_DISCOVERY_CHUNK: "0" },
    encoding: "utf8",
  });
  assert.notEqual(discovery.status, 0, "zero-sized discovery chunks must fail closed");
  assert.match(`${discovery.stdout}${discovery.stderr}`, /must be between 1 and 10000/i);

  console.log("Release gates: timelock, Aggregator Hook, E2E, router-bound hosted operations, signed assurance, monitor bounds, and discovery bounds fail closed");
} finally {
  await rm(temp, { recursive: true, force: true });
}
