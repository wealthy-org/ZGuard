const { createHash } = require("node:crypto");
const { promises: dns } = require("node:dns");
const https = require("node:https");
const net = require("node:net");
const { getAddress, isAddress, keccak256, recoverMessageAddress, toHex } = require("viem");

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1_000;

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function stableStringify(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    required(Number.isFinite(value), "Attestation payload contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  required(value && typeof value === "object", "Attestation payload contains an unsupported value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function releaseEvidenceCommitment(candidate) {
  const evidence = {
    schemaVersion: 1,
    repositoryDirtyAtDeployment: candidate.repositoryDirtyAtDeployment ?? null,
    postDeploymentChecks: candidate.postDeploymentChecks ?? null,
    sourceVerification: candidate.sourceVerification ?? null,
    sourceVerifiedAt: candidate.sourceVerifiedAt ?? null,
    sourceVerificationResults: candidate.sourceVerificationResults ?? null,
    ownershipStatus: candidate.ownershipStatus ?? null,
    ownershipAcceptedAt: candidate.ownershipAcceptedAt ?? null,
    currentOwner: candidate.currentOwner ?? null,
    timelockDelaySeconds: candidate.timelockDelaySeconds ?? null,
    aggregatorHooks: candidate.aggregatorHooks ?? null,
    aggregatorHookVerification: candidate.aggregatorHookVerification ?? null,
    aggregatorHookVerifiedAt: candidate.aggregatorHookVerifiedAt ?? null,
    aggregatorHookVerificationResults: candidate.aggregatorHookVerificationResults ?? null,
    releaseEvidence: candidate.releaseEvidence ?? null,
    e2eVerification: candidate.e2eVerification ?? null,
    e2eVerifiedAt: candidate.e2eVerifiedAt ?? null,
    e2eVerificationResults: candidate.e2eVerificationResults ?? null,
    operationsVerification: candidate.operationsVerification ?? null,
    operationsVerifiedAt: candidate.operationsVerifiedAt ?? null,
    operationsVerificationResults: candidate.operationsVerificationResults ?? null,
  };
  return keccak256(toHex(stableStringify(evidence)));
}

function releaseIdentity(candidate) {
  required(candidate.schemaVersion === 2 && candidate.routerVersion === 2 && candidate.chainId === 46630,
    "Release assurance requires a chain-46630 Router-v2 candidate");
  required(/^[0-9a-f]{40}$/i.test(candidate.releaseCommitSha || ""), "Candidate releaseCommitSha must be a 40-character Git commit");
  const addresses = {};
  for (const field of ["permRouter", "v4Adapter", "v3Adapter", "timelock", "quoteSigner", "treasury", "pauseGuardian", "permit2"]) {
    required(isAddress(candidate[field]), `Candidate ${field} is invalid`);
    addresses[field] = getAddress(candidate[field]);
  }
  required(candidate.policy && Number.isInteger(candidate.policy.version)
    && Number.isInteger(candidate.policy.platformFeeBps) && Number.isInteger(candidate.policy.rebateShareBps),
  "Candidate fee policy is invalid");
  required(Number.isSafeInteger(candidate.deploymentBlock) && candidate.deploymentBlock > 0, "Candidate deploymentBlock is invalid");
  required(Array.isArray(candidate.deploymentTransactions) && candidate.deploymentTransactions.length >= 5
    && candidate.deploymentTransactions.every((hash) => /^0x[0-9a-f]{64}$/i.test(hash)),
  "Candidate deploymentTransactions are incomplete");
  const runtimeCodehashes = {};
  for (const field of ["permRouter", "v4Adapter", "v3Adapter", "timelock"]) {
    required(/^0x[0-9a-f]{64}$/i.test(candidate.runtimeCodehashes?.[field] || ""), `Candidate runtimeCodehashes.${field} is invalid`);
    runtimeCodehashes[field] = candidate.runtimeCodehashes[field].toLowerCase();
  }
  const dependencyCodehashes = {};
  for (const field of ["poolManager", "v4Quoter", "permit2", "synthraFactory", "synthraSwapRouter", "synthraQuoter", "synthraQuoterShim", "synthraWeth"]) {
    required(/^0x[0-9a-f]{64}$/i.test(candidate.dependencyCodehashes?.[field] || ""), `Candidate dependencyCodehashes.${field} is invalid`);
    dependencyCodehashes[field] = candidate.dependencyCodehashes[field].toLowerCase();
  }
  return {
    schemaVersion: 1,
    chainId: candidate.chainId,
    routerVersion: candidate.routerVersion,
    releaseCommitSha: candidate.releaseCommitSha.toLowerCase(),
    ...addresses,
    policy: {
      version: candidate.policy.version,
      platformFeeBps: candidate.policy.platformFeeBps,
      rebateShareBps: candidate.policy.rebateShareBps,
    },
    runtimeCodehashes,
    dependencyCodehashes,
    releaseEvidenceCommitment: releaseEvidenceCommitment(candidate),
    deploymentBlock: candidate.deploymentBlock,
    deploymentTransactions: candidate.deploymentTransactions.map((hash) => hash.toLowerCase()),
  };
}

function releaseDigest(candidate) {
  return keccak256(toHex(stableStringify(releaseIdentity(candidate))));
}

function attestationMessage(payload) {
  return `Perm Robinhood testnet release attestation v1\n${stableStringify(payload)}`;
}

function signerSet(name, env) {
  const raw = env[name] || "";
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  required(values.length > 0, `${name} must contain at least one trusted signer address`);
  required(values.every(isAddress), `${name} contains an invalid signer address`);
  return new Set(values.map((value) => getAddress(value).toLowerCase()));
}

function timestamp(value, label, now, maxAge) {
  const parsed = Date.parse(value);
  required(Number.isFinite(parsed), `${label} is not an ISO timestamp`);
  required(parsed <= now + 5 * 60_000, `${label} is in the future`);
  required(now - parsed <= maxAge, `${label} is older than ${Math.floor(maxAge / DAY)} days`);
  return new Date(parsed).toISOString();
}

function sha256(value, label) {
  required(/^[0-9a-f]{64}$/i.test(value || ""), `${label} must be a SHA-256 hex digest`);
  return value.toLowerCase();
}

const blockedIpv4 = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blockedIpv4.addSubnet(address, prefix, "ipv4");
const blockedIpv6 = new net.BlockList();
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["100::", 64], ["2001::", 32], ["2001:2::", 48], ["2001:10::", 28], ["2001:db8::", 32],
  ["2002::", 16], ["3fff::", 20], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
]) blockedIpv6.addSubnet(address, prefix, "ipv6");

