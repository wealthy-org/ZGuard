#!/usr/bin/env node
/** Periodic deployment/configuration monitor. Exits non-zero and optionally posts
 * PERM_ALERT_WEBHOOK_URL when official manifest state is unavailable or changed. */
const fs = require("node:fs");
const path = require("node:path");
const { createPublicClient, defineChain, getAddress, http, id, keccak256, parseAbi } = require("viem");

const root = path.resolve(__dirname, "..");
const manifestPath = process.env.PERM_MANIFEST_PATH
  ? path.resolve(process.cwd(), process.env.PERM_MANIFEST_PATH)
  : path.join(root, "deployments/robinhood-testnet.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const strictOperations = process.env.PERM_STRICT_OPERATIONS === "1" || manifest.executionReady === true;

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

const rpcUrl = process.env.RH_TESTNET_RPC_URL || manifest.rpcUrl;
const maxLagSeconds = boundedInteger("MONITOR_MAX_BLOCK_LAG_SECONDS", 900, 1, 86_400);
const chain = defineChain({ id: manifest.chainId, name: manifest.network, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) });

const routerAbi = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function treasury() view returns (address)",
  "function paused() view returns (bool)",
  "function activePolicyVersion() view returns (uint32)",
  "function feePolicies(uint32) view returns (uint16 platformFeeBps,uint16 rebateShareBps,bool enabled,bool exists)",
  "function adapters(address) view returns (bool enabled,bytes32 providerId)",
  "function adapterCodehashes(address) view returns (bytes32 codehash)",
  "function hookProviderIds(address) view returns (bytes32 providerId)",
  "function quoteSigner() view returns (address)",
  "function pauseGuardian() view returns (address)",
  "function permit2() view returns (address)",
]);
const v4Abi = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function permRouter() view returns (address)",
  "function poolManager() view returns (address)",
  "function verifiedHookCodehashes(address) view returns (bytes32)",
]);
const v3Abi = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function permRouter() view returns (address)",
  "function swapRouter() view returns (address)",
  "function weth() view returns (address)",
]);
const timelockAbi = parseAbi(["function getMinDelay() view returns (uint256)"]);
const failures = [];
const warnings = [];
const checks = {};
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const failUnless = (condition, message) => { if (!condition) failures.push(message); };

async function read(address, abi, functionName, args = []) {
  return client.readContract({ address: getAddress(address), abi, functionName, args });
}

async function requireCode(label, address) {
  if (!address) return;
  const code = await client.getCode({ address: getAddress(address) });
  const present = Boolean(code && code !== "0x");
  const actualCodehash = present ? keccak256(code) : null;
  const expectedCodehash = manifest.runtimeCodehashes?.[label] || manifest.dependencyCodehashes?.[label] || null;
  checks[`${label}Code`] = { present, actualCodehash, expectedCodehash };
  failUnless(present, `${label} has no runtime bytecode at ${address}`);
  if (expectedCodehash) failUnless(same(actualCodehash, expectedCodehash), `${label} runtime codehash changed: expected ${expectedCodehash}, got ${actualCodehash}`);
}

