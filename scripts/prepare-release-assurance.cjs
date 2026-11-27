#!/usr/bin/env node
/** Prints the release binding and exact personal-sign messages without handling keys. */
const fs = require("node:fs");
const path = require("node:path");
const { attestationMessage, releaseDigest } = require("./lib/release-assurance.cjs");
const { walletConnectMessage } = require("./lib/wallet-attestation.cjs");

const candidatePath = path.resolve(process.cwd(), process.env.CANDIDATE_MANIFEST || "deployments/robinhood-testnet.v2-candidate.json");
if (!fs.existsSync(candidatePath)) throw new Error(`Candidate manifest not found: ${candidatePath}`);
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
const digest = releaseDigest(candidate);
const assurance = candidate.releaseAssurance || {};
const entries = {
  independentAudit: assurance.independentAudit,
  incidentDrill: assurance.incidentDrill,
  bugBounty: assurance.bugBounty,
  signerCustody: assurance.signerCustody,
  engineering: assurance.approvals?.engineering,
  security: assurance.approvals?.security,
  governance: assurance.approvals?.governance,
  operations: assurance.approvals?.operations,
};
const messages = Object.fromEntries(Object.entries(entries)
  .filter(([, entry]) => entry?.payload)
  .map(([name, entry]) => [name, attestationMessage(entry.payload)]));
const wallet = candidate.releaseEvidence?.walletConnect;
if (wallet) messages.walletConnect = walletConnectMessage(candidate, wallet);
console.log(JSON.stringify({ candidate: candidatePath, releaseCommitSha: candidate.releaseCommitSha, releaseDigest: digest, messages }, null, 2));
