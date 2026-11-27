#!/usr/bin/env node
/**
 * Discover Robinhood testnet v4 pools from canonical PoolManager Initialize logs.
 * Safe defaults keep direct pools. Hooked pools are emitted only when their address
 * is explicitly reviewed through PERM_VERIFIED_HOOKS (comma-separated addresses).
 */
const fs = require("node:fs");
const path = require("node:path");
const { createPublicClient, defineChain, http, parseAbiItem, getAddress, zeroAddress } = require("viem");

const root = path.resolve(__dirname, "..");

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

const manifest = require(path.join(root, "deployments/robinhood-testnet.json"));
const outputPath = path.join(root, "deployments/v4-pools.json");
const rpcUrl = process.env.RH_TESTNET_RPC_URL || manifest.rpcUrl;
const poolManager = getAddress(manifest.poolManager);
const previous = fs.existsSync(outputPath) && process.env.POOL_DISCOVERY_RESET !== "1" ? JSON.parse(fs.readFileSync(outputPath, "utf8")) : null;
const discoveryFloor = BigInt(manifest.poolDiscoveryStartBlock || 0);
const reorgDepth = BigInt(boundedInteger("POOL_DISCOVERY_REORG_DEPTH", 100, 1, 100_000));
const previousToBlock = previous ? BigInt(previous.toBlock) : discoveryFloor;
const overlap = reorgDepth - 1n;
const previousRescan = previous && previousToBlock > overlap ? previousToBlock - overlap : discoveryFloor;
const defaultFromBlock = previousRescan > discoveryFloor ? previousRescan : discoveryFloor;
const fromBlock = BigInt(boundedInteger(
  "POOL_DISCOVERY_FROM_BLOCK",
  Number(defaultFromBlock),
  Number(discoveryFloor),
  Number.MAX_SAFE_INTEGER,
));
const chunkSize = BigInt(boundedInteger("POOL_DISCOVERY_CHUNK", 10_000, 1, 10_000));
const confirmations = BigInt(boundedInteger("POOL_DISCOVERY_CONFIRMATIONS", 12, 1, 10_000));
const manifestHooks = (manifest.aggregatorHooks || []).map((entry) => typeof entry === "string" ? entry : entry.hooks || entry.hook).filter(Boolean);
const reviewedHooks = new Set([
  ...manifestHooks,
  ...(process.env.PERM_VERIFIED_HOOKS || "").split(",").filter(Boolean),
].map((address) => getAddress(address).toLowerCase()));
const robinhoodTestnet = defineChain({ id: manifest.chainId, name: manifest.network || "Robinhood Chain Testnet", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const client = createPublicClient({ chain: robinhoodTestnet, transport: http(rpcUrl, { timeout: 20_000, retryCount: 2 }) });
const initializeEvent = parseAbiItem("event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)");

async function main() {
  const latest = await client.getBlockNumber();
  const toBlock = latest > confirmations ? latest - confirmations : 0n;
  const pools = new Map((previous?.pools || [])
    .filter((pool) => BigInt(pool.initializationBlock) < fromBlock)
    .filter((pool) => pool.hooks.toLowerCase() === zeroAddress || reviewedHooks.has(pool.hooks.toLowerCase()))
    .map((pool) => [pool.id, pool]));
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
    const logs = await client.getLogs({ address: poolManager, event: initializeEvent, fromBlock: start, toBlock: end, strict: true });
    for (const log of logs) {
      const hook = getAddress(log.args.hooks);
      const isDirect = hook.toLowerCase() === zeroAddress;
      if (!isDirect && !reviewedHooks.has(hook.toLowerCase())) continue;
      pools.set(log.args.id, {
        id: log.args.id,
        currency0: getAddress(log.args.currency0),
        currency1: getAddress(log.args.currency1),
        fee: Number(log.args.fee),
        tickSpacing: Number(log.args.tickSpacing),
        hooks: hook,
        hookData: "0x",
        sourceType: isDirect ? "direct" : "verified-hook",
        initializationBlock: Number(log.blockNumber),
      });
    }
    process.stdout.write(`\rscanned ${start}-${end}; ${pools.size} eligible pools`);
  }
  const result = {
    chainId: manifest.chainId,
    poolManager,
    generatedAt: new Date().toISOString(),
    fromBlock: previous ? Math.min(Number(previous.fromBlock), Number(fromBlock)) : Number(fromBlock),
    toBlock: Number(toBlock),
    pools: [...pools.values()].sort((a, b) => a.initializationBlock - b.initializationBlock),
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`\nwrote ${result.pools.length} pools to ${path.relative(root, outputPath)}\n`);
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exitCode = 1;
});
