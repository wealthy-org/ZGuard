#!/usr/bin/env node
/** Cross-platform environment-variable wrapper for repository Node and Hardhat tasks. */
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "..");
const separator = process.argv.indexOf("--", 2);

if (separator < 3 || separator === process.argv.length - 1) {
  console.error("Usage: node scripts/run-with-env.cjs KEY=value [...] -- <node|hardhat> [args...]");
  process.exit(2);
}

const env = { ...process.env };

for (const assignment of process.argv.slice(2, separator)) {
  const equals = assignment.indexOf("=");
  const key = equals > 0 ? assignment.slice(0, equals) : "";

  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    console.error(`Invalid environment assignment: ${assignment}`);
    process.exit(2);
  }

  env[key] = assignment.slice(equals + 1);
}

const [command, ...args] = process.argv.slice(separator + 1);
let executable;
let commandArgs;

if (command === "node") {
  executable = process.execPath;
  commandArgs = args;
} else if (command === "hardhat") {
  executable = process.execPath;
  commandArgs = [require.resolve("hardhat/internal/cli/bootstrap.js"), ...args];
} else {
  console.error(`Unsupported wrapped command: ${command}`);
  process.exit(2);
}

const result = spawnSync(executable, commandArgs, {
  cwd: repositoryRoot,
  env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