async function sendAlert(report) {
  const url = process.env.PERM_ALERT_WEBHOOK_URL;
  if (!url || report.status === "ok" || (report.status === "warning" && process.env.MONITOR_ALERT_WARNINGS !== "1")) return;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `Perm ${manifest.network} monitor: ${report.status.toUpperCase()} (${report.failures.length} failures, ${report.warnings.length} warnings)`,
      report,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Alert webhook returned HTTP ${response.status}`);
}

async function main() {
  const chainId = await client.getChainId();
  checks.chainId = chainId;
  failUnless(chainId === manifest.chainId, `RPC chain ${chainId} does not match manifest ${manifest.chainId}`);
  const block = await client.getBlock();
  const lagSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(block.timestamp));
  checks.latestBlock = block.number.toString();
  checks.blockLagSeconds = lagSeconds;
  failUnless(lagSeconds <= maxLagSeconds, `Latest block is ${lagSeconds}s old (limit ${maxLagSeconds}s)`);

  const fallbackRpcUrl = process.env.RH_TESTNET_FALLBACK_RPC_URL;
  if (fallbackRpcUrl) {
    const fallbackClient = createPublicClient({ chain, transport: http(fallbackRpcUrl, { timeout: 20_000, retryCount: 1 }) });
    const [fallbackChainId, fallbackBlock] = await Promise.all([fallbackClient.getChainId(), fallbackClient.getBlock()]);
    const fallbackLagSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(fallbackBlock.timestamp));
    checks.fallbackRpc = { chainId: fallbackChainId, latestBlock: fallbackBlock.number.toString(), blockLagSeconds: fallbackLagSeconds };
    failUnless(fallbackChainId === manifest.chainId, `Fallback RPC chain ${fallbackChainId} does not match manifest ${manifest.chainId}`);
    failUnless(fallbackLagSeconds <= maxLagSeconds, `Fallback RPC latest block is ${fallbackLagSeconds}s old (limit ${maxLagSeconds}s)`);
  } else if (strictOperations) {
    failures.push("Fallback RPC is required for an execution-ready release");
  } else {
    warnings.push("Fallback RPC is not configured");
  }

  const databaseUrl = process.env.DATABASE_URL || process.env.PERM_INDEXER_DATABASE_URL;
  if (databaseUrl) {
    const postgres = require("postgres");
    const db = postgres(databaseUrl, { max: 1, connect_timeout: 10, idle_timeout: 5, ssl: process.env.PGSSLMODE === "disable" ? false : "require" });
    try {
      const rows = await db`SELECT key,value,updated_at FROM perm_indexer_state WHERE chain_id=${manifest.chainId} AND router=${manifest.permRouter.toLowerCase()} AND key IN ('lastIndexedBlock','lastIndexedBlockHash')`;
      const states = new Map(rows.map((row) => [row.key, row]));
      const cursor = states.get("lastIndexedBlock");
      const cursorHash = states.get("lastIndexedBlockHash")?.value;
      if (!cursor) failures.push("Indexer has no cursor for the official router");
      else {
        const indexedBlock = BigInt(cursor.value);
        const indexedLag = block.number > indexedBlock ? block.number - indexedBlock : 0n;
        const updatedLagSeconds = Math.max(0, Math.floor((Date.now() - new Date(cursor.updated_at).getTime()) / 1000));
        const canonical = await client.getBlock({ blockNumber: indexedBlock });
        checks.indexer = { lastIndexedBlock: indexedBlock.toString(), lastIndexedBlockHash: cursorHash || null, blockLag: indexedLag.toString(), updatedLagSeconds };
        const maxIndexerBlockLag = BigInt(boundedInteger("MONITOR_MAX_INDEXER_BLOCK_LAG", 300, 0, 1_000_000));
        const maxIndexerTimeLag = boundedInteger("MONITOR_MAX_INDEXER_TIME_LAG_SECONDS", 900, 1, 86_400);
        failUnless(Boolean(cursorHash), "Indexer has no canonical block-hash checkpoint");
        failUnless(Boolean(cursorHash) && same(cursorHash, canonical.hash), `Indexer cursor hash is not canonical at block ${indexedBlock}`);
        failUnless(indexedLag <= maxIndexerBlockLag, `Indexer is ${indexedLag} blocks behind (limit ${maxIndexerBlockLag})`);
        failUnless(updatedLagSeconds <= maxIndexerTimeLag, `Indexer cursor was last updated ${updatedLagSeconds}s ago (limit ${maxIndexerTimeLag}s)`);
      }
    } finally {
      await db.end({ timeout: 2 });
    }
  } else if (strictOperations) {
    failures.push("Durable indexer monitoring is required for an execution-ready release");
  } else {
    warnings.push("Durable indexer monitoring is disabled because DATABASE_URL is not configured");
  }

  if (!process.env.PERM_ALERT_WEBHOOK_URL) {
    if (strictOperations) failures.push("Alert webhook is required for an execution-ready release");
    else warnings.push("Alert webhook is not configured");
  }

  const addresses = {
    permRouter: manifest.permRouter, v4Adapter: manifest.v4Adapter, v3Adapter: manifest.v3Adapter,
    poolManager: manifest.poolManager, v4Quoter: manifest.v4Quoter, permit2: manifest.permit2,
    synthraFactory: manifest.venues?.synthraV3?.factory,
    synthraSwapRouter: manifest.venues?.synthraV3?.swapRouter02,
    synthraQuoter: manifest.venues?.synthraV3?.quoterV2,
    synthraQuoterShim: manifest.venues?.synthraV3?.quoterShim,
    synthraWeth: manifest.venues?.synthraV3?.weth,
    timelock: manifest.timelock,
  };
  await Promise.all(Object.entries(addresses).map(([label, address]) => requireCode(label, address)));

  const [owner, treasury, paused] = await Promise.all([
    read(manifest.permRouter, routerAbi, "owner"), read(manifest.permRouter, routerAbi, "treasury"),
    read(manifest.permRouter, routerAbi, "paused"),
  ]);
  const policyVersion = manifest.routerVersion >= 2
    ? await read(manifest.permRouter, routerAbi, "activePolicyVersion")
    : BigInt(manifest.policy.version);
  const expectedCurrentOwner = manifest.ownershipStatus === "pending-acceptance" && manifest.currentOwner
    ? manifest.currentOwner
    : manifest.owner;
  checks.owner = owner;
  checks.targetOwner = manifest.owner;
  checks.treasury = treasury;
  checks.paused = paused;
  checks.activePolicyVersion = Number(policyVersion);
  failUnless(same(owner, expectedCurrentOwner), `Router owner changed: expected ${expectedCurrentOwner}, got ${owner}`);
  if (manifest.ownershipStatus === "pending-acceptance") {
    const pendingOwner = await read(manifest.permRouter, routerAbi, "pendingOwner");
    checks.pendingOwner = pendingOwner;
    failUnless(same(pendingOwner, manifest.owner), `Router pending owner mismatch: expected ${manifest.owner}, got ${pendingOwner}`);
  }
  if (manifest.timelock) {
    const minDelay = await read(manifest.timelock, timelockAbi, "getMinDelay");
    checks.timelock = { address: manifest.timelock, minDelaySeconds: minDelay.toString() };
    failUnless(same(manifest.owner, manifest.timelock), `Manifest owner ${manifest.owner} is not its timelock ${manifest.timelock}`);
    failUnless(Number.isSafeInteger(manifest.timelockDelaySeconds) && BigInt(manifest.timelockDelaySeconds) === minDelay,
      `Timelock delay mismatch: expected ${manifest.timelockDelaySeconds}, got ${minDelay}`);
    if (manifest.routerVersion >= 2 && manifest.releaseStatus !== "rehearsal") {
      failUnless(minDelay >= 172_800n, `Timelock delay ${minDelay}s is below the 172800s release minimum`);
    }
  }
  failUnless(same(treasury, manifest.treasury), `Treasury changed: expected ${manifest.treasury}, got ${treasury}`);
  failUnless(paused === false, "Router is paused");
  failUnless(Number(policyVersion) === Number(manifest.policy.version), `Active policy changed: expected ${manifest.policy.version}, got ${policyVersion}`);

  const policy = await read(manifest.permRouter, routerAbi, "feePolicies", [policyVersion]);
  checks.policy = { platformFeeBps: Number(policy[0]), rebateShareBps: Number(policy[1]), enabled: policy[2], exists: policy[3] };
  failUnless(Number(policy[0]) === Number(manifest.policy.platformFeeBps), `Platform fee changed: expected ${manifest.policy.platformFeeBps}, got ${policy[0]}`);
  failUnless(Number(policy[1]) === Number(manifest.policy.rebateShareBps), `Rebate share changed: expected ${manifest.policy.rebateShareBps}, got ${policy[1]}`);
  failUnless(policy[2] && policy[3], `Active policy ${policyVersion} is unavailable`);

  const [v4Config, v4Owner, v4Router, poolManager] = await Promise.all([
    read(manifest.permRouter, routerAbi, "adapters", [manifest.v4Adapter]),
    read(manifest.v4Adapter, v4Abi, "owner"), read(manifest.v4Adapter, v4Abi, "permRouter"),
    read(manifest.v4Adapter, v4Abi, "poolManager"),
  ]);
  checks.v4Adapter = { enabled: v4Config[0], providerId: v4Config[1], owner: v4Owner, router: v4Router, poolManager };
  failUnless(v4Config[0], "Official v4 adapter is disabled");
  failUnless(same(v4Router, manifest.permRouter), `V4 adapter router mismatch: ${v4Router}`);
  failUnless(same(poolManager, manifest.poolManager), `V4 adapter PoolManager mismatch: ${poolManager}`);
  failUnless(same(v4Owner, expectedCurrentOwner), `V4 adapter owner changed: expected ${expectedCurrentOwner}, got ${v4Owner}`);
  if (manifest.ownershipStatus === "pending-acceptance") {
    const pendingOwner = await read(manifest.v4Adapter, v4Abi, "pendingOwner");
    checks.v4Adapter.pendingOwner = pendingOwner;
    failUnless(same(pendingOwner, manifest.owner), `V4 pending owner mismatch: expected ${manifest.owner}, got ${pendingOwner}`);
  }

  if (manifest.routerVersion >= 2) {
    const [
      quoteSigner, pauseGuardian, permit2, hookProviderId, v4PinnedCodehash, v3PinnedCodehash,
      v4Code, v3Code, quoteSignerCode, treasuryCode, guardianCode,
    ] = await Promise.all([
      read(manifest.permRouter, routerAbi, "quoteSigner"), read(manifest.permRouter, routerAbi, "pauseGuardian"),
      read(manifest.permRouter, routerAbi, "permit2"), read(manifest.permRouter, routerAbi, "hookProviderIds", [manifest.v4Adapter]),
      read(manifest.permRouter, routerAbi, "adapterCodehashes", [manifest.v4Adapter]),
      read(manifest.permRouter, routerAbi, "adapterCodehashes", [manifest.v3Adapter]),
      client.getCode({ address: getAddress(manifest.v4Adapter) }), client.getCode({ address: getAddress(manifest.v3Adapter) }),
      client.getCode({ address: getAddress(manifest.quoteSigner) }),
      client.getCode({ address: getAddress(manifest.treasury) }), client.getCode({ address: getAddress(manifest.pauseGuardian) }),
    ]);
    const v4ActualCodehash = v4Code && v4Code !== "0x" ? keccak256(v4Code) : null;
    const v3ActualCodehash = v3Code && v3Code !== "0x" ? keccak256(v3Code) : null;
    checks.quoteSigner = quoteSigner;
    checks.pauseGuardian = pauseGuardian;
    checks.permit2 = permit2;
    checks.operationalCustody = {
      quoteSignerType: quoteSignerCode && quoteSignerCode !== "0x" ? "contract" : "eoa",
      treasuryType: treasuryCode && treasuryCode !== "0x" ? "contract" : "eoa",
      pauseGuardianType: guardianCode && guardianCode !== "0x" ? "contract" : "eoa",
    };
    checks.hookProviderId = hookProviderId;
    checks.adapterCodehashes = { v4Pinned: v4PinnedCodehash, v4Actual: v4ActualCodehash, v3Pinned: v3PinnedCodehash, v3Actual: v3ActualCodehash };
    failUnless(same(quoteSigner, manifest.quoteSigner), `Quote signer changed: expected ${manifest.quoteSigner}, got ${quoteSigner}`);
    failUnless(same(pauseGuardian, manifest.pauseGuardian), `Pause guardian changed: expected ${manifest.pauseGuardian}, got ${pauseGuardian}`);
    failUnless(same(permit2, manifest.permit2), `Permit2 mismatch: expected ${manifest.permit2}, got ${permit2}`);
    if (manifest.releaseStatus !== "rehearsal") {
      failUnless(!quoteSignerCode || quoteSignerCode === "0x", "Quote signer must remain an EOA backed by isolated signing custody");
      failUnless(Boolean(treasuryCode && treasuryCode !== "0x"), "Treasury must be a contract wallet");
      failUnless(Boolean(guardianCode && guardianCode !== "0x"), "Pause guardian must be a contract wallet");
      const distinctRoles = new Set([manifest.owner, manifest.treasury, manifest.quoteSigner, manifest.pauseGuardian].map((value) => String(value).toLowerCase()));
      failUnless(distinctRoles.size === 4, "Owner, treasury, quote signer and pause guardian must be separate identities");
    }
    failUnless(Boolean(v4ActualCodehash) && same(v4PinnedCodehash, v4ActualCodehash), `V4 adapter runtime no longer matches its pinned Router codehash`);
    failUnless(Boolean(v3ActualCodehash) && same(v3PinnedCodehash, v3ActualCodehash), `V3 adapter runtime no longer matches its pinned Router codehash`);

    const hookEntries = Array.isArray(manifest.aggregatorHooks) ? manifest.aggregatorHooks : [];
    const expectedHookProviderId = hookEntries.length
      ? (manifest.reservedProviderIds?.uniswapV4AggregatorHook || id("UNISWAP_V4_AGGREGATOR_HOOK"))
      : `0x${"0".repeat(64)}`;
    failUnless(same(hookProviderId, expectedHookProviderId), hookEntries.length
      ? `Reviewed hook staging requires the distinct provider identity; got ${hookProviderId}`
      : `Hook provider identity must remain disabled while no hook is reviewed; got ${hookProviderId}`);
    checks.aggregatorHooks = [];
    for (const entry of hookEntries) {
      const hook = entry.hooks;
      if (!hook || !entry.expectedCodehash) {
        failures.push("Aggregator Hook manifest entries require hooks and expectedCodehash");
        continue;
      }
      const [configuredCodehash, code] = await Promise.all([
        read(manifest.v4Adapter, v4Abi, "verifiedHookCodehashes", [hook]),
        client.getCode({ address: getAddress(hook) }),
      ]);
      const actualCodehash = code && code !== "0x" ? keccak256(code) : null;
      checks.aggregatorHooks.push({ hook, expectedCodehash: entry.expectedCodehash, configuredCodehash, actualCodehash });
      failUnless(Boolean(actualCodehash), `Aggregator Hook has no runtime bytecode: ${hook}`);
      failUnless(same(configuredCodehash, entry.expectedCodehash), `Aggregator Hook adapter codehash mismatch for ${hook}`);
      failUnless(Boolean(actualCodehash) && same(actualCodehash, entry.expectedCodehash), `Aggregator Hook runtime codehash mismatch for ${hook}`);
    }
    if (manifest.executionReady === true) {
      failUnless(hookEntries.length > 0, "Execution-ready brief compliance requires at least one reviewed Aggregator Hook");
      failUnless(manifest.aggregatorHookVerification === "passed", "Aggregator Hook evidence has not passed verification");
      failUnless(manifest.e2eVerification === "passed", "Required Router v2 E2E evidence has not passed verification");
    }
  } else {
    warnings.push("Official manifest is still Router v1; v2 execution remains intentionally disabled");
  }

  if (manifest.v3Adapter) {
    const [config, adapterOwner, router, swapRouter, weth] = await Promise.all([
      read(manifest.permRouter, routerAbi, "adapters", [manifest.v3Adapter]),
      read(manifest.v3Adapter, v3Abi, "owner"), read(manifest.v3Adapter, v3Abi, "permRouter"),
      read(manifest.v3Adapter, v3Abi, "swapRouter"), read(manifest.v3Adapter, v3Abi, "weth"),
    ]);
    checks.v3Adapter = { enabled: config[0], providerId: config[1], owner: adapterOwner, router, swapRouter, weth };
    failUnless(config[0], "Official v3 adapter is disabled");
    failUnless(same(adapterOwner, expectedCurrentOwner), `V3 adapter owner changed: expected ${expectedCurrentOwner}, got ${adapterOwner}`);
    if (manifest.ownershipStatus === "pending-acceptance") {
      const pendingOwner = await read(manifest.v3Adapter, v3Abi, "pendingOwner");
      checks.v3Adapter.pendingOwner = pendingOwner;
      failUnless(same(pendingOwner, manifest.owner), `V3 pending owner mismatch: expected ${manifest.owner}, got ${pendingOwner}`);
    }
    failUnless(same(router, manifest.permRouter), `V3 adapter router mismatch: ${router}`);
    failUnless(same(swapRouter, manifest.venues.synthraV3.swapRouter02), `V3 SwapRouter mismatch: ${swapRouter}`);
    failUnless(same(weth, manifest.venues.synthraV3.weth), `V3 WETH mismatch: ${weth}`);
  }

  if (manifest.sourceVerification !== "verified") warnings.push(`Source verification status is ${manifest.sourceVerification}`);
  if (!manifest.timelock) {
    if (manifest.routerVersion >= 2 && manifest.releaseStatus !== "rehearsal") failures.push("Router v2 release has no manifest-declared timelock");
    else warnings.push("Owner is not a manifest-declared timelock (acceptable only for Router v1 or a local rehearsal)");
  }

  const report = {
    status: failures.length ? "critical" : warnings.length ? "warning" : "ok",
    checkedAt: new Date().toISOString(), network: manifest.network, routerVersion: manifest.routerVersion,
    failures, warnings, checks,
  };
  const output = process.env.MONITOR_OUTPUT;
  if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  await sendAlert(report);
  if (failures.length) process.exitCode = 1;
}

main().catch(async (error) => {
  const report = { status: "critical", checkedAt: new Date().toISOString(), network: manifest.network, failures: [error.shortMessage || error.message || String(error)], warnings, checks };
  console.error(JSON.stringify(report, null, 2));
  try { await sendAlert(report); } catch (alertError) { console.error(`Alert failed: ${alertError.message}`); }
  process.exitCode = 1;
});
