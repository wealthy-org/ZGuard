#!/usr/bin/env node
/** Re-runs onchain configuration checks for a v2 candidate and confirms explorer
 * source publication. It never promotes or enables the frontend. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createPublicClient, defineChain, http, keccak256 } = require("viem");

const root = path.resolve(__dirname, "..");
const candidatePath = path.resolve(process.cwd(), process.env.CANDIDATE_MANIFEST || "deployments/robinhood-testnet.v2-candidate.json");
if (!fs.existsSync(candidatePath)) throw new Error(`Candidate manifest not found: ${candidatePath}`);
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
if (candidate.chainId !== 46630 || candidate.routerVersion !== 2 || candidate.schemaVersion !== 2) {
  throw new Error("Candidate must be a Router v2 manifest for chain 46630");
}

async function explorerVerified(address) {
  const endpoint = `${candidate.explorerUrl}/api?module=contract&action=getsourcecode&address=${address}`;
  const response = await fetch(endpoint, {
    headers: { accept: "application/json", "user-agent": "PermReleaseVerifier/2.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Explorer source query failed for ${address}: HTTP ${response.status}`);
  const body = await response.json();
  const result = Array.isArray(body.result) ? body.result[0] : undefined;
  return Boolean(result && typeof result.SourceCode === "string" && result.SourceCode.trim() && result.ContractName);
}

function contractBuild(sourceName, contractName) {
  const buildDir = path.join(root, "contracts/artifacts/build-info");
  if (!fs.existsSync(buildDir)) throw new Error("Compile contracts before candidate verification; build-info is missing");
  for (const file of fs.readdirSync(buildDir).filter((name) => name.endsWith(".json"))) {
    const build = JSON.parse(fs.readFileSync(path.join(buildDir, file), "utf8"));
    const contract = build.output?.contracts?.[sourceName]?.[contractName];
    if (contract?.evm?.deployedBytecode?.object) return contract.evm.deployedBytecode;
  }
  throw new Error(`Build info not found for ${sourceName}:${contractName}`);
}

function maskImmutableReferences(bytecode, references) {
  const body = bytecode.startsWith("0x") ? bytecode.slice(2) : bytecode;
  const chars = body.split("");
  for (const ranges of Object.values(references || {})) {
    for (const range of ranges) {
      const start = Number(range.start) * 2;
      const end = start + Number(range.length) * 2;
      for (let index = start; index < end; index += 1) chars[index] = "0";
    }
  }
  return `0x${chars.join("")}`;
}

async function runtimeVerified(client, address, sourceName, contractName) {
  const expected = contractBuild(sourceName, contractName);
  const actual = await client.getCode({ address });
  if (!actual || actual === "0x") return { matches: false, reason: "no runtime bytecode" };
  if (expected.object.length !== actual.length - 2) {
    return { matches: false, reason: "runtime bytecode length mismatch", expectedLength: expected.object.length / 2, actualLength: (actual.length - 2) / 2, runtimeCodehash: keccak256(actual) };
  }
  const references = expected.immutableReferences || {};
  const normalizedExpected = maskImmutableReferences(`0x${expected.object}`, references);
  const normalizedActual = maskImmutableReferences(actual, references);
  return {
    matches: normalizedExpected === normalizedActual,
    expectedLength: (expected.object.length / 2),
    actualLength: ((actual.length - 2) / 2),
    runtimeCodehash: keccak256(actual),
    normalizedCodehash: keccak256(normalizedActual),
    expectedNormalizedCodehash: keccak256(normalizedExpected),
  };
}

async function main() {
  const output = path.join(os.tmpdir(), `perm-monitor-${process.pid}.json`);
  const run = spawnSync(process.execPath, [path.join(root, "scripts/monitor.cjs")], {
    cwd: root,
    env: { ...process.env, PERM_MANIFEST_PATH: candidatePath, MONITOR_OUTPUT: output, PERM_ALERT_WEBHOOK_URL: "" },
    encoding: "utf8",
  });
  if (run.status !== 0 || !fs.existsSync(output)) {
    process.stderr.write(run.stdout || "");
    process.stderr.write(run.stderr || "");
    throw new Error("Candidate failed onchain configuration monitoring");
  }
  const report = JSON.parse(fs.readFileSync(output, "utf8"));
  fs.rmSync(output, { force: true });
  if (report.failures.length) throw new Error(`Candidate checks failed: ${report.failures.join("; ")}`);

  const rpcUrl = process.env.RH_TESTNET_RPC_URL || candidate.rpcUrl;
  const chain = defineChain({ id: candidate.chainId, name: candidate.network, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
  const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) });
  const contracts = [
    { address: candidate.permRouter, sourceName: "contracts/src/PermRouter.sol", contractName: "PermRouter" },
    { address: candidate.v4Adapter, sourceName: "contracts/src/adapters/PermV4Adapter.sol", contractName: "PermV4Adapter" },
    { address: candidate.v3Adapter, sourceName: "contracts/src/adapters/PermV3Adapter.sol", contractName: "PermV3Adapter" },
    { address: candidate.timelock, sourceName: "contracts/src/PermTimelock.sol", contractName: "PermTimelock" },
  ].filter((entry) => entry.address);
  const verification = await Promise.all(contracts.map(async (entry) => ({
    address: entry.address,
    contractName: entry.contractName,
    explorerVerified: await explorerVerified(entry.address),
    bytecode: await runtimeVerified(client, entry.address, entry.sourceName, entry.contractName),
  })));
  const sourcesVerified = verification.every((entry) => entry.explorerVerified && entry.bytecode.matches);
  const owners = [report.checks.owner, report.checks.v4Adapter?.owner, report.checks.v3Adapter?.owner].filter(Boolean);
  const ownershipAccepted = owners.length === 3 && owners.every((owner) => owner.toLowerCase() === candidate.owner.toLowerCase());

  candidate.currentOwner = report.checks.owner;
  candidate.ownershipStatus = ownershipAccepted ? "accepted" : "pending-acceptance";
  candidate.sourceVerification = sourcesVerified ? "verified" : "pending";
  candidate.postDeploymentChecks = "passed";
  candidate.releaseStatus = "candidate";
  candidate.executionReady = false;
  candidate.lastVerifiedAt = new Date().toISOString();
  candidate.sourceVerificationResults = verification;
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);

  const roleSeparation = candidate.owner?.toLowerCase() !== candidate.treasury?.toLowerCase()
    && candidate.quoteSigner?.toLowerCase() !== candidate.owner?.toLowerCase()
    && candidate.quoteSigner?.toLowerCase() !== candidate.treasury?.toLowerCase();
  const repositoryBound = /^[0-9a-f]{40}$/i.test(candidate.releaseCommitSha || "")
    && candidate.repositoryDirtyAtDeployment === false;
  const releaseGatesPassed = candidate.aggregatorHookVerification === "passed"
    && candidate.e2eVerification === "passed"
    && candidate.operationsVerification === "passed"
    && candidate.assuranceVerification === "passed";
  const promotionReady = ownershipAccepted && sourcesVerified && roleSeparation && repositoryBound && releaseGatesPassed;
  console.log(JSON.stringify({
    candidate: path.relative(root, candidatePath),
    onchainChecks: "passed",
    ownershipStatus: candidate.ownershipStatus,
    sourceVerification: candidate.sourceVerification,
    roleSeparation,
    repositoryBound,
    aggregatorHookVerification: candidate.aggregatorHookVerification || "pending",
    e2eVerification: candidate.e2eVerification || "pending",
    operationsVerification: candidate.operationsVerification || "pending",
    assuranceVerification: candidate.assuranceVerification || "pending",
    contracts: verification,
    promotionReady,
  }, null, 2));
  if (!promotionReady) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
