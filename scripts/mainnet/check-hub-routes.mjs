#!/usr/bin/env node
// Read-only check of two-hop routes through the USDG hub and of Uniswap V2 pairs on 4663.
// Writes deployments/mainnet/hub-routes.{json,md}.
//
//   ETH ─(Uniswap v3 WETH/USDG)→ USDG ─(Uniswap v3 USDG/TOKEN)→ TOKEN      and back
//
// AMZN, NFLX and MSFT have no usable ETH pool but do have USDG pools, so they become recordable
// through this route when the round trip stays within --max-rt (default 100 bps).
// The Uniswap V2 section reports reserves and round-trip loss so V2 is only shown where it is real.
//
// Usage: node scripts/mainnet/check-hub-routes.mjs [--tokens AMZN,NFLX,MSFT] [--amount 0.001] [--max-rt 100]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, formatUnits, http, parseAbi, parseEther } from "viem";
import { MAINNET } from "./mainnet-addresses.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const AMOUNT = parseEther(flag("--amount", "0.001"));
const MAX_RT_BPS = Number(flag("--max-rt", 100));
const only = flag("--tokens", "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
const FEES = [100, 500, 3000, 10000];
const USDG = MAINNET.hubTokens.find((token) => token.symbol === "USDG");
const ZERO = "0x0000000000000000000000000000000000000000";

const client = createPublicClient({ transport: http(process.env.RH_MAINNET_RPC_URL || MAINNET.rpcUrl, { retryCount: 6, retryDelay: 1_500 }) });
const factoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const quoterAbi = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256 amountOut,uint160,uint32,uint256 gasEstimate)"]);
const v2FactoryAbi = parseAbi(["function getPair(address,address) view returns (address)"]);
const pairAbi = parseAbi(["function getReserves() view returns (uint112,uint112,uint32)", "function token0() view returns (address)"]);

const poolCache = new Map();
async function v3Pool(a, b, fee) {
  const key = `${a}-${b}-${fee}`.toLowerCase();
  if (!poolCache.has(key)) poolCache.set(key, await client.readContract({ address: MAINNET.uniswapV3.factory, abi: factoryAbi, functionName: "getPool", args: [a, b, fee] }));
  return poolCache.get(key);
}
async function v3Quote(tokenIn, tokenOut, amountIn, fee) {
  const pool = await v3Pool(tokenIn, tokenOut, fee);
  if (pool === ZERO) return null;
  try {
    const { result } = await client.simulateContract({
      address: MAINNET.uniswapV3.quoterV2, abi: quoterAbi, functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });
    return { fee, pool, amountOut: result[0], gasEstimate: result[3] };
  } catch {
    return null;
  }
}
async function bestV3(tokenIn, tokenOut, amountIn) {
  let best = null;
  for (const fee of FEES) {
    const quote = await v3Quote(tokenIn, tokenOut, amountIn, fee);
    if (quote && (!best || quote.amountOut > best.amountOut)) best = quote;
  }
  return best;
}
// Round trip for a fixed leg pair (same pools both ways), so the loss is fee + impact of that path only.
async function roundTrip(token, leg1Fee, leg2Fee) {
  const a = await v3Quote(MAINNET.weth, USDG.address, AMOUNT, leg1Fee);
  if (!a) return null;
  const b = await v3Quote(USDG.address, token.address, a.amountOut, leg2Fee);
  if (!b) return null;
  const c = await v3Quote(token.address, USDG.address, b.amountOut, leg2Fee);
  if (!c) return null;
  const d = await v3Quote(USDG.address, MAINNET.weth, c.amountOut, leg1Fee);
  if (!d) return null;
  return { usdgOut: a.amountOut, tokenOut: b.amountOut, backEth: d.amountOut, gas: a.gasEstimate + b.gasEstimate, lossBps: Number((AMOUNT - d.amountOut) * 10_000n / AMOUNT) };
}
async function v2Pair(a, b) {
  const pair = await client.readContract({ address: MAINNET.uniswapV2.factory, abi: v2FactoryAbi, functionName: "getPair", args: [a, b] });
  if (pair === ZERO) return null;
  const [r0, r1] = await client.readContract({ address: pair, abi: pairAbi, functionName: "getReserves" });
  const token0 = await client.readContract({ address: pair, abi: pairAbi, functionName: "token0" });
  const [reserveA, reserveB] = token0.toLowerCase() === a.toLowerCase() ? [r0, r1] : [r1, r0];
  // Constant-product round trip a -> b -> a at 0.30% each way.
  const out = (x, rin, rout) => (x * 997n * rout) / (rin * 1000n + x * 997n);
  return { pair, reserveA, reserveB, roundTrip: (amount) => {
    const got = out(amount, reserveA, reserveB);
    const back = out(got, reserveB + got, reserveA - amount);
    return Math.min(10_000, Number((amount - back) * 10_000n / amount));
  } };
}

