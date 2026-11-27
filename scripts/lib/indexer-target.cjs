const fs = require("node:fs");
const path = require("node:path");
const { getAddress, isAddress } = require("viem");

const OFFICIAL_INDEXER_MODE = "official";
const ALLOWLISTED_STAGING_INDEXER_MODE = "allowlisted-testnet-staging";

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function unsignedInteger(name, value, minimum, maximum) {
  required(typeof value === "string" && /^\d+$/.test(value), `${name} must be an integer`);
  const parsed = Number(value);
  required(Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum,
    `${name} must be between ${minimum} and ${maximum}`);
  return parsed;
}

function resolveManifestPath(root, environment) {
  return environment.PERM_MANIFEST_PATH
    ? path.resolve(process.cwd(), environment.PERM_MANIFEST_PATH)
    : path.join(root, "deployments/robinhood-testnet.json");
}

function loadIndexerTarget({ root = path.resolve(__dirname, "../.."), environment = process.env } = {}) {
  const manifestPath = resolveManifestPath(root, environment);
  required(fs.existsSync(manifestPath), `Indexer manifest not found: ${manifestPath}`);
  const base = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const mode = environment.PERM_INDEXER_MODE || OFFICIAL_INDEXER_MODE;

  if (mode === OFFICIAL_INDEXER_MODE) {
    required(base.permRouter && isAddress(base.permRouter), "Official indexer manifest router is invalid");
    required(Number.isSafeInteger(base.deploymentBlock) && base.deploymentBlock > 0,
      "Official indexer manifest deployment block is invalid");
    required(Number.isSafeInteger(base.routerVersion) && [1, 2].includes(base.routerVersion),
      "Official indexer manifest router version is invalid");
    return { mode, manifestPath, manifest: base };
  }

  required(mode === ALLOWLISTED_STAGING_INDEXER_MODE,
    `PERM_INDEXER_MODE must be ${OFFICIAL_INDEXER_MODE} or ${ALLOWLISTED_STAGING_INDEXER_MODE}`);
  required(environment.PERM_INDEXER_CONFIRM_NON_RELEASE === "1",
    "PERM_INDEXER_CONFIRM_NON_RELEASE must be 1 for allowlisted staging indexing");
  const chainId = unsignedInteger("PERM_INDEXER_CHAIN_ID", environment.PERM_INDEXER_CHAIN_ID, 1, Number.MAX_SAFE_INTEGER);
  required(chainId === 46_630, "Allowlisted staging indexer chain must be 46630");
  const routerVersion = unsignedInteger("PERM_INDEXER_ROUTER_VERSION", environment.PERM_INDEXER_ROUTER_VERSION, 1, 100);
  required(routerVersion === 2, "Allowlisted staging indexer requires Router v2");
  const deploymentBlock = unsignedInteger("PERM_INDEXER_DEPLOYMENT_BLOCK", environment.PERM_INDEXER_DEPLOYMENT_BLOCK, 1, Number.MAX_SAFE_INTEGER);
  const router = environment.PERM_INDEXER_ROUTER_ADDRESS;
  required(typeof router === "string" && isAddress(router), "PERM_INDEXER_ROUTER_ADDRESS must be a valid address");

  const manifest = {
    ...base,
    schemaVersion: 2,
    routerVersion,
    chainId,
    permRouter: getAddress(router),
    deploymentBlock,
    releaseStatus: "non-release-allowlisted-staging",
    nonRelease: true,
    executionReady: false,
  };
  return { mode, manifestPath, manifest };
}

module.exports = {
  OFFICIAL_INDEXER_MODE,
  ALLOWLISTED_STAGING_INDEXER_MODE,
  loadIndexerTarget,
};
