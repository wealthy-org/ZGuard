import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import assuranceModule from "./lib/release-assurance.cjs";

const { attestationMessage, releaseDigest, validateAssurance } = assuranceModule;
const keys = Array.from({ length: 8 }, (_, index) => `0x${(index + 1).toString(16).padStart(64, "0")}`);
const [auditor, incidentLead, bountyLead, custodyReviewer, engineering, security, governance, operations] = keys.map((key) => privateKeyToAccount(key));
const hash = (character) => character.repeat(64);
const tx = (character) => `0x${character.repeat(64)}`;
const now = Date.parse("2026-11-17T12:00:00.000Z");
const candidate = {
  schemaVersion: 2,
  routerVersion: 2,
  chainId: 46630,
  releaseCommitSha: "a".repeat(40),
  permRouter: `0x${"10".repeat(20)}`,
  v4Adapter: `0x${"11".repeat(20)}`,
  v3Adapter: `0x${"12".repeat(20)}`,
  timelock: `0x${"13".repeat(20)}`,
  quoteSigner: `0x${"14".repeat(20)}`,
  treasury: `0x${"15".repeat(20)}`,
  pauseGuardian: `0x${"16".repeat(20)}`,
  permit2: `0x${"17".repeat(20)}`,
  policy: { version: 1, platformFeeBps: 20, rebateShareBps: 2500 },
  runtimeCodehashes: Object.fromEntries(["permRouter", "v4Adapter", "v3Adapter", "timelock"]
    .map((field, index) => [field, `0x${(index + 161).toString(16).repeat(32)}`])),
  dependencyCodehashes: Object.fromEntries([
    "poolManager", "v4Quoter", "permit2", "synthraFactory", "synthraSwapRouter", "synthraQuoter", "synthraQuoterShim", "synthraWeth",
  ].map((field, index) => [field, `0x${(index + 177).toString(16).repeat(32)}`])),
  deploymentBlock: 155_000_000,
  deploymentTransactions: [tx("1"), tx("2"), tx("3"), tx("4"), tx("5")],
};
const digest = releaseDigest(candidate);
const common = {
  schemaVersion: 1,
  chainId: 46630,
  router: candidate.permRouter,
  releaseCommitSha: candidate.releaseCommitSha,
  releaseDigest: digest,
};

async function signed(account, payload) {
  return { payload, signer: account.address, signature: await account.signMessage({ message: attestationMessage(payload) }) };
}

candidate.releaseAssurance = {
  schemaVersion: 1,
  independentAudit: await signed(auditor, {
    ...common,
    kind: "independent-audit",
    completedAt: "2026-11-10T12:00:00.000Z",
    auditorOrganization: "Independent Security Labs",
    unresolvedCritical: 0,
    unresolvedHigh: 0,
    scope: ["PermRouter", "PermV4Adapter", "PermV3Adapter", "PermTimelock", "release-tooling"],
    reportUrl: "https://evidence.example/audit.pdf",
    reportSha256: hash("a"),
  }),
  incidentDrill: await signed(incidentLead, {
    ...common,
    kind: "incident-drill",
    completedAt: "2026-11-11T12:00:00.000Z",
    outcome: "passed",
    scenarios: ["emergency-pause", "quote-signer-compromise", "rpc-failover", "indexer-reorg"],
    reportUrl: "https://evidence.example/incident.pdf",
    reportSha256: hash("b"),
  }),
  bugBounty: await signed(bountyLead, {
    ...common,
    kind: "bug-bounty-readiness",
    reviewedAt: "2026-11-12T12:00:00.000Z",
    status: "active",
    scopeAddresses: [candidate.permRouter, candidate.v4Adapter, candidate.v3Adapter],
    policyUrl: "https://evidence.example/bounty-policy.pdf",
    policySha256: hash("c"),
    fundingEvidenceUrl: "https://evidence.example/bounty-funding.pdf",
    fundingEvidenceSha256: hash("d"),
  }),
  signerCustody: await signed(custodyReviewer, {
    ...common,
    kind: "quote-signer-custody",
    quoteSigner: candidate.quoteSigner,
    reviewedAt: "2026-11-13T12:00:00.000Z",
    provider: "Test KMS",
    keyIdHash: `0x${hash("e")}`,
    controls: ["non-exportable-key", "authenticated-remote-signing", "rotation-tested", "emergency-disable-tested"],
    reportUrl: "https://evidence.example/signer-custody.pdf",
    reportSha256: hash("f"),
    remoteSignerProbeUrl: "https://evidence.example/remote-signer-probe.json",
    remoteSignerProbeSha256: hash("9"),
  }),
  approvals: {},
};
for (const [role, account] of Object.entries({ engineering, security, governance, operations })) {
  candidate.releaseAssurance.approvals[role] = await signed(account, {
    ...common,
    kind: "release-approval",
    role,
    approvedAt: "2026-11-16T12:00:00.000Z",
    decision: "approve-robinhood-testnet-v2",
    unresolvedCritical: 0,
    unresolvedHigh: 0,
  });
}

