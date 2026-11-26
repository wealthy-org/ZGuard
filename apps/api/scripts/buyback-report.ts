/**
 * §9.9 buyback ledger, reconciled with the chain.
 *
 *   ../../node_modules/.bin/tsx scripts/buyback-report.ts [--chain 46630] [--from-block N] [--json]
 *
 * Reads the same env as the API (ZGUARD_X402_PAY_TO, ZGUARD_BUYBACK_WALLET, ZGUARD_PONS_TOKEN_ADDRESS,
 * ZGUARD_BURN_ADDRESS, ZGUARD_BUYBACK_REVENUE_BPS) and reports:
 *   1. Fee receipts: every USDG `Transfer` into the pay-to treasury (tx hash, block, sender, amount).
 *   2. Ledger (optional): ZGUARD_API_URL + ZGUARD_ADMIN_API_KEY → GET /v1/receipts (admin-global) gives
 *      total charged and the buyback share accrued per call (receipts × ZGUARD_BUYBACK_REVENUE_BPS).
 *   3. Buyback execution (once the product token exists): USDG leaving the buyback wallet (the buy) and
 *      product-token transfers from the buyback wallet to the burn address (the burn), each with its tx.
 * Every number is traceable to a tx hash. Exit 1 when the buyback config is invalid.
 */
import { createPublicClient, http, pad, type Hex } from "viem";
import { getRhcChainProfile } from "@zguard/sdk";
import { loadConfig, resolveBuybackConfig, resolvePayTo } from "../src/config.js";

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MAX_SPAN = 5_000_000n;

