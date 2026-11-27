#!/usr/bin/env node
/** Cross-platform Solidity coverage runner that always restores production artifacts. */
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "../..");
const hardhatCli = require.resolve("hardhat/internal/cli/bootstrap.js");
const exportScript = path.join(repositoryRoot, "contracts/scripts/export-artifacts.cjs");
const mode = process.argv[2];

if (mode !== "default" && mode !== "test-hook") {
  console.error("Usage: node contracts/scripts/run-coverage.cjs <default|test-hook>");
  process.exit(2);
}

function runNode(args, env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status ?? 1;
}

function runHardhat(args, env = process.env) {
  return runNode([hardhatCli, ...args], env);
}

let coverageStatus = 0;
let restoreStatus = 0;

if (mode === "test-hook") {
  restoreStatus = runHardhat(["clean"]);
  if (restoreStatus === 0) {
    coverageStatus = runHardhat([
      "coverage",
      "--solcoverjs",
      "contracts/test-support/test-hook.solcover.cjs",
      "--sources",
      "test/PermTestAggregatorHook.sol",
      "--testfiles",
      "contracts/test-support/PermTestAggregatorHookCoverage.test.js",
    ], { ...process.env, RUN_FORK_TESTS: "1" });
  }
} else {
  coverageStatus = runHardhat(["coverage"]);
}

const cleanStatus = runHardhat(["clean"]);
if (cleanStatus !== 0 && restoreStatus === 0) restoreStatus = cleanStatus;

const compileStatus = runHardhat(["compile"]);
if (compileStatus !== 0 && restoreStatus === 0) restoreStatus = compileStatus;

if (restoreStatus === 0) {
  const exportStatus = runNode([exportScript]);
  if (exportStatus !== 0) restoreStatus = exportStatus;
}

process.exitCode = coverageStatus !== 0 ? coverageStatus : restoreStatus;
