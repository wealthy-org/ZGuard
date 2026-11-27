#!/usr/bin/env node
/** Prepares the exact public QA attestation message after a real manual WalletConnect settlement. */
const fs = require("node:fs");
const path = require("node:path");
const { getAddress, isAddress, isHash } = require("viem");
const { walletConnectMessage } = require("./lib/wallet-attestation.cjs");

const root = path.resolve(__dirname, "..");
const manifestPath = path.resolve(root, process.env.STAGING_PUBLIC_MANIFEST || "deployments/robinhood-testnet.v2-staging.json");
const evidencePath = path.resolve(root, process.env.STAGING_WALLETCONNECT_EVIDENCE || ".staging/walletconnect.json");

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function template(manifest) {
  return {
    status: "passed-staging-only",
    account: "",
    transactionHash: "",
    receiptId: "",
    walletName: "",
    device: "",
    testedAt: "",
    attestedBy: "",
    sessionTopicHash: "",
    attestationSigner: "",
    attestationSignature: "",
    note: `Manual WalletConnect evidence for chain ${manifest.chainId} Router ${manifest.contracts.permRouter.address}. Never add the raw session topic.`,
  };
}

function main() {
  required(fs.existsSync(manifestPath), `Public staging manifest not found: ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  required(manifest.chainId === 46_630 && manifest.routerVersion === 2 && manifest.nonRelease === true && manifest.executionReady === false,
    "Manifest is not the non-release chain-46630 Router-v2 staging record");
  if (!fs.existsSync(evidencePath)) {
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(evidencePath, `${JSON.stringify(template(manifest), null, 2)}\n`, { mode: 0o600 });
    console.log(`WalletConnect evidence template written to ${path.relative(root, evidencePath)}`);
    console.log("Complete it only after a real mobile QR session and canonical Router-v2 settlement; never store the raw session topic.");
    return;
  }

  const wallet = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  required(!("sessionTopic" in wallet), "Raw WalletConnect sessionTopic must never be stored");
  required(wallet.status === "passed-staging-only", "WalletConnect status must be passed-staging-only");
  required(isAddress(wallet.account), "WalletConnect account is required");
  required(isHash(wallet.transactionHash) && isHash(wallet.receiptId), "WalletConnect transactionHash and receiptId are required");
  required(typeof wallet.walletName === "string" && wallet.walletName.trim().length >= 2, "walletName is required");
  required(typeof wallet.device === "string" && wallet.device.trim().length >= 2, "device is required");
  required(typeof wallet.attestedBy === "string" && wallet.attestedBy.trim().length >= 3, "attestedBy is required");
  required(Number.isFinite(Date.parse(wallet.testedAt)), "testedAt must be an ISO timestamp");
  required(isHash(wallet.sessionTopicHash), "sessionTopicHash is required; store only the one-way hash");
  required(isAddress(wallet.attestationSigner), "attestationSigner is required");
  const operationalAddresses = [
    wallet.account,
    manifest.roles.owner,
    manifest.roles.treasury,
    manifest.roles.pauseGuardian,
    manifest.roles.quoteSigner,
    manifest.stagingEvidenceSuite.referrer,
  ].map(getAddress);
  required(!operationalAddresses.some((address) => address === getAddress(wallet.attestationSigner)),
    "QA attester must be independent of the test account and every staging operational role");

  const candidate = { chainId: manifest.chainId, permRouter: manifest.contracts.permRouter.address };
  console.log(JSON.stringify({
    nonRelease: true,
    evidence: path.relative(root, evidencePath),
    account: getAddress(wallet.account),
    attestationSigner: getAddress(wallet.attestationSigner),
    message: walletConnectMessage(candidate, wallet),
    next: "Have the independent QA signer personal-sign this exact message, then place only the public signature in attestationSignature and run staging:verify-walletconnect.",
  }, null, 2));
}

try { main(); } catch (error) { console.error(error.message || error); process.exitCode = 1; }
