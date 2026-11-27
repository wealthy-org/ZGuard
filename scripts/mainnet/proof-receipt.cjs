#!/usr/bin/env node
// Read-only mainnet proof reader for Perm on Robinhood Chain (4663). No wallet, no key, no writes.
//
//   node scripts/mainnet/proof-receipt.cjs <txHash> [<txHash> …]
//   node scripts/mainnet/proof-receipt.cjs "Klip 05 · v4 swap=0xabc…" "Klip 06 · multi-hop=0xdef…"
//   node scripts/mainnet/proof-receipt.cjs --md deployments/mainnet/PROOF_MAINNET.md "Label=0x…" …
//
// For every transaction it reads the receipt straight from the chain, decodes the PermRouter events
// (SwapSettled, RouteStepSettled, FeeAccrued, FeeClaimed) plus ERC-20 approvals, recomputes the fee
// split from the on-chain fee policy and prints the Blockscout link. With --md it also writes a
// Markdown proof sheet (contracts, roles, fee policy, deploy transactions and every labelled tx).
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const root = path.resolve(__dirname, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "deployments/robinhood-mainnet.json"), "utf8"));
const routerAbi = JSON.parse(fs.readFileSync(path.join(root, "lib/web3/artifacts/PermRouter.json"), "utf8")).abi;
const rpcUrl = process.env.RH_MAINNET_RPC_URL || manifest.rpcUrl;
const explorer = manifest.explorerUrl.replace(/\/$/, "");
const provider = new ethers.JsonRpcProvider(rpcUrl, 4663, { staticNetwork: true });
const router = ethers.getAddress(manifest.permRouter);
const routerIface = new ethers.Interface(routerAbi);
const erc20Iface = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);
const ZERO = ethers.ZeroAddress;
const PERMIT2 = ethers.getAddress(manifest.permit2);

const known = new Map([
  [router, "PermRouter"],
  [ethers.getAddress(manifest.v4Adapter), "PermV4Adapter (Uniswap v4 direct)"],
  [ethers.getAddress(manifest.v3Adapter), "PermV3Adapter (Uniswap v3)"],
  [PERMIT2, "Permit2"],
  [ethers.getAddress(manifest.owner), "owner"],
  [ethers.getAddress(manifest.treasury), "treasury"],
  [ethers.getAddress(manifest.quoteSigner), "quote signer"],
]);
known.set(ethers.getAddress(manifest.venues.uniswapV3.swapRouter02), "Uniswap v3 SwapRouter02");
known.set(ethers.getAddress(manifest.weth), "WETH");
const internal = new Set([router, ethers.getAddress(manifest.v4Adapter), ethers.getAddress(manifest.v3Adapter)]);
for (const referral of manifest.referrals || []) known.set(ethers.getAddress(referral.referrer), "referrer");
const providerLabels = Object.fromEntries(Object.entries(manifest.providers || {}).map(([label, id]) => [id.toLowerCase(), label]));

const tokenCache = new Map([[ZERO, { symbol: "ETH", decimals: 18 }]]);
async function token(address) {
  const key = ethers.getAddress(address);
  if (!tokenCache.has(key)) {
    const contract = new ethers.Contract(key, ["function symbol() view returns (string)", "function decimals() view returns (uint8)"], provider);
    const [symbol, decimals] = await Promise.all([contract.symbol().catch(() => key.slice(0, 10)), contract.decimals().catch(() => 18n)]);
    tokenCache.set(key, { symbol, decimals: Number(decimals) });
  }
  return tokenCache.get(key);
}
async function amount(value, address) {
  const meta = await token(address);
  return `${ethers.formatUnits(value, meta.decimals)} ${meta.symbol}`;
}
const name = (address) => {
  const key = ethers.getAddress(address);
  return known.has(key) ? `${known.get(key)} ${key}` : key;
};
const short = (value) => `${value.slice(0, 10)}…${value.slice(-8)}`;

