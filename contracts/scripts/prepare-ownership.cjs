const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

function main() {
  const manifestPath = path.resolve(process.cwd(), process.env.CANDIDATE_MANIFEST || "deployments/robinhood-testnet.v2-candidate.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`Candidate manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!manifest.timelock || manifest.owner.toLowerCase() !== manifest.timelock.toLowerCase()) throw new Error("Candidate owner is not its declared timelock");
  if (manifest.ownershipStatus !== "pending-acceptance") throw new Error(`Ownership status is ${manifest.ownershipStatus}, not pending-acceptance`);

  const targets = [manifest.permRouter, manifest.v4Adapter, manifest.v3Adapter];
  const values = targets.map(() => "0");
  const accept = new ethers.Interface(["function acceptOwnership()"]);
  const payloads = targets.map(() => accept.encodeFunctionData("acceptOwnership"));
  const predecessor = ethers.ZeroHash;
  const salt = ethers.id(`PERM_ROUTER_V2_OWNERSHIP_${manifest.permRouter.toLowerCase()}`);
  const delay = String(manifest.timelockDelaySeconds || 0);
  const operationId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["address[]", "uint256[]", "bytes[]", "bytes32", "bytes32"],
    [targets, values, payloads, predecessor, salt],
  ));
  const timelock = new ethers.Interface([
    "function scheduleBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt,uint256 delay)",
    "function executeBatch(address[] targets,uint256[] values,bytes[] payloads,bytes32 predecessor,bytes32 salt) payable",
  ]);
  const result = {
    chainId: manifest.chainId,
    timelock: manifest.timelock,
    proposer: process.env.TIMELOCK_PROPOSER_ADDRESS || null,
    operationId,
    targets,
    values,
    payloads,
    predecessor,
    salt,
    delaySeconds: delay,
    scheduleCalldata: timelock.encodeFunctionData("scheduleBatch", [targets, values, payloads, predecessor, salt, delay]),
    executeCalldata: timelock.encodeFunctionData("executeBatch", [targets, values, payloads, predecessor, salt]),
    instructions: [
      "Submit scheduleCalldata to the timelock from an authorized proposer.",
      `Wait at least ${delay} seconds and confirm the operation is ready.`,
      "Submit executeCalldata to the timelock (executor role is open in the default deployment).",
      "Run deployments:verify-candidate again; never promote while ownership is pending.",
    ],
    generatedAt: new Date().toISOString(),
  };
  const output = path.resolve(process.cwd(), process.env.OWNERSHIP_PLAN_OUTPUT || "deployments/ownership-acceptance.json");
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Ownership acceptance plan written to ${output}`);
  console.log(`Operation ID: ${operationId}`);
}

try { main(); } catch (error) { console.error(error.message || error); process.exitCode = 1; }
