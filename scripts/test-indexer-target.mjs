import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import indexerTargetModule from "./lib/indexer-target.cjs";

const {
  OFFICIAL_INDEXER_MODE,
  ALLOWLISTED_STAGING_INDEXER_MODE,
  loadIndexerTarget,
} = indexerTargetModule;

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "perm-indexer-target-"));
const manifestPath = path.join(temporary, "manifest.json");
const officialRouter = `0x${"11".repeat(20)}`;
const stagingRouter = `0x${"22".repeat(20)}`;
fs.writeFileSync(manifestPath, JSON.stringify({
  schemaVersion: 2,
  routerVersion: 1,
  chainId: 46_630,
  network: "Robinhood Chain Testnet",
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  explorerUrl: "https://explorer.testnet.chain.robinhood.com",
  permRouter: officialRouter,
  deploymentBlock: 100,
  executionReady: false,
}));

try {
  const official = loadIndexerTarget({ environment: { PERM_MANIFEST_PATH: manifestPath } });
  assert.equal(official.mode, OFFICIAL_INDEXER_MODE);
  assert.equal(official.manifest.permRouter, officialRouter);
  assert.equal(official.manifest.deploymentBlock, 100);

  const stagingEnvironment = {
    PERM_MANIFEST_PATH: manifestPath,
    PERM_INDEXER_MODE: ALLOWLISTED_STAGING_INDEXER_MODE,
    PERM_INDEXER_CONFIRM_NON_RELEASE: "1",
    PERM_INDEXER_CHAIN_ID: "46630",
    PERM_INDEXER_ROUTER_VERSION: "2",
    PERM_INDEXER_ROUTER_ADDRESS: stagingRouter,
    PERM_INDEXER_DEPLOYMENT_BLOCK: "155432663",
  };
  const staging = loadIndexerTarget({ environment: stagingEnvironment });
  assert.equal(staging.mode, ALLOWLISTED_STAGING_INDEXER_MODE);
  assert.equal(staging.manifest.chainId, 46_630);
  assert.equal(staging.manifest.routerVersion, 2);
  assert.equal(staging.manifest.permRouter.toLowerCase(), stagingRouter.toLowerCase());
  assert.equal(staging.manifest.deploymentBlock, 155_432_663);
  assert.equal(staging.manifest.releaseStatus, "non-release-allowlisted-staging");
  assert.equal(staging.manifest.nonRelease, true);
  assert.equal(staging.manifest.executionReady, false);

  const rejected = [
    [{ ...stagingEnvironment, PERM_INDEXER_CONFIRM_NON_RELEASE: "0" }, /confirm_non_release/i],
    [{ ...stagingEnvironment, PERM_INDEXER_CHAIN_ID: "1" }, /46630/],
    [{ ...stagingEnvironment, PERM_INDEXER_ROUTER_VERSION: "1" }, /Router v2/],
    [{ ...stagingEnvironment, PERM_INDEXER_ROUTER_ADDRESS: "0x1234" }, /valid address/],
    [{ ...stagingEnvironment, PERM_INDEXER_DEPLOYMENT_BLOCK: "0" }, /between 1/],
    [{ ...stagingEnvironment, PERM_INDEXER_MODE: "staging" }, /must be official or/],
  ];
  for (const [environment, pattern] of rejected) {
    assert.throws(() => loadIndexerTarget({ environment }), pattern);
  }

  console.log("Indexer target: official defaults and explicit chain-46630 non-release Router-v2 staging overrides fail closed");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
