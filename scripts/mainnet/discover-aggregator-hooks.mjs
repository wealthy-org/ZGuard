#!/usr/bin/env node
// Discovers Aggregator Hook pools on Robinhood Chain mainnet (4663) that Perm may route through,
// and writes deployments/mainnet/aggregator-hooks.json (consumed by deploy-mainnet.cjs and the
// quote API). Read-only: no key, no transaction.
//
// A hook is admitted only when ALL of these hold:
//   - aggregatorHookVersion() returns a version listed in MAINNET.aggregatorHookVersions
//   - poolManager() is the canonical v4 PoolManager
//   - the hook address permission bits are exactly 0x2888 (beforeInitialize, beforeAddLiquidity,
//     beforeSwap, beforeSwapReturnDelta) – i.e. it cannot touch afterSwap or liquidity removal
// A pool on an admitted hook is admitted only when:
//   - it is initialized (StateView slot0) and the hook maps it to an external pool
//   - both directions quote at the audit amount and round-trip loss <= --max-rt (default 100 bps)
//
// Usage: node scripts/mainnet/discover-aggregator-hooks.mjs [--hooks 0xa…,0xb…] [--max-rt 100]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, encodeAbiParameters, getAddress, http, keccak256, parseAbi, parseEther } from "viem";
import { MAINNET } from "./mainnet-addresses.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportPath = path.join(root, "deployments/mainnet/liquidity-report.json");
const outputPath = path.join(root, "deployments/mainnet/aggregator-hooks.json");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const MAX_RT_BPS = Number(flag("--max-rt", 100));
const AMOUNT = parseEther(flag("--amount", "0.001"));
const DYNAMIC_FEE = 0x800000;
const REQUIRED_FLAGS = 0x2888n;
const TICK_SPACINGS = [1, 10, 50, 60, 100, 200];

const client = createPublicClient({ transport: http(process.env.RH_MAINNET_RPC_URL || MAINNET.rpcUrl, { retryCount: 6, retryDelay: 1_500 }) });
const hookAbi = parseAbi([
  "function aggregatorHookVersion() view returns (string)",
  "function poolManager() view returns (address)",
  "function poolIdToExternalPool(bytes32) view returns (address)",
]);
const stateViewAbi = parseAbi(["function getSlot0(bytes32) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)"]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(((address,address,uint24,int24,address) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData)) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function candidateHooks() {
  const explicit = flag("--hooks", "");
  if (explicit) return explicit.split(",").map((value) => getAddress(value.trim()));
  const found = new Set();
  if (fs.existsSync(reportPath)) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    for (const token of report.tokens) for (const venue of token.venues) {
      const hook = (venue.hooks || "").toLowerCase();
      if (hook && !/^0x0{40}$/.test(hook) && (BigInt(hook) & 0x3fffn) === REQUIRED_FLAGS) found.add(getAddress(hook));
    }
  }
  return [...found];
}

const poolKeyId = (key) => keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
  [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
));

async function quote(key, zeroForOne, amount) {
  const { result } = await client.simulateContract({
    address: MAINNET.uniswapV4.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks], zeroForOne, exactAmount: amount, hookData: "0x" }],
  });
  return { amountOut: result[0], gasEstimate: result[1] };
}

