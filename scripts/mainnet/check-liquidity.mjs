#!/usr/bin/env node
// Read-only Robinhood Chain mainnet (4663) venue and liquidity audit for Perm.
//
// - Verifies every dependency Perm needs has code on 4663 (PoolManager, V4Quoter,
//   StateView, Permit2, Uniswap V3 factory/SwapRouter02/QuoterV2, WETH).
// - Checks whether Synthra V3 exists on mainnet (testnet addresses + registry factory).
// - For each candidate stock token, discovers direct (hookless) Uniswap v4 pools
//   from PoolManager Initialize logs and Uniswap V3 pools from the factory.
// - Quotes ETH -> token (after Perm's 0.15% net fee) and token -> ETH for the
//   resulting amount, so the report reflects the exact recording nominal.
//
// No transaction is sent and no key is read. Output:
//   deployments/mainnet/liquidity-report.json
//   deployments/mainnet/liquidity-report.md
//
// Usage: node scripts/mainnet/check-liquidity.mjs [--amount 0.001] [--tokens NVDA,AAPL]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, http, parseAbi, parseAbiItem, formatUnits, parseEther, getAddress, keccak256, zeroAddress,
} from "viem";
import { MAINNET } from "./mainnet-addresses.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const AMOUNT = parseEther(argValue("amount", "0.001"));
const NET_FEE_BPS = 15n; // 0.20% gross - 25% rebate
const ROUTED = AMOUNT - (AMOUNT * NET_FEE_BPS) / 10_000n;
const TOKEN_FILTER = argValue("tokens", "")?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const RPC = process.env.RH_MAINNET_RPC_URL || MAINNET.rpcUrl;
// Quote price impact sanity: compare our amount to a 1/100 probe. Above this we flag the venue.
const MAX_IMPACT_BPS = Number(process.env.MAX_IMPACT_BPS || 300);

const client = createPublicClient({ transport: http(RPC, { retryCount: 6, retryDelay: 1_500, timeout: 30_000 }) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function withRetry(operation, attempts = 8) {
  for (let i = 0; ; i += 1) {
    try {
      return await operation();
    } catch (error) {
      const rateLimited = error?.status === 429 || /429|Too Many Requests|rate/i.test(String(error?.details || error?.message));
      if (!rateLimited || i >= attempts) throw error;
      await sleep(1_500 * 2 ** Math.min(i, 4));
    }
  }
}

const v4QuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const stateViewAbi = parseAbi([
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
]);
const v3FactoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const v3PoolAbi = parseAbi(["function liquidity() view returns (uint128)"]);
const v3QuoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
const routerAbi = parseAbi(["function WETH9() view returns (address)"]);
const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
]);
const initializeEvent = parseAbiItem(
  "event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)",
);

const V3_FEES = [100, 500, 3_000, 10_000];

async function codeInfo(label, address) {
  const code = await client.getCode({ address });
  const present = Boolean(code && code !== "0x");
  return { label, address: getAddress(address), present, codehash: present ? keccak256(code) : null };
}

let latestBlockCache;
async function initializeLogs(currency0, currency1) {
  // Public RPC allows at most 10,000,000 blocks per eth_getLogs; currency topics keep
  // the match count tiny, so we fan out fixed windows with bounded concurrency.
  latestBlockCache ??= await client.getBlockNumber();
  const latest = latestBlockCache;
  const step = BigInt(process.env.LOG_CHUNK || 9_999_999);
  const windows = [];
  for (let from = BigInt(MAINNET.poolDiscoveryStartBlock); from <= latest; from += step) {
    windows.push([from, from + step - 1n > latest ? latest : from + step - 1n]);
  }
  const logs = [];
  const concurrency = Number(process.env.LOG_CONCURRENCY || 2);
  for (let i = 0; i < windows.length; i += concurrency) {
    const batch = await Promise.all(windows.slice(i, i + concurrency).map(([fromBlock, toBlock]) => withRetry(() => client.getLogs({
      address: MAINNET.uniswapV4.poolManager,
      event: initializeEvent,
      args: { currency0, currency1 },
      fromBlock,
      toBlock,
    }))));
    await sleep(250);
    for (const chunk of batch) logs.push(...chunk);
  }
  return logs;
}

async function v4Quote(key, zeroForOne, amount) {
  const { result } = await client.simulateContract({
    address: MAINNET.uniswapV4.quoter,
    abi: v4QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ poolKey: key, zeroForOne, exactAmount: amount, hookData: "0x" }],
    account: zeroAddress,
  });
  return { amountOut: result[0], gasEstimate: result[1] };
}

