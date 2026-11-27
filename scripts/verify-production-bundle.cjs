#!/usr/bin/env node
/** Defense in depth: proves standalone WalletConnect glob packages are absent from shipped Next bundles. */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const buildRoot = path.join(root, ".next");
if (!fs.existsSync(path.join(buildRoot, "BUILD_ID"))) throw new Error("Run the production build before audit:bundle");
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else files.push(file);
  }
}
walk(buildRoot);

const forbiddenTrace = /(?:^|[\\/])node_modules[\\/](?:picomatch|anymatch)(?:[\\/]|$)/i;
for (const file of files.filter((name) => name.endsWith(".nft.json"))) {
  const trace = JSON.parse(fs.readFileSync(file, "utf8"));
  const match = (trace.files || []).find((name) => forbiddenTrace.test(name));
  if (match) throw new Error(`Production trace reaches WalletConnect's standalone glob package: ${path.relative(root, file)} -> ${match}`);
}

const needles = ["node_modules/picomatch", "node_modules\\picomatch", "node_modules/anymatch", "node_modules\\anymatch", "picomatch/lib/parse"];
for (const file of files.filter((name) => /\.(?:js|json|html|txt)$/.test(name))) {
  const stat = fs.statSync(file);
  if (stat.size > 20 * 1024 * 1024) continue;
  const content = fs.readFileSync(file, "utf8");
  const needle = needles.find((value) => content.includes(value));
  if (needle) throw new Error(`Production bundle contains picomatch fingerprint ${needle}: ${path.relative(root, file)}`);
}
console.log(`Production bundle containment passed across ${files.length} build files; WalletConnect's standalone picomatch/anymatch packages are absent from traces and bundles`);