type Log = { blockNumber: Hex; transactionHash: Hex; topics: Hex[]; data: Hex };
type Row = { block: string; tx: string; from: string; to: string; amount: string };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const fmt = (micro: bigint, decimals: number) => {
  const neg = micro < 0n;
  const v = neg ? -micro : micro;
  const s = v.toString().padStart(decimals + 1, "0");
  return `${neg ? "-" : ""}${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
};

(async () => {
  const chainId = Number(arg("--chain") ?? process.env.ZGUARD_ACTIVE_CHAIN_ID ?? 46630);
  const asJson = process.argv.includes("--json");
  const config = loadConfig({ ...process.env, DATABASE_URL: "", ZGUARD_ACTIVE_CHAIN_ID: String(chainId) });
  const profile = getRhcChainProfile(chainId);
  const buyback = resolveBuybackConfig(process.env);
  const payTo = resolvePayTo(process.env, true);

  const rpc =
    chainId === 4663
      ? process.env.ZGUARD_RHC_MAINNET_RPC_URL || "https://rpc.mainnet.chain.robinhood.com"
      : process.env.ZGUARD_RHC_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
  const client = createPublicClient({ transport: http(rpc, { timeout: 30_000 }) });
  const head = await client.getBlockNumber();
  const fromBlock = arg("--from-block") ? BigInt(arg("--from-block")!) : head > MAX_SPAN * 4n ? head - MAX_SPAN * 4n : 0n;

  async function transfers(token: string, from: string | null, to: string | null): Promise<Row[]> {
    const topics: (Hex | null)[] = [TRANSFER, from ? pad(from.toLowerCase() as Hex) : null, to ? pad(to.toLowerCase() as Hex) : null];
    const rows: Row[] = [];
    let start = fromBlock;
    let span = MAX_SPAN;
    while (start <= head) {
      const end = start + span - 1n > head ? head : start + span - 1n;
      try {
        const logs = (await client.request({
          method: "eth_getLogs",
          params: [{ address: token as Hex, topics, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }],
        } as never)) as Log[];
        for (const l of logs) {
          rows.push({
            block: BigInt(l.blockNumber).toString(),
            tx: l.transactionHash,
            from: `0x${l.topics[1]!.slice(26)}`,
            to: `0x${l.topics[2]!.slice(26)}`,
            amount: BigInt(l.data).toString(),
          });
        }
        start = end + 1n;
      } catch (err) {
        if (span <= 10_000n) throw err;
        span /= 4n; // RPC range limit: retry smaller
      }
    }
    return rows;
  }

  const receipts = payTo.x402PayToError ? [] : await transfers(profile.usdgAddress, null, config.x402PayTo);
  const received = receipts.reduce((a, r) => a + BigInt(r.amount), 0n);

  let ledger: { totalChargedMicroUsdg: string; totalBuybackMicroUsdg: string; receiptCount: number } | null = null;
  let ledgerNote = "set ZGUARD_API_URL + ZGUARD_ADMIN_API_KEY to include the per-call ledger";
  const apiUrl = process.env.ZGUARD_API_URL?.replace(/\/+$/, "");
  if (apiUrl && process.env.ZGUARD_ADMIN_API_KEY) {
    if (!apiUrl.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(apiUrl)) {
      ledgerNote = "refusing to send the admin key over plain http";
    } else {
      const res = await fetch(`${apiUrl}/v1/receipts?limit=1`, { headers: { "x-admin-key": process.env.ZGUARD_ADMIN_API_KEY } });
      if (res.ok) {
        ledger = ((await res.json()) as { revenue: typeof ledger }).revenue;
        ledgerNote = "admin-global ledger from /v1/receipts";
      } else {
        ledgerNote = `ledger unavailable (HTTP ${res.status})`;
      }
    }
  }

  let buys: Row[] = [];
  let burns: Row[] = [];
  if (buyback.buybackWallet) {
    buys = await transfers(profile.usdgAddress, buyback.buybackWallet, null);
    if (buyback.ponsTokenAddress) burns = await transfers(buyback.ponsTokenAddress, buyback.buybackWallet, buyback.burnAddress);
  }
  const spent = buys.reduce((a, r) => a + BigInt(r.amount), 0n);
  const burned = burns.reduce((a, r) => a + BigInt(r.amount), 0n);
  const accrued = ledger ? BigInt(ledger.totalBuybackMicroUsdg) : null;

  const report = {
    network: `eip155:${chainId}`,
    blocks: { from: fromBlock.toString(), to: head.toString() },
    config: {
      payTo: payTo.x402PayToError ? null : config.x402PayTo,
      payToError: payTo.x402PayToError,
      buybackWallet: buyback.buybackWallet,
      productToken: buyback.ponsTokenAddress,
      burnAddress: buyback.burnAddress,
      buybackRevenueBps: buyback.buybackRevenueBps,
      errors: buyback.buybackConfigErrors,
    },
    feeReceipts: { count: receipts.length, totalMicroUsdg: received.toString(), rows: receipts },
    ledger: ledger ?? { note: ledgerNote },
    buyback: {
      accruedMicroUsdg: accrued?.toString() ?? null,
      spentOnBuysMicroUsdg: spent.toString(),
      outstandingMicroUsdg: accrued !== null ? (accrued - spent).toString() : null,
      buys,
      burnedTokenUnits: burned.toString(),
      burns,
      status: !buyback.ponsTokenAddress
        ? "product token not launched yet: buyback accrues in the ledger only (brief: automatic buyback is Phase 2)"
        : burns.length === 0
          ? "token set, no burn transfer yet"
          : "buyback executed; every unit traces to a buy tx and a burn transfer",
    },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`§9.9 buyback report · ${report.network} · blocks ${report.blocks.from}..${report.blocks.to}`);
    console.log(`  pay-to treasury : ${report.config.payTo ?? `INVALID (${report.config.payToError})`}`);
    console.log(`  buyback wallet  : ${report.config.buybackWallet ?? "not set"}`);
    console.log(`  product token   : ${report.config.productToken ?? "not launched"} · burn ${report.config.burnAddress} · ${report.config.buybackRevenueBps / 100}% of revenue`);
    for (const e of report.config.errors) console.log(`  CONFIG ERROR    : ${e}`);
    console.log(`  fee receipts    : ${receipts.length} transfer(s), ${fmt(received, 6)} USDG`);
    for (const r of receipts) console.log(`    block ${r.block}  ${r.tx}  from ${r.from}  ${fmt(BigInt(r.amount), 6)} USDG`);
    console.log(
      ledger
        ? `  ledger          : charged ${fmt(BigInt(ledger.totalChargedMicroUsdg), 6)} USDG over ${ledger.receiptCount} call(s), buyback accrued ${fmt(BigInt(ledger.totalBuybackMicroUsdg), 6)} USDG`
        : `  ledger          : ${ledgerNote}`
    );
    console.log(`  buys            : ${buys.length} tx, ${fmt(spent, 6)} USDG${accrued !== null ? ` · outstanding ${fmt(accrued - spent, 6)} USDG` : ""}`);
    for (const r of buys) console.log(`    block ${r.block}  ${r.tx}  → ${r.to}  ${fmt(BigInt(r.amount), 6)} USDG`);
    console.log(`  burns           : ${burns.length} tx, ${burned.toString()} token units`);
    for (const r of burns) console.log(`    block ${r.block}  ${r.tx}  ${r.amount}`);
    console.log(`  status          : ${report.buyback.status}`);
  }
  process.exit(buyback.buybackConfigErrors.length || payTo.x402PayToError ? 1 : 0);
})().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