async function v3Quote(tokenIn, tokenOut, fee, amount) {
  const { result } = await client.simulateContract({
    address: MAINNET.uniswapV3.quoterV2,
    abi: v3QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut, amountIn: amount, fee, sqrtPriceLimitX96: 0n }],
    account: zeroAddress,
  });
  return { amountOut: result[0], gasEstimate: result[3] };
}

function impactBps(full, probe, probeDivisor) {
  const reference = probe * probeDivisor;
  if (reference <= 0n || full >= reference) return 0;
  return Number(((reference - full) * 10_000n) / reference);
}

async function discoverV4(token, weth) {
  const out = [];
  const sides = [
    { kind: "native", c0: zeroAddress, c1: token, ethSide: zeroAddress },
    ...(BigInt(weth) < BigInt(token)
      ? [{ kind: "weth", c0: weth, c1: token, ethSide: weth }]
      : [{ kind: "weth", c0: token, c1: weth, ethSide: weth }]),
  ];
  for (const side of sides) {
    const logs = await initializeLogs(side.c0, side.c1);
    for (const log of logs) {
      const { id, currency0, currency1, fee, tickSpacing, hooks } = log.args;
      const key = { currency0, currency1, fee, tickSpacing, hooks };
      const entry = {
        venue: "uniswap-v4",
        ethSide: side.kind,
        poolId: id,
        fee: Number(fee),
        tickSpacing: Number(tickSpacing),
        hooks,
        direct: hooks === zeroAddress,
        initializationBlock: Number(log.blockNumber),
        permCompatible: hooks === zeroAddress && side.kind === "native",
      };
      try {
        entry.liquidity = (await client.readContract({
          address: MAINNET.uniswapV4.stateView, abi: stateViewAbi, functionName: "getLiquidity", args: [id],
        })).toString();
      } catch { entry.liquidity = null; }
      if (entry.direct) {
        const ethIsZero = currency0.toLowerCase() === side.ethSide.toLowerCase();
        try {
          const buy = await v4Quote(key, ethIsZero, ROUTED);
          const probe = await v4Quote(key, ethIsZero, ROUTED / 100n);
          entry.buy = { amountIn: ROUTED.toString(), amountOut: buy.amountOut.toString(), gas: buy.gasEstimate.toString(), impactBps: impactBps(buy.amountOut, probe.amountOut, 100n) };
          const sellIn = buy.amountOut - (buy.amountOut * NET_FEE_BPS) / 10_000n;
          const sell = await v4Quote(key, !ethIsZero, sellIn);
          entry.sell = { amountIn: sellIn.toString(), amountOut: sell.amountOut.toString(), gas: sell.gasEstimate.toString() };
          entry.roundTripLossBps = Number(((AMOUNT - sell.amountOut) * 10_000n) / AMOUNT);
        } catch (error) {
          entry.quoteError = String(error.shortMessage || error.message).slice(0, 160);
        }
      }
      out.push(entry);
    }
  }
  return out;
}

async function discoverV3(token, weth) {
  const out = [];
  for (const fee of V3_FEES) {
    const pool = await client.readContract({
      address: MAINNET.uniswapV3.factory, abi: v3FactoryAbi, functionName: "getPool", args: [weth, token, fee],
    });
    if (pool === zeroAddress) continue;
    const entry = { venue: "uniswap-v3", pool, fee, permCompatible: true };
    try {
      entry.liquidity = (await client.readContract({ address: pool, abi: v3PoolAbi, functionName: "liquidity" })).toString();
      entry.wethBalance = (await client.readContract({ address: weth, abi: erc20Abi, functionName: "balanceOf", args: [pool] })).toString();
      entry.tokenBalance = (await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [pool] })).toString();
    } catch { /* informational only */ }
    try {
      const buy = await v3Quote(weth, token, fee, ROUTED);
      const probe = await v3Quote(weth, token, fee, ROUTED / 100n);
      entry.buy = { amountIn: ROUTED.toString(), amountOut: buy.amountOut.toString(), gas: buy.gasEstimate.toString(), impactBps: impactBps(buy.amountOut, probe.amountOut, 100n) };
      const sellIn = buy.amountOut - (buy.amountOut * NET_FEE_BPS) / 10_000n;
      const sell = await v3Quote(token, weth, fee, sellIn);
      entry.sell = { amountIn: sellIn.toString(), amountOut: sell.amountOut.toString(), gas: sell.gasEstimate.toString() };
      entry.roundTripLossBps = Number(((AMOUNT - sell.amountOut) * 10_000n) / AMOUNT);
    } catch (error) {
      entry.quoteError = String(error.shortMessage || error.message).slice(0, 160);
    }
    out.push(entry);
  }
  return out;
}