const env = {
  RELEASE_AUDITOR_SIGNERS: auditor.address,
  RELEASE_INCIDENT_SIGNERS: incidentLead.address,
  RELEASE_BUG_BOUNTY_SIGNERS: bountyLead.address,
  RELEASE_CUSTODY_ATTESTERS: custodyReviewer.address,
  RELEASE_ENGINEERING_APPROVERS: engineering.address,
  RELEASE_SECURITY_APPROVERS: security.address,
  RELEASE_GOVERNANCE_APPROVERS: governance.address,
  RELEASE_OPERATIONS_APPROVERS: operations.address,
};
const result = await validateAssurance(candidate, { env, now, fetchArtifacts: false });
assert.equal(result.releaseDigest, digest);
assert.equal(result.approvals.security.signer, security.address);
const fetchedEvidence = [];
const artifactResult = await validateAssurance(candidate, {
  env,
  now,
  fetchEvidence: async (url, artifactSha256, label) => {
    fetchedEvidence.push({ url, artifactSha256, label });
    return { url, sha256: artifactSha256, bytes: 1, pinnedAddress: "1.1.1.1" };
  },
});
assert.equal(fetchedEvidence.length, 6);
assert(fetchedEvidence.some((entry) => entry.label === "remote quote signer probe" && entry.url.endsWith("remote-signer-probe.json")));
assert.equal(artifactResult.evidence.remoteSignerProbe.sha256, hash("9"));
assert.equal(releaseDigest(candidate), digest, "assurance signatures must not create a circular release digest");
const changedEvidence = structuredClone(candidate);
changedEvidence.operationsVerificationResults = { healthStatus: "not-ready" };
assert.notEqual(releaseDigest(changedEvidence), digest, "hosted evidence mutations must change the signed release digest");
await assert.rejects(() => validateAssurance(changedEvidence, { env, now, fetchArtifacts: false }), /releaseDigest does not match/i);

const tampered = structuredClone(candidate);
tampered.releaseAssurance.independentAudit.payload.unresolvedHigh = 1;
await assert.rejects(() => validateAssurance(tampered, { env, now, fetchArtifacts: false }), /signature does not recover|zero unresolved/i);

const duplicate = structuredClone(candidate);
duplicate.releaseAssurance.approvals.operations = await signed(engineering, {
  ...common,
  kind: "release-approval",
  role: "operations",
  approvedAt: "2026-11-16T12:00:00.000Z",
  decision: "approve-robinhood-testnet-v2",
  unresolvedCritical: 0,
  unresolvedHigh: 0,
});
await assert.rejects(() => validateAssurance(duplicate, {
  env: { ...env, RELEASE_OPERATIONS_APPROVERS: engineering.address }, now, fetchArtifacts: false,
}), /distinct signers/i);

const operationalIncident = structuredClone(candidate);
operationalIncident.owner = incidentLead.address;
await assert.rejects(() => validateAssurance(operationalIncident, { env, now, fetchArtifacts: false }), /external assurance attesters.*operational/i);

const operationalApprover = structuredClone(candidate);
operationalApprover.owner = engineering.address;
await assert.rejects(() => validateAssurance(operationalApprover, { env, now, fetchArtifacts: false }), /approvers.*independent/i);

const duplicateExternal = structuredClone(candidate);
duplicateExternal.releaseAssurance.incidentDrill = await signed(custodyReviewer, candidate.releaseAssurance.incidentDrill.payload);
await assert.rejects(() => validateAssurance(duplicateExternal, {
  env: { ...env, RELEASE_INCIDENT_SIGNERS: custodyReviewer.address }, now, fetchArtifacts: false,
}), /external assurance attestations.*distinct/i);

const approverAsAttester = structuredClone(candidate);
approverAsAttester.releaseAssurance.signerCustody = await signed(security, candidate.releaseAssurance.signerCustody.payload);
await assert.rejects(() => validateAssurance(approverAsAttester, {
  env: { ...env, RELEASE_CUSTODY_ATTESTERS: security.address }, now, fetchArtifacts: false,
}), /attesters.*formal approvers/i);

await assert.rejects(() => validateAssurance(candidate, { env, now: Date.parse("2027-01-01T12:00:00.000Z"), fetchArtifacts: false }), /older than 7 days/i);
console.log("Release assurance: four distinct external attesters, four distinct approvers, and operational-role independence verify and fail closed");