async function main() {
  const chainId = await client.getChainId();
  if (chainId !== MAINNET.chainId) throw new Error(`RPC is chain ${chainId}, expected ${MAINNET.chainId}`);
  const block = await client.getBlockNumber();
  const tokens = MAINNET.stockTokens.filter((token) => !only.length || only.includes(token.symbol));
  const leg1 = await bestV3(MAINNET.weth, USDG.address, AMOUNT);
  if (!leg1) throw new Error("No Uniswap v3 WETH/USDG pool quotes");
  console.log(`ETH → USDG leg: Uniswap v3 fee ${leg1.fee} · 0.001 ETH = ${formatUnits(leg1.amountOut, 6)} USDG`);

  const rows = [];
  for (const token of tokens) {
    let best = null;
    for (const fee of FEES) {
      const result = await roundTrip(token, leg1.fee, fee);
      if (result && (!best || result.tokenOut > best.tokenOut)) best = { ...result, leg2Fee: fee };
    }
    const v2Eth = await v2Pair(MAINNET.weth, token.address);
    const v2Usdg = await v2Pair(USDG.address, token.address);
    const row = {
      symbol: token.symbol,
      address: token.address,
      hubRoute: best ? {
        path: `ETH →(v3 ${leg1.fee / 10_000}%) USDG →(v3 ${best.leg2Fee / 10_000}%) ${token.symbol}`,
        leg1Fee: leg1.fee, leg2Fee: best.leg2Fee, tokenOut: best.tokenOut.toString(), roundTripLossBps: best.lossBps,
        gasEstimate: best.gas.toString(), admitted: best.lossBps <= MAX_RT_BPS,
      } : null,
      v2: {
        weth: v2Eth ? { pair: v2Eth.pair, wethReserve: formatUnits(v2Eth.reserveA, 18), roundTripLossBps: v2Eth.roundTrip(AMOUNT) } : null,
        usdg: v2Usdg ? { pair: v2Usdg.pair, usdgReserve: formatUnits(v2Usdg.reserveA, 6) } : null,
      },
    };
    rows.push(row);
    console.log(`${token.symbol.padEnd(6)} hub ${row.hubRoute ? `${row.hubRoute.roundTripLossBps} bps ${row.hubRoute.admitted ? "✅" : "❌"} (${row.hubRoute.path})` : "none"} · V2 WETH ${row.v2.weth ? `${row.v2.weth.roundTripLossBps} bps` : "-"}`);
  }

  const v2Hub = await v2Pair(MAINNET.weth, USDG.address);
  const output = {
    chainId: MAINNET.chainId, generatedAt: new Date().toISOString(), block: Number(block), amountInWei: AMOUNT.toString(),
    hub: { symbol: USDG.symbol, address: USDG.address, decimals: USDG.decimals, ethLegFee: leg1.fee, ethLegUsdgOut: leg1.amountOut.toString() },
    admission: { maxRoundTripLossBps: MAX_RT_BPS },
    v2: { factory: MAINNET.uniswapV2.factory, wethUsdg: v2Hub ? { pair: v2Hub.pair, wethReserve: formatUnits(v2Hub.reserveA, 18), usdgReserve: formatUnits(v2Hub.reserveB, 6), roundTripLossBps: v2Hub.roundTrip(AMOUNT) } : null },
    tokens: rows,
  };
  const jsonPath = path.join(root, "deployments/mainnet/hub-routes.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`);
  const md = [
    "# USDG hub routes and Uniswap V2 on Robinhood Chain mainnet (4663)",
    "",
    `Block ${block} · amount 0.001 ETH · admission ≤ ${MAX_RT_BPS} bps round trip · generated by \`scripts/mainnet/check-hub-routes.mjs\`.`,
    "",
    "| Token | Hub route (ETH → USDG → token) | Round trip | Recordable | V2 WETH pair round trip |",
    "|---|---|---|---|---|",
    ...rows.map((row) => `| ${row.symbol} | ${row.hubRoute ? row.hubRoute.path : "—"} | ${row.hubRoute ? `${row.hubRoute.roundTripLossBps} bps` : "—"} | ${row.hubRoute?.admitted ? "yes" : "no"} | ${row.v2.weth ? `${row.v2.weth.roundTripLossBps} bps` : "no pair"} |`),
    "",
    `Uniswap V2 WETH/USDG: ${output.v2.wethUsdg ? `${output.v2.wethUsdg.usdgReserve} USDG reserve, ${output.v2.wethUsdg.roundTripLossBps} bps round trip` : "no pair"}.`,
    "",
    "Round trip = 0.001 ETH bought and sold back over the same pools (fees + price impact). Stock Tokens are tokens, not shares.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(root, "deployments/mainnet/hub-routes.md"), md);
  console.log(`\nWritten deployments/mainnet/hub-routes.{json,md}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