function usable(entry) {
  return entry.permCompatible && entry.buy && entry.sell && entry.buy.impactBps <= MAX_IMPACT_BPS && entry.roundTripLossBps < 500;
}

async function main() {
  const chainId = await client.getChainId();
  if (chainId !== MAINNET.chainId) throw new Error(`RPC is chain ${chainId}, expected ${MAINNET.chainId}`);
  const [block, gasPrice] = await Promise.all([client.getBlock(), client.getGasPrice()]);

  const weth = getAddress(await client.readContract({ address: MAINNET.uniswapV3.swapRouter02, abi: routerAbi, functionName: "WETH9" }));
  if (weth.toLowerCase() !== MAINNET.weth.toLowerCase()) throw new Error(`SwapRouter02.WETH9 ${weth} != configured WETH ${MAINNET.weth}`);

  const dependencies = await Promise.all([
    codeInfo("Uniswap v4 PoolManager", MAINNET.uniswapV4.poolManager),
    codeInfo("Uniswap v4 V4Quoter", MAINNET.uniswapV4.quoter),
    codeInfo("Uniswap v4 StateView", MAINNET.uniswapV4.stateView),
    codeInfo("Permit2", MAINNET.permit2),
    codeInfo("WETH9", MAINNET.weth),
    codeInfo("Uniswap V3 Factory", MAINNET.uniswapV3.factory),
    codeInfo("Uniswap V3 SwapRouter02", MAINNET.uniswapV3.swapRouter02),
    codeInfo("Uniswap V3 QuoterV2", MAINNET.uniswapV3.quoterV2),
  ]);

  const synthraChecks = await Promise.all([
    codeInfo("Synthra factory (testnet address)", "0x911b4000D3422F482F4062a913885f7b035382Df"),
    codeInfo("Synthra SwapRouter02 (testnet address)", "0x3Ce954107b1A675826B33bF23060Dd655e3758fE"),
    codeInfo("Synthra QuoterV2 (testnet address)", "0x231606c321A99DE81e28fE48B07a93F1ba49e713"),
    codeInfo("Synthra factory (DefiLlama registry address)", "0x6307fc239C7964942c1BfFE51930E55606619c74"),
  ]);
  const synthraFactory = synthraChecks.find((c) => c.label.includes("registry") && c.present);
  let synthraPools = [];
  if (synthraFactory) {
    for (const t of MAINNET.stockTokens.slice(0, 6)) {
      for (const fee of V3_FEES) {
        try {
          const pool = await client.readContract({ address: synthraFactory.address, abi: v3FactoryAbi, functionName: "getPool", args: [weth, t.address, fee] });
          if (pool !== zeroAddress) synthraPools.push({ token: t.symbol, fee, pool });
        } catch { /* not a v3 factory */ }
      }
    }
  }

  const tokens = MAINNET.stockTokens.filter((t) => !TOKEN_FILTER?.length || TOKEN_FILTER.includes(t.symbol));
  const results = [];
  for (const token of tokens) {
    process.stdout.write(`· ${token.symbol.padEnd(6)} `);
    const decimals = await client.readContract({ address: token.address, abi: erc20Abi, functionName: "decimals" });
    const symbol = await client.readContract({ address: token.address, abi: erc20Abi, functionName: "symbol" });
    const v4 = await discoverV4(token.address, weth);
    const v3 = await discoverV3(token.address, weth);
    const venues = [...v4, ...v3];
    const usableVenues = venues.filter(usable);
    const best = usableVenues.sort((a, b) => (BigInt(b.buy.amountOut) > BigInt(a.buy.amountOut) ? 1 : -1))[0];
    results.push({
      symbol: token.symbol, onchainSymbol: symbol, address: token.address, decimals: Number(decimals),
      venues, usableVenueCount: usableVenues.length,
      usableV4: usableVenues.filter((v) => v.venue === "uniswap-v4").length,
      usableV3: usableVenues.filter((v) => v.venue === "uniswap-v3").length,
      best: best ? { venue: best.venue, fee: best.fee, amountOut: best.buy.amountOut } : null,
    });
    console.log(`v4 pools ${v4.length} (Perm-usable ${results.at(-1).usableV4}) · v3 pools ${v3.length} (usable ${results.at(-1).usableV3})`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    chainId, rpc: RPC, blockNumber: Number(block.number), blockTimestamp: Number(block.timestamp),
    gasPriceWei: gasPrice.toString(), gasPriceGwei: formatUnits(gasPrice, 9),
    amountInWei: AMOUNT.toString(), routedInputWei: ROUTED.toString(), maxImpactBps: MAX_IMPACT_BPS,
    weth, dependencies, synthra: { checks: synthraChecks, poolsFound: synthraPools, availableOnMainnet: synthraPools.length > 0 },
    tokens: results,
  };
  const outDir = path.join(root, "deployments/mainnet");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "liquidity-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "liquidity-report.md"), renderMarkdown(report));
  console.log(`\nReport: deployments/mainnet/liquidity-report.{json,md}`);
}

function fmt(wei, decimals = 18, digits = 8) {
  const n = Number(formatUnits(BigInt(wei), decimals));
  return n.toLocaleString("en-US", { maximumSignificantDigits: digits });
}

function renderMarkdown(r) {
  const lines = [];
  lines.push(`# Robinhood Chain mainnet liquidity report`, ``);
  lines.push(`Generated ${r.generatedAt} · chain ${r.chainId} · block ${r.blockNumber} · gas ${Number(r.gasPriceGwei).toFixed(4)} gwei`);
  lines.push(`Nominal: ${fmt(r.amountInWei)} ETH (routed after 0.15% net Perm fee: ${fmt(r.routedInputWei)} ETH). Read-only; no transaction sent.`, ``);
  lines.push(`## Dependencies`, ``, `| Contract | Address | Code |`, `|---|---|---|`);
  for (const d of r.dependencies) lines.push(`| ${d.label} | \`${d.address}\` | ${d.present ? "✅" : "❌ none"} |`);
  lines.push(``, `## Synthra V3 on mainnet`, ``, `| Check | Address | Code |`, `|---|---|---|`);
  for (const d of r.synthra.checks) lines.push(`| ${d.label} | \`${d.address}\` | ${d.present ? "✅" : "❌ none"} |`);
  lines.push(``, r.synthra.availableOnMainnet
    ? `Synthra pools found: ${r.synthra.poolsFound.map((p) => `${p.token}/${p.fee}`).join(", ")}`
    : `**No Synthra WETH pool for the stock tokens on 4663 → Synthra must not be recorded or claimed on mainnet.**`, ``);
  lines.push(`## Stock tokens`, ``);
  lines.push(`Perm-usable = hookless pool, native-ETH side for v4 (PermV4Adapter routes ETH as currency 0x0), quote succeeds, price impact ≤ ${r.maxImpactBps / 100}% and round trip loss < 5%.`, ``);
  lines.push(`| Token | Venue | Fee | ETH side | Buy out (0.001 ETH) | Impact | Round-trip loss | Perm-usable |`);
  lines.push(`|---|---|---:|---|---:|---:|---:|---|`);
  for (const t of r.tokens) {
    if (!t.venues.length) { lines.push(`| ${t.symbol} | — | — | — | no pool | — | — | ❌ |`); continue; }
    for (const v of t.venues) {
      const fee = v.venue === "uniswap-v4" ? `${v.fee === 0x800000 ? "dynamic" : `${v.fee / 10_000}%`}` : `${v.fee / 10_000}%`;
      const side = v.venue === "uniswap-v3" ? "WETH" : v.ethSide;
      const hook = v.venue === "uniswap-v4" && !v.direct ? ` (hook ${v.hooks.slice(0, 6)}…)` : "";
      const out = v.buy ? fmt(v.buy.amountOut, t.decimals) : (v.quoteError ? `error` : "—");
      lines.push(`| ${t.symbol} | ${v.venue}${hook} | ${fee} | ${side} | ${out} | ${v.buy ? `${(v.buy.impactBps / 100).toFixed(2)}%` : "—"} | ${v.roundTripLossBps !== undefined ? `${(v.roundTripLossBps / 100).toFixed(2)}%` : "—"} | ${usable(v) ? "✅" : "❌"} |`);
    }
  }
  lines.push(``, `## Recording verdict`, ``);
  lines.push(`| Token | Usable v4 | Usable v3 | Route comparison possible | Recordable |`, `|---|---:|---:|---|---|`);
  for (const t of r.tokens) {
    lines.push(`| ${t.symbol} | ${t.usableV4} | ${t.usableV3} | ${t.usableVenueCount >= 2 ? "✅" : "❌"} | ${t.usableVenueCount ? "✅" : "❌ do not record"} |`);
  }
  lines.push(``);
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