function isPrivateIp(address) {
  const family = net.isIP(address);
  if (family === 4) return blockedIpv4.check(address, "ipv4");
  if (family === 6) return blockedIpv6.check(address, "ipv6");
  return true;
}

async function publicHttpsTarget(value, label, lookup = dns.lookup) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a valid URL`); }
  required(url.protocol === "https:" && !url.username && !url.password, `${label} must be a credential-free HTTPS URL`);
  required(!url.port || url.port === "443", `${label} must use the standard HTTPS port`);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  required(hostname !== "localhost" && !hostname.endsWith(".local"), `${label} may not target a local host`);
  let addresses;
  try {
    addresses = net.isIP(hostname)
      ? [{ address: hostname, family: net.isIP(hostname) }]
      : await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`${label} DNS lookup failed`);
  }
  if (!Array.isArray(addresses)) addresses = [addresses];
  const normalized = addresses.map((entry) => ({ address: entry.address, family: Number(entry.family) || net.isIP(entry.address) }));
  required(normalized.length > 0
    && normalized.every((entry) => (entry.family === 4 || entry.family === 6) && net.isIP(entry.address) === entry.family),
  `${label} DNS lookup returned an invalid address`);
  required(normalized.every((entry) => !isPrivateIp(entry.address)), `${label} resolves to a non-public address`);
  return {
    url,
    hostname,
    addresses: normalized.filter((entry, index, all) => all.findIndex((candidate) => candidate.address === entry.address) === index),
  };
}

function responseHeader(headers, name) {
  if (headers && typeof headers.get === "function") return headers.get(name);
  const value = headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value === undefined ? null : String(value);
}

function pinnedHttpsDownload(target, label) {
  const pinned = target.addresses[0];
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (value) => { if (!settled) { settled = true; resolve(value); } };
    const fail = (error) => { if (!settled) { settled = true; reject(error); } };
    const request = https.request(target.url, {
      method: "GET",
      agent: false,
      autoSelectFamily: false,
      family: pinned.family,
      servername: net.isIP(target.hostname) ? undefined : target.hostname,
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
      headers: {
        accept: "application/pdf,application/json,text/plain,text/html;q=0.8",
        "user-agent": "PermReleaseAssuranceVerifier/1.0",
      },
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const headers = response.headers;
      if ([301, 302, 303, 307, 308].includes(status) || status < 200 || status >= 300) {
        response.resume();
        succeed({ status, headers, body: Buffer.alloc(0), pinnedAddress: pinned.address });
        return;
      }
      const rawLength = responseHeader(headers, "content-length");
      if (rawLength && (!/^\d+$/.test(rawLength) || Number(rawLength) > MAX_EVIDENCE_BYTES)) {
        const error = new Error(`${label} exceeds ${MAX_EVIDENCE_BYTES} bytes`);
        fail(error);
        response.destroy(error);
        return;
      }
      const chunks = [];
      let total = 0;
      response.on("data", (chunk) => {
        total += chunk.length;
        if (total > MAX_EVIDENCE_BYTES) {
          const error = new Error(`${label} exceeds ${MAX_EVIDENCE_BYTES} bytes`);
          fail(error);
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => succeed({ status, headers, body: Buffer.concat(chunks, total), pinnedAddress: pinned.address }));
      response.on("error", fail);
    });
    request.setTimeout(30_000, () => request.destroy(new Error(`${label} request timed out`)));
    request.on("error", fail);
    request.end();
  });
}

async function fetchEvidence(value, expectedSha256, label, options = {}) {
  const lookup = options.lookup || dns.lookup;
  const download = options.download || pinnedHttpsDownload;
  let target = await publicHttpsTarget(value, `${label}.url`, lookup);
  let response;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    response = await download(target, label);
    required(response && Number.isInteger(response.status), `${label} downloader returned an invalid response`);
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = responseHeader(response.headers, "location");
    required(redirects < 4 && location, `${label} has too many or invalid redirects`);
    let redirected;
    try { redirected = new URL(location, target.url).href; } catch { throw new Error(`${label} has too many or invalid redirects`); }
    target = await publicHttpsTarget(redirected, `${label}.redirect`, lookup);
  }
  required(response && response.status >= 200 && response.status < 300, `${label} returned HTTP ${response?.status || "unknown"}`);
  const rawLength = responseHeader(response.headers, "content-length");
  required(!rawLength || (/^\d+$/.test(rawLength) && Number(rawLength) <= MAX_EVIDENCE_BYTES),
    `${label} exceeds ${MAX_EVIDENCE_BYTES} bytes`);
  const bytes = Buffer.from(response.body || []);
  required(bytes.length > 0 && bytes.length <= MAX_EVIDENCE_BYTES, `${label} is empty or too large`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  required(actual === sha256(expectedSha256, `${label}.sha256`), `${label} SHA-256 does not match`);
  return { url: target.url.href, sha256: actual, bytes: bytes.length, pinnedAddress: response.pinnedAddress };
}

async function verifySigned(entry, label, trustedSigners, expected, now, maxAge, timestampField) {
  required(entry && entry.payload && typeof entry.payload === "object" && !Array.isArray(entry.payload), `${label}.payload is required`);
  required(isAddress(entry.signer), `${label}.signer is invalid`);
  required(/^0x[0-9a-f]{130}$/i.test(entry.signature || ""), `${label}.signature is invalid`);
  const signer = getAddress(entry.signer);
  required(trustedSigners.has(signer.toLowerCase()), `${label}.signer is not in the trusted release configuration`);
  const recovered = await recoverMessageAddress({ message: attestationMessage(entry.payload), signature: entry.signature });
  required(recovered.toLowerCase() === signer.toLowerCase(), `${label}.signature does not recover its declared signer`);
  for (const [key, value] of Object.entries(expected)) {
    required(String(entry.payload[key]).toLowerCase() === String(value).toLowerCase(), `${label}.payload.${key} does not match the release`);
  }
  const checkedAt = timestamp(entry.payload[timestampField], `${label}.payload.${timestampField}`, now, maxAge);
  return { signer, checkedAt, payload: entry.payload };
}

async function validateAssurance(candidate, options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now();
  const fetchArtifacts = options.fetchArtifacts !== false;
  const fetchArtifact = options.fetchEvidence || fetchEvidence;
  const assurance = candidate.releaseAssurance;
  required(assurance && assurance.schemaVersion === 1, "releaseAssurance schemaVersion 1 is required");
  const digest = releaseDigest(candidate);
  const common = {
    schemaVersion: 1,
    chainId: candidate.chainId,
    router: getAddress(candidate.permRouter),
    releaseCommitSha: candidate.releaseCommitSha.toLowerCase(),
    releaseDigest: digest,
  };
  const trust = {
    audit: signerSet("RELEASE_AUDITOR_SIGNERS", env),
    incident: signerSet("RELEASE_INCIDENT_SIGNERS", env),
    bounty: signerSet("RELEASE_BUG_BOUNTY_SIGNERS", env),
    custody: signerSet("RELEASE_CUSTODY_ATTESTERS", env),
    engineering: signerSet("RELEASE_ENGINEERING_APPROVERS", env),
    security: signerSet("RELEASE_SECURITY_APPROVERS", env),
    governance: signerSet("RELEASE_GOVERNANCE_APPROVERS", env),
    operations: signerSet("RELEASE_OPERATIONS_APPROVERS", env),
  };

  const audit = await verifySigned(assurance.independentAudit, "releaseAssurance.independentAudit", trust.audit,
    { ...common, kind: "independent-audit" }, now, 180 * DAY, "completedAt");
  required(typeof audit.payload.auditorOrganization === "string" && audit.payload.auditorOrganization.trim().length >= 3,
    "Independent audit organization is required");
  required(audit.payload.unresolvedCritical === 0 && audit.payload.unresolvedHigh === 0,
    "Independent audit must have zero unresolved critical/high findings");
  const requiredScope = ["PermRouter", "PermV4Adapter", "PermV3Adapter", "PermTimelock", "release-tooling"];
  required(Array.isArray(audit.payload.scope) && requiredScope.every((item) => audit.payload.scope.includes(item)),
    "Independent audit scope is incomplete");
  sha256(audit.payload.reportSha256, "Independent audit reportSha256");

  const incident = await verifySigned(assurance.incidentDrill, "releaseAssurance.incidentDrill", trust.incident,
    { ...common, kind: "incident-drill" }, now, 90 * DAY, "completedAt");
  required(incident.payload.outcome === "passed", "Incident drill outcome must be passed");
  const requiredScenarios = ["emergency-pause", "quote-signer-compromise", "rpc-failover", "indexer-reorg"];
  required(Array.isArray(incident.payload.scenarios) && requiredScenarios.every((item) => incident.payload.scenarios.includes(item)),
    "Incident drill scenarios are incomplete");
  sha256(incident.payload.reportSha256, "Incident drill reportSha256");

  const bounty = await verifySigned(assurance.bugBounty, "releaseAssurance.bugBounty", trust.bounty,
    { ...common, kind: "bug-bounty-readiness" }, now, 90 * DAY, "reviewedAt");
  required(bounty.payload.status === "active", "Bug bounty status must be active");
  required(Array.isArray(bounty.payload.scopeAddresses)
    && [candidate.permRouter, candidate.v4Adapter, candidate.v3Adapter].every((address) => bounty.payload.scopeAddresses.some((item) => isAddress(item) && getAddress(item) === getAddress(address))),
  "Bug bounty scope does not include all release contracts");
  sha256(bounty.payload.policySha256, "Bug bounty policySha256");
  sha256(bounty.payload.fundingEvidenceSha256, "Bug bounty fundingEvidenceSha256");

  const candidateRoles = [candidate.owner, candidate.quoteSigner, candidate.treasury, candidate.pauseGuardian]
    .filter((value) => isAddress(value)).map((value) => getAddress(value).toLowerCase());
  const custody = await verifySigned(assurance.signerCustody, "releaseAssurance.signerCustody", trust.custody,
    { ...common, kind: "quote-signer-custody", quoteSigner: getAddress(candidate.quoteSigner) }, now, 90 * DAY, "reviewedAt");
  required(typeof custody.payload.provider === "string" && custody.payload.provider.trim().length >= 3,
    "Quote signer custody provider is required");
  required(/^0x[0-9a-f]{64}$/i.test(custody.payload.keyIdHash || ""), "Quote signer custody keyIdHash must be bytes32");
  const custodyControls = ["non-exportable-key", "authenticated-remote-signing", "rotation-tested", "emergency-disable-tested"];
  required(Array.isArray(custody.payload.controls) && custodyControls.every((item) => custody.payload.controls.includes(item)),
    "Quote signer custody controls are incomplete");
  sha256(custody.payload.reportSha256, "Quote signer custody reportSha256");
  sha256(custody.payload.remoteSignerProbeSha256, "Quote signer custody remoteSignerProbeSha256");
  required(!candidateRoles.includes(custody.signer.toLowerCase()), "Quote signer custody attester must be independent of operational role addresses");

  const approvals = {};
  const approvalSigners = new Set();
  for (const role of ["engineering", "security", "governance", "operations"]) {
    const approval = await verifySigned(assurance.approvals?.[role], `releaseAssurance.approvals.${role}`, trust[role],
      { ...common, kind: "release-approval", role }, now, 7 * DAY, "approvedAt");
    required(approval.payload.decision === "approve-robinhood-testnet-v2", `${role} approval decision is invalid`);
    required(approval.payload.unresolvedCritical === 0 && approval.payload.unresolvedHigh === 0,
      `${role} approval reports unresolved critical/high findings`);
    required(!approvalSigners.has(approval.signer.toLowerCase()), "Formal release approvals must use distinct signers");
    approvalSigners.add(approval.signer.toLowerCase());
    approvals[role] = { signer: approval.signer, approvedAt: approval.checkedAt };
  }

  const externalAttesters = [audit, incident, bounty, custody].map((entry) => entry.signer.toLowerCase());
  required(new Set(externalAttesters).size === externalAttesters.length,
    "External assurance attestations must use distinct signers");
  required(externalAttesters.every((signer) => !candidateRoles.includes(signer)),
    "External assurance attesters must be independent of candidate operational addresses");
  required(externalAttesters.every((signer) => !approvalSigners.has(signer)),
    "External assurance attesters must be independent of formal approvers");
  required([...approvalSigners].every((signer) => !candidateRoles.includes(signer)),
    "Formal approvers must be independent of candidate operational addresses");

  let evidence;
  if (fetchArtifacts) {
    const [auditReport, incidentReport, bountyPolicy, bountyFunding, custodyReport, remoteSignerProbe] = await Promise.all([
      fetchArtifact(audit.payload.reportUrl, audit.payload.reportSha256, "independent audit report"),
      fetchArtifact(incident.payload.reportUrl, incident.payload.reportSha256, "incident drill report"),
      fetchArtifact(bounty.payload.policyUrl, bounty.payload.policySha256, "bug bounty policy"),
      fetchArtifact(bounty.payload.fundingEvidenceUrl, bounty.payload.fundingEvidenceSha256, "bug bounty funding evidence"),
      fetchArtifact(custody.payload.reportUrl, custody.payload.reportSha256, "quote signer custody report"),
      fetchArtifact(custody.payload.remoteSignerProbeUrl, custody.payload.remoteSignerProbeSha256, "remote quote signer probe"),
    ]);
    evidence = { auditReport, incidentReport, bountyPolicy, bountyFunding, custodyReport, remoteSignerProbe };
  }

  return {
    releaseDigest: digest,
    releaseCommitSha: candidate.releaseCommitSha.toLowerCase(),
    independentAudit: { signer: audit.signer, completedAt: audit.checkedAt, organization: audit.payload.auditorOrganization },
    incidentDrill: { signer: incident.signer, completedAt: incident.checkedAt, scenarios: requiredScenarios },
    bugBounty: { signer: bounty.signer, reviewedAt: bounty.checkedAt, status: bounty.payload.status },
    signerCustody: {
      signer: custody.signer,
      reviewedAt: custody.checkedAt,
      provider: custody.payload.provider,
      keyIdHash: custody.payload.keyIdHash,
      remoteSignerProbeSha256: custody.payload.remoteSignerProbeSha256,
    },
    approvals,
    ...(evidence ? { evidence } : {}),
  };
}

module.exports = {
  attestationMessage,
  fetchEvidence,
  isPrivateIp,
  publicHttpsTarget,
  releaseDigest,
  releaseEvidenceCommitment,
  releaseIdentity,
  stableStringify,
  validateAssurance,
};