function parseArgs(argv) {
  const out = { md: undefined, items: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--md") { out.md = argv[index + 1]; index += 1; continue; }
    const match = arg.match(/^(.*)=(0x[0-9a-fA-F]{64})$/);
    if (match) out.items.push({ label: match[1].trim(), hash: match[2] });
    else if (/^0x[0-9a-fA-F]{64}$/.test(arg)) out.items.push({ label: "", hash: arg });
    else throw new Error(`Not a transaction hash: ${arg}`);
  }
  if (!out.items.length) throw new Error("Usage: node scripts/mainnet/proof-receipt.cjs [--md out.md] [\"Label=\"]0x<txHash> …");
  return out;
}

async function readTx(item, policy) {
  const [tx, receipt] = await Promise.all([provider.getTransaction(item.hash), provider.getTransactionReceipt(item.hash)]);
  if (!tx || !receipt) throw new Error(`${item.hash} not found on chain 4663`);
  const block = await provider.getBlock(receipt.blockNumber);
  const lines = [];
  const checks = [];
  let summary = "";
  const swaps = [];
  const steps = [];
  for (const log of receipt.logs) {
    const emitter = ethers.getAddress(log.address);
    if (emitter === router) {
      let parsed;
      try { parsed = routerIface.parseLog(log); } catch { continue; }
      if (!parsed) continue;
      const a = parsed.args;
      if (parsed.name === "SwapSettled") {
        swaps.push(a);
        lines.push(`SwapSettled · account ${name(a.account)} · ${await amount(a.amountIn, a.tokenIn)} → ${await amount(a.amountOut, a.tokenOut)}`);
        lines.push(`  fee: gross ${await amount(a.grossFee, a.tokenIn)} · fee rebate ${await amount(a.rebate, a.tokenIn)} · net ${await amount(a.netFee, a.tokenIn)} · referral ${await amount(a.referralFee, a.tokenIn)} · treasury ${await amount(a.treasuryFee, a.tokenIn)} · policy v${a.policyVersion}`);
        const expectedGross = (a.amountIn * BigInt(policy.platformFeeBps)) / 10_000n;
        const expectedRebate = (expectedGross * BigInt(policy.rebateShareBps)) / 10_000n;
        checks.push([a.grossFee === expectedGross, `gross fee = floor(amountIn × ${policy.platformFeeBps} / 10000)`]);
        checks.push([a.rebate === expectedRebate, `fee rebate = floor(gross × ${policy.rebateShareBps} / 10000)`]);
        checks.push([a.netFee === a.grossFee - a.rebate && a.referralFee + a.treasuryFee === a.netFee, "net = gross − rebate = referral + treasury"]);
        checks.push([a.routedInput === a.amountIn - a.netFee, "routed input = amountIn − net fee"]);
      } else if (parsed.name === "RouteStepSettled") {
        steps.push(a);
        const venue = providerLabels[a.providerId.toLowerCase()] || a.providerId;
        lines.push(`RouteStepSettled #${a.stepIndex} · ${venue} · adapter ${name(a.adapter)} · ${await amount(a.amountIn, a.tokenIn)} → ${await amount(a.amountOut, a.tokenOut)} · hook ${a.hook === ZERO ? "none" : a.hook}`);
      } else if (parsed.name === "FeeAccrued") {
        lines.push(`FeeAccrued · ${await amount(a.amount, a.token)} reserved for ${name(a.beneficiary)}`);
      } else if (parsed.name === "FeeClaimed") {
        lines.push(`FeeClaimed · ${await amount(a.amount, a.token)} · beneficiary ${name(a.beneficiary)} → recipient ${name(a.recipient)}`);
        summary ||= `fee claim ${await amount(a.amount, a.token)} by ${known.get(ethers.getAddress(a.beneficiary)) || a.beneficiary}`;
      } else {
        lines.push(`${parsed.name}`);
      }
    } else if (log.topics[0] === erc20Iface.getEvent("Approval").topicHash && log.topics.length === 3) {
      const parsed = erc20Iface.parseLog(log);
      // Internal router/adapter allowances are exact and reset in the same tx; only wallet approvals matter here.
      if (internal.has(ethers.getAddress(parsed.args.owner))) continue;
      lines.push(`Approval · ${(await token(emitter)).symbol} · owner ${name(parsed.args.owner)} → spender ${name(parsed.args.spender)} · ${await amount(parsed.args.value, emitter)}`);
      summary ||= `one-time exact approval of ${await amount(parsed.args.value, emitter)} to ${known.get(ethers.getAddress(parsed.args.spender)) || parsed.args.spender}`;
    }
  }
  if (swaps.length) {
    const a = swaps[0];
    const route = steps.map((step) => providerLabels[step.providerId.toLowerCase()] || "?").join(" → ");
    summary = `${await amount(a.amountIn, a.tokenIn)} → ${await amount(a.amountOut, a.tokenOut)} · ${steps.length} step(s): ${route}${a.referralFee > 0n ? " · referral" : ""}`;
    checks.push([steps.length > 0 && steps.every((step) => step.hook === ZERO), "no hook in any route step"]);
  }
  if (tx.to && ethers.getAddress(tx.to) === router) {
    try {
      const call = routerIface.parseTransaction({ data: tx.data, value: tx.value });
      if (call && call.name === "swapExactInput") {
        const permit = call.args[call.args.length - 1];
        const usedPermit2 = permit && permit.signature && permit.signature !== "0x";
        lines.push(`call swapExactInput · token authorization: ${usedPermit2 ? "Permit2 signature (offchain, one trade)" : swaps[0] && swaps[0].tokenIn === ZERO ? "native ETH (no approval)" : "exact ERC-20 allowance"}`);
        if (usedPermit2) summary += " · Permit2";
        if (call.args[0].referrer && call.args[0].referrer !== ZERO) lines.push(`  referrer signed into the quote: ${name(call.args[0].referrer)}`);
      } else if (call) {
        lines.push(`call ${call.name}`);
      }
    } catch {
      // not a router call we can decode
    }
  }
  const fee = receipt.gasUsed * (receipt.gasPrice || tx.gasPrice || 0n);
  return {
    ...item,
    status: receipt.status === 1 ? "Success" : "Failed",
    block: receipt.blockNumber,
    time: new Date(Number(block.timestamp) * 1000).toISOString().replace(".000Z", "Z"),
    from: tx.from,
    to: tx.to,
    gasUsed: receipt.gasUsed.toString(),
    networkFee: ethers.formatEther(fee),
    lines,
    checks,
    summary,
    url: `${explorer}/tx/${item.hash}`,
  };
}

