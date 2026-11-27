#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { Wallet } = require("ethers");

const root = path.resolve(__dirname, "..");
const directory = path.join(root, ".staging");
const secretPath = path.join(directory, "keys.env");
const addressPath = path.join(directory, "addresses.json");
const rotate = process.env.CONFIRM_ROTATE_STAGING_KEYS === "1";

if (fs.existsSync(secretPath) && !rotate) {
  throw new Error(`Refusing to overwrite ${path.relative(root, secretPath)}; set CONFIRM_ROTATE_STAGING_KEYS=1 only if the old testnet identities are no longer needed`);
}

fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const deployer = Wallet.createRandom();
const quoteSigner = Wallet.createRandom();
const testWallet = Wallet.createRandom();
const generatedAt = new Date().toISOString();

const environment = `# TESTNET-ONLY BURNER IDENTITIES. NEVER FUND WITH MAINNET ASSETS OR REUSE IN A RELEASE.\n# Generated ${generatedAt}\nDEPLOYMENT_STAGING=1\nCONFIRM_NON_RELEASE_STAGING=1\nDEPLOYER_PRIVATE_KEY=${deployer.privateKey}\nOWNER_ADDRESS=${deployer.address}\nTREASURY_ADDRESS=${deployer.address}\nPAUSE_GUARDIAN_ADDRESS=${deployer.address}\nQUOTE_SIGNER_ADDRESS=${quoteSigner.address}\nPERM_QUOTE_SIGNER_MODE=staging-local\nPERM_QUOTE_SIGNER_PRIVATE_KEY=${quoteSigner.privateKey}\nSTAGING_TEST_PRIVATE_KEY=${testWallet.privateKey}\nPERM_EXECUTION_MODE=allowlisted-testnet-staging\nNEXT_PUBLIC_PERM_EXECUTION_MODE=allowlisted-testnet-staging\nNEXT_PUBLIC_PERM_EXECUTION_READY=0\nPERM_STAGING_CHAIN_ID=46630\nPERM_STAGING_WALLET_ALLOWLIST=${testWallet.address}\nPERM_STAGING_ALLOW_BURNER_SIGNER=1\nPERM_STAGING_E2E_TX_HASH=\nPERM_STAGING_E2E_CONFIRMATIONS=1\nNEXT_PUBLIC_PERM_STAGING_E2E_PASSED=0\nPERM_AGGREGATOR_HOOKS_JSON=[]\nDEPLOYMENT_OUTPUT=deployments/robinhood-testnet.staging.json\nPERM_STAGING_URL=\n`;
fs.writeFileSync(secretPath, environment, { mode: 0o600 });
fs.chmodSync(secretPath, 0o600);
fs.writeFileSync(addressPath, `${JSON.stringify({
  warning: "Testnet-only burner identities; never fund with mainnet assets or reuse for release custody.",
  chainId: 46630,
  deployer: deployer.address,
  owner: deployer.address,
  treasury: deployer.address,
  pauseGuardian: deployer.address,
  quoteSigner: quoteSigner.address,
  canonicalE2eWallet: testWallet.address,
  generatedAt,
}, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(addressPath, 0o600);

console.log(JSON.stringify({
  created: [path.relative(root, secretPath), path.relative(root, addressPath)],
  chainId: 46630,
  fundingRequired: {
    deployer: deployer.address,
    canonicalE2eWallet: testWallet.address,
  },
  quoteSigner: quoteSigner.address,
  warning: "Addresses are testnet-only. Private keys were written to .staging/keys.env and were not printed.",
}, null, 2));