async function main() {
  const chainId = await client.getChainId();
  if (chainId !== MAINNET.chainId) throw new Error(`RPC is chain ${chainId}, expected ${MAINNET.chainId}`);
  const block = await client.getBlockNumber();
  const tokens = [...MAINNET.stockTokens, ...MAINNET.hubTokens];
  const hooks = [];
  const pools = [];
  const rejectedHooks = [];

  for (const hook of candidateHooks()) {
    let version = "";
    let poolManager = "";
    try {
      version = await client.readContract({ address: hook, abi: hookAbi, functionName: "aggregatorHookVersion" });
      poolManager = await client.readContract({ address: hook, abi: hookAbi, functionName: "poolManager" });
    } catch {
      rejectedHooks.push({ hook, reason: "no aggregatorHookVersion()/poolManager()" });
      continue;
    }
    if (!MAINNET.aggregatorHookVersions.includes(version)) { rejectedHooks.push({ hook, version, reason: "version not on the accepted list" }); continue; }
    if (getAddress(poolManager) !== getAddress(MAINNET.uniswapV4.poolManager)) { rejectedHooks.push({ hook, version, reason: "foreign PoolManager" }); continue; }
    const code = await client.getCode({ address: hook });
    const runtimeCodehash = keccak256(code);
    const admittedPools = [];

    for (const token of tokens) {
      const [currency0, currency1] = BigInt(MAINNET.weth) < BigInt(token.address) ? [MAINNET.weth, token.address] : [token.address, MAINNET.weth];
      for (const tickSpacing of TICK_SPACINGS) {
        const key = { currency0: getAddress(currency0), currency1: getAddress(currency1), fee: DYNAMIC_FEE, tickSpacing, hooks: hook };
        const id = poolKeyId(key);
        const [sqrtPriceX96] = await client.readContract({ address: MAINNET.uniswapV4.stateView, abi: stateViewAbi, functionName: "getSlot0", args: [id] });
        if (sqrtPriceX96 === 0n) continue;
        let externalPool = null;
        try { externalPool = await client.readContract({ address: hook, abi: hookAbi, functionName: "poolIdToExternalPool", args: [id] }); } catch { /* optional */ }
        if (!externalPool || /^0x0{40}$/i.test(externalPool)) continue;
        const wethIsZero = getAddress(MAINNET.weth) === key.currency0;
        try {
          const buy = await quote(key, wethIsZero, AMOUNT);
          const sell = await quote(key, !wethIsZero, buy.amountOut);
          const roundTripLossBps = Number((AMOUNT - sell.amountOut) * 10_000n / AMOUNT);
          const entry = {
            id, ...key, hookData: "0x", sourceType: "aggregator-hook", initializationBlock: 0,
            symbol: token.symbol, tokenAddress: getAddress(token.address), externalPool: getAddress(externalPool),
            hookVersion: version, hookCodehash: runtimeCodehash,
            buyAmountOut: buy.amountOut.toString(), buyGasEstimate: buy.gasEstimate.toString(), roundTripLossBps,
          };
          const admitted = roundTripLossBps <= MAX_RT_BPS;
          console.log(`${admitted ? "✅" : "❌"} ${version} ${hook.slice(0, 10)} WETH/${token.symbol} ts=${tickSpacing} RT ${roundTripLossBps} bps → ${externalPool}`);
          if (admitted) { pools.push(entry); admittedPools.push(id); }
        } catch (error) {
          console.log(`❌ ${hook.slice(0, 10)} WETH/${token.symbol} ts=${tickSpacing} quote failed: ${String(error.shortMessage || error.message).slice(0, 80)}`);
        }
        await sleep(150);
      }
    }
    if (admittedPools.length) hooks.push({ address: hook, version, runtimeCodehash, permissionBits: "0x2888", pools: admittedPools });
  }

  const output = {
    chainId: MAINNET.chainId,
    generatedAt: new Date().toISOString(),
    block: Number(block),
    amountInWei: AMOUNT.toString(),
    admission: { maxRoundTripLossBps: MAX_RT_BPS, versions: MAINNET.aggregatorHookVersions, permissionBits: "0x2888", currency: "WETH-denominated pools (reached through PermWethAdapter)" },
    note: "Hooks are third-party immutable contracts whose source is verified on Blockscout. Perm pins each runtime codehash; a change disables the route.",
    hooks,
    pools,
    rejectedHooks,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`\n${pools.length} pool(s) on ${hooks.length} hook(s) admitted → ${path.relative(root, outputPath)}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