function markdown(results, policy) {
  const c = manifest.contracts || {};
  const addr = (address) => `[\`${address}\`](${explorer}/address/${address})`;
  const txLink = (hash) => `[\`${short(hash)}\`](${explorer}/tx/${hash})`;
  const out = [];
  out.push("# Perm · Mainnet proof (Robinhood Chain 4663)");
  out.push("");
  out.push(`Generated ${new Date().toISOString().replace(/\.\d+Z$/, "Z")} by \`node scripts/mainnet/proof-receipt.cjs\` (read-only, straight from the chain via ${rpcUrl}).`);
  out.push(`Explorer: ${explorer} · deployment commit \`${(manifest.deploymentCommitSha || "").slice(0, 7)}\` · deployment block ${manifest.deploymentBlock}.`);
  out.push("");
  out.push("Mode: allowlisted mainnet showcase (non-release). Stock tokens are Robinhood Chain tokens, not shares. All amounts are real; demo trades use small amounts.");
  out.push("");
  out.push("## Contracts (source verified on Blockscout + Sourcify, exact match)");
  out.push("");
  out.push("| Contract | Address | Runtime codehash |");
  out.push("|---|---|---|");
  for (const [key, label] of [["permRouter", "PermRouter v2"], ["v4Adapter", "PermV4Adapter (Uniswap v4 direct, no hook)"], ["v3Adapter", "PermV3Adapter (Uniswap v3 SwapRouter02)"]]) {
    if (manifest[key]) out.push(`| ${label} | ${addr(manifest[key])} | \`${c[key] ? c[key].runtimeCodehash : ""}\` |`);
  }
  out.push("");
  out.push("## Roles and fee policy");
  out.push("");
  out.push("| Role | Address |");
  out.push("|---|---|");
  out.push(`| Owner / pause guardian | ${addr(manifest.owner)} |`);
  out.push(`| Treasury | ${addr(manifest.treasury)} |`);
  out.push(`| Quote signer (EIP-712, remote, holds no funds) | ${addr(manifest.quoteSigner)} |`);
  for (const referral of manifest.referrals || []) out.push(`| Referrer (${referral.shareBpsOfNetFee / 100}% of net fee) | ${addr(referral.referrer)} |`);
  out.push("");
  out.push(`Fee policy v${policy.version}: **${policy.platformFeeBps} bps gross (0.20%)**, **${policy.rebateShareBps / 100}% fee rebate**, net ${policy.platformFeeBps - (policy.platformFeeBps * policy.rebateShareBps) / 10_000} bps. Read on-chain from \`PermRouter.feePolicies(${policy.version})\`; published in the router deploy tx ${manifest.feePolicy && manifest.feePolicy.publishedInTx ? txLink(manifest.feePolicy.publishedInTx) : ""}.`);
  out.push("");
  out.push("Dependencies: Uniswap v4 PoolManager " + addr(manifest.poolManager) + " · Uniswap v3 SwapRouter02 " + addr(manifest.venues.uniswapV3.swapRouter02) + " · Permit2 " + addr(manifest.permit2) + " · WETH " + addr(manifest.weth) + ".");
  out.push("");
  out.push("## Deployment transactions");
  out.push("");
  out.push("| Step | Tx | Gas used |");
  out.push("|---|---|---|");
  for (const tx of manifest.deploymentTransactions || []) out.push(`| ${tx.label} | ${txLink(tx.hash)} | ${tx.gasUsed} |`);
  out.push("");
  out.push("## Feature proofs");
  out.push("");
  out.push("| Feature | Tx | Block · time (UTC) | Result | Status |");
  out.push("|---|---|---|---|---|");
  for (const r of results) out.push(`| ${r.label || "—"} | ${txLink(r.hash)} | ${r.block} · ${r.time} | ${r.summary} | ${r.status} |`);
  out.push("");
  out.push("## Decoded receipts");
  for (const r of results) {
    out.push("");
    out.push(`### ${r.label || short(r.hash)}`);
    out.push("");
    out.push(`- Tx: ${r.url}`);
    out.push(`- Status **${r.status}** · block ${r.block} · ${r.time} · from ${r.from} · to ${r.to} · gas ${r.gasUsed} · network fee ${r.networkFee} ETH`);
    out.push("");
    out.push("```");
    for (const line of r.lines) out.push(line);
    out.push("```");
    if (r.checks.length) {
      out.push("");
      for (const [ok, text] of r.checks) out.push(`- ${ok ? "✅" : "❌"} ${text}`);
    }
  }
  out.push("");
  out.push("## Reproduce");
  out.push("");
  out.push("```bash");
  out.push(`node scripts/mainnet/proof-receipt.cjs ${results.map((r) => r.hash).join(" ")}`);
  out.push(`cast receipt <tx> --rpc-url ${rpcUrl}   # optional, Foundry`);
  out.push("```");
  out.push("");
  return out.join("\n");
}

