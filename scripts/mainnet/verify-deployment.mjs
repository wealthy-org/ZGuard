#!/usr/bin/env node
// Read-only post-deploy verification of the Perm mainnet manifest against Robinhood Chain 4663.
// No keys, no transactions. Exit code 1 if any hard check fails.
//
//   node scripts/mainnet/verify-deployment.mjs
//   MANIFEST=deployments/robinhood-mainnet.json \
//   RH_MAINNET_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
//   SIGNER_HEALTH_URL=https://perm-quote-signer.example.com/health   # optional: the remote signer's /health (or /api/health on Vercel)
//   PERM_APP_URL=https://www.useperm.xyz                              # optional: the hosted app (checks /api/health)
//   RECORDING_WALLET=0x…                                              # optional: confirms the wallet is ready (balance, EOA)
//   node scripts/mainnet/verify-deployment.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, formatEther, getAddress, http, keccak256, parseAbi, zeroAddress } from "viem";
import { MAINNET } from "./mainnet-addresses.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.resolve(root, process.env.MANIFEST || "deployments/robinhood-mainnet.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const rpcUrl = process.env.RH_MAINNET_RPC_URL || manifest.rpcUrl || MAINNET.rpcUrl;
const explorer = manifest.explorerUrl || MAINNET.explorerUrl;

let failures = 0;
let warnings = 0;
const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => { failures += 1; console.log(`  ✗ ${msg}`); };
const warn = (msg) => { warnings += 1; console.log(`  ⚠ ${msg}`); };
const check = (condition, ok, bad) => (condition ? pass(ok) : fail(bad));
const same = (a, b) => Boolean(a && b) && getAddress(a) === getAddress(b);

const routerAbi = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function treasury() view returns (address)",
  "function quoteSigner() view returns (address)",
  "function pauseGuardian() view returns (address)",
  "function paused() view returns (bool)",
  "function permit2() view returns (address)",
  "function activePolicyVersion() view returns (uint32)",
  "function feePolicies(uint32) view returns (uint16 platformFeeBps, uint16 rebateShareBps, bool enabled, bool exists)",
  "function adapters(address) view returns (bool enabled, bytes32 providerId)",
  "function adapterCodehashes(address) view returns (bytes32)",
  "function referralShares(address) view returns (uint16)",
  "function hookProviderIds(address) view returns (bytes32)",
]);
const v4Abi = parseAbi(["function poolManager() view returns (address)", "function permRouter() view returns (address)", "function owner() view returns (address)"]);
const v4HookAbi = parseAbi(["function verifiedHookCodehashes(address) view returns (bytes32)"]);
const v2Abi = parseAbi(["function factory() view returns (address)", "function weth() view returns (address)", "function permRouter() view returns (address)", "function pairCodehash() view returns (bytes32)", "function owner() view returns (address)"]);
const wethAdapterAbi = parseAbi(["function weth() view returns (address)", "function permRouter() view returns (address)"]);
const hookAbi = parseAbi(["function poolManager() view returns (address)", "function aggregatorHookVersion() view returns (string)"]);
const AGGREGATOR_HOOK_PROVIDER = keccak256(new TextEncoder().encode("UNISWAP_V4_AGGREGATOR_HOOK"));
const v3Abi = parseAbi(["function swapRouter() view returns (address)", "function weth() view returns (address)", "function permRouter() view returns (address)", "function owner() view returns (address)"]);

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  const text = await response.text();
  try { return { status: response.status, body: JSON.parse(text) }; } catch { return { status: response.status, body: null }; }
}

