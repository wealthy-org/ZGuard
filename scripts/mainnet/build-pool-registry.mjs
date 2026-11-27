#!/usr/bin/env node
// Builds deployments/mainnet/v4-pools.json (same schema as deployments/v4-pools.json) from the
// read-only liquidity audit in deployments/mainnet/liquidity-report.json.
//
// Admission rules (deliberately strict, so a recording never touches a thin or look-alike pool):
//   - Uniswap v4, hookless (hooks == 0x0), native ETH side (currency0 == 0x0)
//   - quoted successfully in BOTH directions at the audit amount
//   - round-trip loss <= MAX_RT_BPS (default 100 = 1.00%) and buy impact <= MAX_IMPACT_BPS (default 300)
//   - token is not on the DO_NOT_RECORD list
//
// Usage: node scripts/mainnet/build-pool-registry.mjs [--max-rt 100] [--max-impact 300]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAINNET } from "./mainnet-addresses.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reportPath = path.join(root, "deployments/mainnet/liquidity-report.json");
const outputPath = path.join(root, "deployments/mainnet/v4-pools.json");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const MAX_RT_BPS = flag("--max-rt", 100);
const MAX_IMPACT_BPS = flag("--max-impact", 300);
// AMZN / NFLX / MSFT are no longer blocked: their direct ETH pools still fail the round-trip bar below
// (104 / 1022 / 249 bps), so they are recorded only through the USDG hub (deployments/mainnet/hub-routes.json).
export const DO_NOT_RECORD = new Set([]);
const ZERO = "0x0000000000000000000000000000000000000000";

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
if (report.chainId !== MAINNET.chainId) throw new Error(`Report chain ${report.chainId} is not ${MAINNET.chainId}`);

const pools = [];
const v3Pools = [];
const summary = [];
for (const token of report.tokens) {
  const admitted = { symbol: token.symbol, v4: [], v3: [] };
  if (DO_NOT_RECORD.has(token.symbol)) {
    summary.push({ ...admitted, excluded: "do-not-record list" });
    continue;
  }
  for (const venue of token.venues) {
    const rt = venue.roundTripLossBps;
    const impact = venue.buy?.impactBps ?? Infinity;
    if (rt === undefined || rt === null || rt > MAX_RT_BPS || impact > MAX_IMPACT_BPS) continue;
    if (!venue.buy?.amountOut || !venue.sell?.amountOut) continue;
    if (venue.venue === "uniswap-v4") {
      if (venue.ethSide !== "native" || (venue.hooks || ZERO).toLowerCase() !== ZERO || venue.direct !== true) continue;
      pools.push({
        id: venue.poolId,
        currency0: ZERO,
        currency1: token.address,
        fee: venue.fee,
        tickSpacing: venue.tickSpacing,
        hooks: ZERO,
        hookData: "0x",
        sourceType: "direct",
        initializationBlock: venue.initializationBlock,
        symbol: token.symbol,
        roundTripLossBps: rt,
      });
      admitted.v4.push(`${venue.fee}/${venue.tickSpacing} rt ${rt}bps`);
    } else if (venue.venue === "uniswap-v3") {
      v3Pools.push({ symbol: token.symbol, token: token.address, pool: venue.pool, fee: venue.fee, roundTripLossBps: rt });
      admitted.v3.push(`${venue.fee} rt ${rt}bps`);
    }
  }
  summary.push(admitted);
}

pools.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.roundTripLossBps - b.roundTripLossBps);
const registry = {
  chainId: MAINNET.chainId,
  poolManager: MAINNET.uniswapV4.poolManager,
  generatedAt: new Date().toISOString(),
  fromBlock: 0,
  toBlock: report.blockNumber,
  sourceReport: "deployments/mainnet/liquidity-report.json",
  admission: { maxRoundTripLossBps: MAX_RT_BPS, maxBuyImpactBps: MAX_IMPACT_BPS, hookless: true, nativeEthOnly: true, doNotRecord: [...DO_NOT_RECORD] },
  pools,
  v3ReferencePools: v3Pools,
};
fs.writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, outputPath)}: ${pools.length} v4 pools, ${v3Pools.length} v3 reference pools (block ${report.blockNumber})`);
for (const row of summary) {
  console.log(`  ${row.symbol.padEnd(6)} ${row.excluded ? `EXCLUDED (${row.excluded})` : `v4 [${row.v4.join(", ") || "-"}]  v3 [${row.v3.join(", ") || "-"}]`}`);
}
