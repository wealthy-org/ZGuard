#!/usr/bin/env node
/** Fail closed on every production advisory and allow one exact, time-bounded development-tool advisory. */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const prod = process.argv.includes("--prod");
const exceptionExpires = Date.parse("2027-01-15T00:00:00.000Z");
if (!prod && Date.now() >= exceptionExpires) {
  throw new Error("Development dependency-audit exception expired; re-review or remove the affected dependency path");
}

const workspace = fs.readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
const configuredIgnores = [...workspace.matchAll(/^\s*-\s+(GHSA-[a-z0-9-]+)\s*$/gmi)].map((match) => match[1]);
if (configuredIgnores.length !== 0 || /\bauditConfig\s*:/i.test(workspace)) {
  throw new Error("pnpm auditConfig must not suppress dependency advisories");
}

const args = ["--ignore-workspace", "audit", ...(prod ? ["--prod"] : []), "--json"];
const pnpmExecPath = process.env.npm_execpath;
if (!pnpmExecPath || !fs.existsSync(pnpmExecPath) || pnpmExecPath.includes('"')) {
  throw new Error("Run this audit through the pinned pnpm package script");
}
let command = pnpmExecPath;
let commandArgs = args;
if (/\.[cm]?js$/i.test(pnpmExecPath)) {
  command = process.execPath;
  commandArgs = [pnpmExecPath, ...args];
} else if (process.platform === "win32" && /\.(?:cmd|bat)$/i.test(pnpmExecPath)) {
  command = process.env.ComSpec || "cmd.exe";
  commandArgs = ["/d", "/s", "/c", [`"${pnpmExecPath}"`, ...args].join(" ")];
}
const run = spawnSync(command, commandArgs, { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
if (run.error) throw run.error;
let report;
try { report = JSON.parse(run.stdout); } catch {
  process.stderr.write(run.stderr || "");
  throw new Error("pnpm audit did not return a JSON report");
}
if (report.error || !report.metadata?.vulnerabilities) {
  throw new Error(`pnpm audit registry failure: ${report.error?.summary || report.error?.message || "missing vulnerability metadata"}`);
}
const advisories = Object.values(report.advisories || {});
const byGhsa = new Map(advisories.map((entry) => [entry.github_advisory_id, entry]));
const expected = prod ? new Set() : new Set(["GHSA-848j-6mx2-7j84"]);
if (advisories.length !== expected.size || advisories.some((entry) => !expected.has(entry.github_advisory_id))) {
  throw new Error(`Unexpected dependency advisories: ${advisories.map((entry) => `${entry.github_advisory_id}:${entry.severity}`).join(", ") || "none"}`);
}
const expectedExit = prod ? 0 : 1;
if (run.status !== expectedExit) {
  throw new Error(`pnpm audit exited ${run.status}; expected ${expectedExit} for the reviewed advisory set`);
}

if (!prod) {
  const elliptic = byGhsa.get("GHSA-848j-6mx2-7j84");
  if (!elliptic || elliptic.module_name !== "elliptic" || elliptic.severity !== "low" || elliptic.patched_versions !== null) {
    throw new Error("The exact unpatched elliptic advisory disposition changed");
  }
  if (!(elliptic.findings || []).length || elliptic.findings.some((finding) => finding.version !== "6.6.1" || finding.dev !== true
    || (finding.paths || []).some((dependencyPath) => !dependencyPath.includes("hardhat") && !dependencyPath.includes("solidity-coverage")))) {
    throw new Error("elliptic is no longer confined to the Hardhat/coverage development toolchain");
  }
}

console.log(JSON.stringify({
  status: prod ? "clean" : "exception-qualified",
  scope: prod ? "production" : "full",
  advisories: [...expected],
  ...(prod ? {} : { exceptionExpires: new Date(exceptionExpires).toISOString() }),
  note: prod
    ? "No production dependency advisories were reported."
    : "The only advisory is low severity, development-only, and has no patched upstream release; every other advisory remains blocking.",
}, null, 2));