async function main() {
  console.log(`Perm mainnet deployment check · ${path.relative(root, manifestPath)} · ${rpcUrl}\n`);
  if (manifest.chainId !== 4663) throw new Error(`manifest chainId ${manifest.chainId}, expected 4663`);
  if (!manifest.permRouter || !manifest.v4Adapter || !manifest.v3Adapter) {
    throw new Error("manifest has no deployed addresses yet (placeholder). Run contracts:deploy:mainnet first (runbook §2).");
  }
  if (manifest.nonRelease || /rehearsal|fork/i.test(String(manifest.environment || ""))) {
    warn(`manifest is marked ${manifest.environment || "nonRelease"} — this is not the real mainnet manifest`);
  }
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 3, timeout: 20_000 }) });
  check((await client.getChainId()) === 4663, "RPC is Robinhood Chain 4663", "RPC is not chain 4663");
  const read = (address, abi, functionName, args = []) => client.readContract({ address, abi, functionName, args });

  console.log("\n1 · Contracts (code + runtime codehash)");
  const deployedKeys = ["permRouter", "v4Adapter", "v3Adapter", ...["v2Adapter", "wethAdapter"].filter((key) => manifest[key])];
  for (const key of deployedKeys) {
    const address = manifest[key];
    const code = await client.getCode({ address });
    if (!code || code === "0x") { fail(`${key} ${address} has no bytecode`); continue; }
    const recorded = manifest.contracts?.[key]?.runtimeCodehash;
    if (recorded) check(keccak256(code) === recorded, `${key} ${address} codehash matches manifest`, `${key} codehash ${keccak256(code)} ≠ manifest ${recorded}`);
    else warn(`${key} ${address} has code but the manifest records no runtimeCodehash`);
  }

  console.log("\n2 · Dependencies (Uniswap v4/v3, Permit2, WETH)");
  for (const [key, address] of Object.entries(manifest.dependencies || {})) {
    if (!address) continue;
    const code = await client.getCode({ address });
    const recorded = manifest.dependencyCodehashes?.[key];
    if (!code || code === "0x") fail(`${key} ${address} has no bytecode`);
    else if (recorded) check(keccak256(code) === recorded, `${key} codehash pinned`, `${key} codehash changed (${keccak256(code)})`);
    else pass(`${key} ${address} has code`);
  }
  check(same(manifest.poolManager, MAINNET.uniswapV4.poolManager), "manifest PoolManager = Uniswap v4 4663 PoolManager", `manifest PoolManager ${manifest.poolManager} ≠ ${MAINNET.uniswapV4.poolManager}`);
  check(same(manifest.permit2, MAINNET.permit2), "manifest Permit2 = canonical Permit2", "manifest Permit2 is not canonical");
  check(same(manifest.weth, MAINNET.weth), "manifest WETH = 4663 WETH", "manifest WETH mismatch");

  console.log("\n3 · PermRouter roles + fee policy");
  const router = manifest.permRouter;
  const [owner, pendingOwner, treasury, quoteSigner, pauseGuardian, paused, permit2, version] = await Promise.all([
    read(router, routerAbi, "owner"), read(router, routerAbi, "pendingOwner"), read(router, routerAbi, "treasury"),
    read(router, routerAbi, "quoteSigner"), read(router, routerAbi, "pauseGuardian"), read(router, routerAbi, "paused"),
    read(router, routerAbi, "permit2"), read(router, routerAbi, "activePolicyVersion"),
  ]);
  const roles = manifest.roles || {};
  check(same(owner, roles.owner || manifest.owner), `owner ${owner}`, `owner ${owner} ≠ manifest ${roles.owner || manifest.owner}`);
  if (pendingOwner !== zeroAddress) warn(`pendingOwner ${pendingOwner} has not called acceptOwnership() yet`);
  check(same(treasury, roles.treasury || manifest.treasury), `treasury ${treasury}`, `treasury ${treasury} ≠ manifest`);
  check(same(quoteSigner, roles.quoteSigner || manifest.quoteSigner), `quoteSigner ${quoteSigner}`, `quoteSigner ${quoteSigner} ≠ manifest ${roles.quoteSigner || manifest.quoteSigner} (run ACTION=set-quote-signer or update the manifest)`);
  check(quoteSigner !== zeroAddress && !same(quoteSigner, owner), "quote signer is a dedicated key (≠ owner)", "quote signer is unset or equals the owner key");
  const signerCode = await client.getCode({ address: quoteSigner });
  check(!signerCode || signerCode === "0x", "quote signer is a plain EOA", "quote signer address has code (must be an EOA/KMS key)");
  pass(`pauseGuardian ${pauseGuardian}`);
  check(!paused, "router is not paused", "router is PAUSED");
  check(same(permit2, MAINNET.permit2), "router permit2 is canonical", `router permit2 ${permit2}`);
  const policy = await read(router, routerAbi, "feePolicies", [version]);
  check(policy[2], `fee policy v${version} enabled`, `fee policy v${version} is disabled`);
  check(Number(policy[0]) === 20 && Number(policy[1]) === 2_500,
    `fee policy v${version}: ${policy[0]} bps gross (0.20%), ${Number(policy[1]) / 100}% fee rebate — matches the recording script`,
    `fee policy v${version} is ${policy[0]} bps / ${Number(policy[1]) / 100}% — the recording guide narrates 0.20% / 25%`);

  console.log("\n4 · Adapters");
  const v4 = manifest.v4Adapter;
  const v3 = manifest.v3Adapter;
  const adapterRows = [["v4", v4, "uniswapV4Direct"], ["v3", v3, "uniswapV3"]];
  if (manifest.v2Adapter) adapterRows.push(["v2", manifest.v2Adapter, "uniswapV2"]);
  if (manifest.wethAdapter) adapterRows.push(["weth", manifest.wethAdapter, "wethWrap"]);
  for (const [label, adapter, providerKey] of adapterRows) {
    const config = await read(router, routerAbi, "adapters", [adapter]);
    check(config[0], `${label} adapter enabled on router`, `${label} adapter ${adapter} is NOT enabled (configureAdapter)`);
    const expectedProvider = manifest.providers?.[providerKey];
    if (expectedProvider) check(config[1] === expectedProvider, `${label} providerId ${providerKey}`, `${label} providerId ${config[1]} ≠ ${expectedProvider}`);
    const pinned = await read(router, routerAbi, "adapterCodehashes", [adapter]);
    const code = await client.getCode({ address: adapter });
    check(pinned === keccak256(code), `${label} adapter codehash pinned on router`, `${label} adapter codehash not pinned`);
  }
  check(same(await read(v4, v4Abi, "poolManager"), MAINNET.uniswapV4.poolManager), "PermV4Adapter → Uniswap v4 PoolManager", "PermV4Adapter points to a different PoolManager");
  check(same(await read(v4, v4Abi, "permRouter"), router), "PermV4Adapter → this PermRouter", "PermV4Adapter is bound to another router");
  check(same(await read(v3, v3Abi, "swapRouter"), MAINNET.uniswapV3.swapRouter02), "PermV3Adapter → Uniswap v3 SwapRouter02", "PermV3Adapter points to a different SwapRouter");
  check(same(await read(v3, v3Abi, "weth"), MAINNET.weth), "PermV3Adapter WETH = 4663 WETH", "PermV3Adapter WETH mismatch");
  check(same(await read(v3, v3Abi, "permRouter"), router), "PermV3Adapter → this PermRouter", "PermV3Adapter is bound to another router");

  if (manifest.v2Adapter) {
    const v2 = manifest.v2Adapter;
    check(same(await read(v2, v2Abi, "factory"), MAINNET.uniswapV2.factory), "PermV2Adapter → official Uniswap V2 factory", "PermV2Adapter points to a different factory");
    check(same(await read(v2, v2Abi, "weth"), MAINNET.weth), "PermV2Adapter WETH = 4663 WETH", "PermV2Adapter WETH mismatch");
    check(same(await read(v2, v2Abi, "permRouter"), router), "PermV2Adapter → this PermRouter", "PermV2Adapter is bound to another router");
    const pairHash = manifest.venues?.uniswapV2?.pairCodehash;
    if (pairHash) check((await read(v2, v2Abi, "pairCodehash")) === pairHash, "PermV2Adapter pair codehash pinned", "PermV2Adapter pair codehash differs from manifest");
  }
  if (manifest.wethAdapter) {
    const w = manifest.wethAdapter;
    check(same(await read(w, wethAdapterAbi, "weth"), MAINNET.weth), "PermWethAdapter WETH = 4663 WETH (1:1 wrap)", "PermWethAdapter WETH mismatch");
    check(same(await read(w, wethAdapterAbi, "permRouter"), router), "PermWethAdapter → this PermRouter", "PermWethAdapter is bound to another router");
  }

  const hooks = manifest.verifiedHooks || [];
  if (hooks.length || manifest.hookProviderStatus === "enabled-codehash-pinned") {
    console.log("\n4b · Uniswap Aggregator Hooks (codehash-pinned)");
    const providerId = await read(router, routerAbi, "hookProviderIds", [v4]);
    check(providerId === AGGREGATOR_HOOK_PROVIDER, "router hook provider = UNISWAP_V4_AGGREGATOR_HOOK", `router hook provider is ${providerId} (ACTION=set-hook-provider ENABLED=1)`);
    if (!manifest.wethAdapter) fail("hooks are enabled but the manifest has no wethAdapter (WETH-side hook pools are unreachable)");
    for (const hook of hooks) {
      const code = await client.getCode({ address: hook.address });
      const live = code && code !== "0x" ? keccak256(code) : null;
      check(live === hook.runtimeCodehash, `${hook.address} runtime codehash unchanged`, `${hook.address} runtime codehash ${live} ≠ manifest ${hook.runtimeCodehash}`);
      const pinned = await read(v4, v4HookAbi, "verifiedHookCodehashes", [hook.address]);
      check(pinned === hook.runtimeCodehash, `${hook.address} pinned on PermV4Adapter (${hook.version})`, `${hook.address} not pinned on PermV4Adapter (ACTION=set-hook HOOK=${hook.address} VERIFIED=1)`);
      check(same(await read(hook.address, hookAbi, "poolManager"), MAINNET.uniswapV4.poolManager), `${hook.address} → Uniswap v4 PoolManager`, `${hook.address} uses a foreign PoolManager`);
      const version = await read(hook.address, hookAbi, "aggregatorHookVersion").catch(() => "");
      check(version === hook.version, `${hook.address} aggregatorHookVersion() = "${version}"`, `${hook.address} version "${version}" ≠ "${hook.version}"`);
    }
    const pinnedHooks = new Set(hooks.map((hook) => getAddress(hook.address)));
    const orphan = (manifest.aggregatorHooks || []).filter((pool) => !pinnedHooks.has(getAddress(pool.hooks)));
    check(orphan.length === 0, `${(manifest.aggregatorHooks || []).length} hook pool(s), all on pinned hooks`, `${orphan.length} hook pool(s) reference an unpinned hook`);
  }

  for (const entry of manifest.referrals || []) {
    const share = Number(await read(router, routerAbi, "referralShares", [entry.referrer]));
    check(share === Number(entry.shareBpsOfNetFee ?? entry.shareBps ?? share), `referral ${entry.referrer}: ${share / 100}% of net fee`, `referral ${entry.referrer} share ${share} ≠ manifest`);
  }

  console.log("\n5 · Source verification (Blockscout)");
  for (const key of deployedKeys) {
    const url = `${explorer.replace(/\/$/, "")}/api/v2/smart-contracts/${manifest[key]}`;
    try {
      const { status, body } = await getJson(url);
      if (!body) warn(`${key}: Blockscout API not reachable from here (HTTP ${status}); open ${explorer}/address/${manifest[key]}?tab=contract`);
      else check(Boolean(body.is_verified ?? body.is_fully_verified), `${key} source verified on Blockscout`, `${key} NOT verified — run with VERIFY=1 or \`npx hardhat verify --network robinhoodMainnet ${manifest[key]} …\``);
    } catch (cause) {
      warn(`${key}: Blockscout check skipped (${cause instanceof Error ? cause.message : cause})`);
    }
  }
  if (manifest.sourceVerification && manifest.sourceVerification !== "verified") warn(`manifest.sourceVerification = "${manifest.sourceVerification}"`);

  if (process.env.SIGNER_HEALTH_URL) {
    console.log("\n6 · Remote quote signer");
    const { status, body } = await getJson(process.env.SIGNER_HEALTH_URL);
    if (status !== 200 || !body) fail(`${process.env.SIGNER_HEALTH_URL} → HTTP ${status}`);
    else {
      check(same(body.address, quoteSigner), `signer /health address ${body.address} = PermRouter.quoteSigner()`, `signer /health address ${body.address} ≠ PermRouter.quoteSigner() ${quoteSigner} → ACTION=set-quote-signer`);
      check(Number(body.chainId) === 4663, "signer pinned to chain 4663", `signer chainId ${body.chainId}`);
      check(same(body.router, router), "signer pinned to this PermRouter", `signer router ${body.router} ≠ ${router}`);
    }
  }

  if (process.env.PERM_APP_URL) {
    console.log("\n7 · Hosted app");
    const base = process.env.PERM_APP_URL.replace(/\/$/, "");
    const { status, body } = await getJson(`${base}/api/health`);
    if (!body) fail(`${base}/api/health → HTTP ${status}`);
    else {
      const c = body.checks || {};
      const s = body.stagingChecks || {};
      check(c.routerConfigured, "app has NEXT_PUBLIC_PERM_ROUTER_ADDRESS", "app router address not configured");
      check(c.quoteSignerMode === "remote", "app quote signer mode = remote", `app quote signer mode = ${c.quoteSignerMode} (mainnet requires remote)`);
      check(c.quoteSignerMatchesOnchain, "app signer = PermRouter.quoteSigner()", "app QUOTE_SIGNER_ADDRESS does not match the router");
      check(s.chainPinned && s.allowlistConfigured, `allowlisted-mainnet configured (${s.allowlistCount} wallet[s])`, "PERM_STAGING_CHAIN_ID / PERM_STAGING_WALLET_ALLOWLIST missing");
      check(s.routerCodePresent && s.v4AdapterCodePresent && s.v3AdapterCodePresent, "app sees router + adapters onchain", "app cannot see router/adapter bytecode — wrong NEXT_PUBLIC_* addresses?");
      check(body.stagingReady || body.executionReady, `app status ${body.status}`, `app status ${body.status}${body.stagingReason ? ` · ${body.stagingReason}` : ""}${body.signerReason ? ` · ${body.signerReason}` : ""}`);
    }
  }

  if (process.env.RECORDING_WALLET) {
    console.log("\n8 · Recording wallet");
    const wallet = getAddress(process.env.RECORDING_WALLET);
    const balance = await client.getBalance({ address: wallet });
    check(balance >= 3_000_000_000_000_000n, `${wallet} holds ${formatEther(balance)} ETH`, `${wallet} holds only ${formatEther(balance)} ETH (recording budget ≥ 0.003 ETH incl. gas)`);
    const code = await client.getCode({ address: wallet });
    if (code && code !== "0x") warn(`${wallet} has code (EIP-7702 delegation or contract wallet) — confirm the wallet signs EIP-712 + sends value as expected`);
  }

  console.log(`\n${failures ? "✗" : "✓"} ${failures} failed · ${warnings} warning(s) · ${explorer}/address/${router}`);
  process.exitCode = failures ? 1 : 0;
}

main().catch((cause) => { console.error(`✗ ${cause instanceof Error ? cause.message : cause}`); process.exitCode = 1; });
