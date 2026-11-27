#!/usr/bin/env node
/** Verifies cryptographically signed external assurance and formal approvals. */
const fs = require("node:fs");
const path = require("node:path");
const { validateAssurance } = require("./lib/release-assurance.cjs");

const root = path.resolve(__dirname, "..");
const candidatePath = path.resolve(process.cwd(), process.env.CANDIDATE_MANIFEST || "deployments/robinhood-testnet.v2-candidate.json");
if (!fs.existsSync(candidatePath)) throw new Error(`Candidate manifest not found: ${candidatePath}`);

async function main() {
  const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
  const result = await validateAssurance(candidate, { fetchArtifacts: true });
  candidate.assuranceVerification = "passed";
  candidate.assuranceVerifiedAt = new Date().toISOString();
  candidate.assuranceVerificationResults = result;
  candidate.executionReady = false;
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ candidate: path.relative(root, candidatePath), status: "passed", result }, null, 2));
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exitCode = 1;
});