async function main() {
  const { md, items } = parseArgs(process.argv.slice(2));
  const network = await provider.getNetwork();
  if (network.chainId !== 4663n) throw new Error(`RPC is chain ${network.chainId}, expected 4663`);
  const policyRaw = await new ethers.Contract(router, routerAbi, provider).feePolicies(manifest.policy.version);
  const policy = { version: manifest.policy.version, platformFeeBps: Number(policyRaw[0]), rebateShareBps: Number(policyRaw[1]) };
  console.log(`Perm mainnet proof · chain 4663 · PermRouter ${router}`);
  console.log(`fee policy v${policy.version} on-chain: ${policy.platformFeeBps} bps gross · ${policy.rebateShareBps / 100}% fee rebate\n`);
  const results = [];
  for (const item of items) {
    const r = await readTx(item, policy);
    results.push(r);
    console.log(`${r.label ? `[${r.label}] ` : ""}${r.hash}`);
    console.log(`  status ${r.status} · block ${r.block} · ${r.time} · gas ${r.gasUsed}`);
    for (const line of r.lines) console.log(`  ${line}`);
    for (const [ok, text] of r.checks) console.log(`  ${ok ? "✓" : "✗"} ${text}`);
    console.log(`  ${r.url}\n`);
  }
  if (md) {
    fs.writeFileSync(path.resolve(root, md), markdown(results, policy));
    console.log(`Markdown proof written to ${md}`);
  }
  if (results.some((r) => r.status !== "Success" || r.checks.some(([ok]) => !ok))) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
