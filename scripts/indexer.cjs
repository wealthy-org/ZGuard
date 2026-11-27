#!/usr/bin/env node
/** Durable PostgreSQL indexer for official Perm settlement and route-step events.
 * Run once from cron (default) or continuously with INDEXER_WATCH=1. */
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
const { createPublicClient, decodeEventLog, defineChain, http, parseAbi } = require("viem");
const { loadIndexerTarget } = require("./lib/indexer-target.cjs");

const root = path.resolve(__dirname, "..");
const { manifest, mode: indexerMode } = loadIndexerTarget({ root });
const databaseUrl = process.env.DATABASE_URL || process.env.PERM_INDEXER_DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL or PERM_INDEXER_DATABASE_URL is required");
if (!manifest.permRouter || !manifest.deploymentBlock) throw new Error("Indexer router and deployment block are required");

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name] || String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return value;
}

const rpcUrl = process.env.RH_TESTNET_RPC_URL || manifest.rpcUrl;
const chain = defineChain({ id: manifest.chainId, name: manifest.network, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } });
const client = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 3 }) });
const poolSize = boundedInteger("INDEXER_DB_POOL_SIZE", 3, 1, 20);
const confirmations = BigInt(boundedInteger("INDEXER_CONFIRMATIONS", 12, 1, 10_000));
const reorgDepth = BigInt(boundedInteger("INDEXER_REORG_DEPTH", 100, 1, 100_000));
const chunkSize = BigInt(boundedInteger("INDEXER_CHUNK_SIZE", 10_000, 1, 10_000));
const pollMs = boundedInteger("INDEXER_POLL_MS", 15_000, 1_000, 3_600_000);
const sql = postgres(databaseUrl, {
  max: poolSize,
  idle_timeout: 20,
  connect_timeout: 15,
  ssl: process.env.PGSSLMODE === "disable" ? false : "require",
  onnotice: () => {},
});
const router = manifest.permRouter.toLowerCase();
const v2Abi = require(path.join(root, "lib/web3/artifacts/PermRouter.json")).abi;
const v1Abi = parseAbi([
  "event SwapSettled(bytes32 indexed receiptId,bytes32 indexed quoteId,address indexed account,address recipient,address tokenIn,address tokenOut,uint256 amountIn,uint256 routedInput,uint256 amountOut,uint256 grossFee,uint256 rebate,uint256 netFee,uint256 referralFee,uint32 policyVersion,bytes32 providerId,address adapter,address hook)",
]);
const decodeAbi = manifest.routerVersion >= 2 ? v2Abi : v1Abi;
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

const asString = (value) => value === undefined || value === null ? "0" : value.toString();

async function migrate() {
  const source = fs.readFileSync(path.join(root, "indexer/schema.sql"), "utf8");
  // postgres.js sends an unparameterized unsafe string via the simple-query protocol,
  // which preserves transactional DO blocks and semicolons inside migration bodies.
  await sql.unsafe(source);
}

async function state(key) {
  const rows = await sql`SELECT value FROM perm_indexer_state WHERE chain_id=${manifest.chainId} AND router=${router} AND key=${key}`;
  return rows[0]?.value;
}

async function writeState(tx, key, value) {
  await tx`INSERT INTO perm_indexer_state (chain_id,router,key,value,updated_at)
    VALUES (${manifest.chainId},${router},${key},${value},NOW())
    ON CONFLICT (chain_id,router,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
}

async function blockTimestamps(logs) {
  const blocks = [...new Set(logs.map((log) => log.blockNumber?.toString()).filter(Boolean))];
  const values = await Promise.all(blocks.map(async (number) => [number, Number((await client.getBlock({ blockNumber: BigInt(number) })).timestamp)]));
  return new Map(values);
}

function decoded(log) {
  try { return decodeEventLog({ abi: decodeAbi, data: log.data, topics: log.topics, strict: false }); }
  catch { return undefined; }
}

async function persistChunk(fromBlock, toBlock, logs) {
  const [timestamps, tipBlock] = await Promise.all([blockTimestamps(logs), client.getBlock({ blockNumber: toBlock })]);
  await sql.begin(async (tx) => {
    for (const log of logs) {
      const event = decoded(log);
      if (!event || !log.transactionHash || log.logIndex === null || log.blockNumber === null) continue;
      const a = event.args;
      const blockTimestamp = timestamps.get(log.blockNumber.toString()) || null;
      if (event.eventName === "RouteStepSettled") {
        await tx`INSERT INTO perm_route_steps (
          chain_id,router,transaction_hash,log_index,block_number,block_hash,receipt_id,step_index,provider_id,adapter,
          token_in,token_out,amount_in,amount_out,step_route_id,hook,hook_codehash,indexed_at
        ) VALUES (
          ${manifest.chainId},${router},${log.transactionHash.toLowerCase()},${log.logIndex},${log.blockNumber.toString()},${log.blockHash},
          ${a.receiptId},${Number(a.stepIndex)},${a.providerId},${String(a.adapter).toLowerCase()},${String(a.tokenIn).toLowerCase()},
          ${String(a.tokenOut).toLowerCase()},${asString(a.amountIn)},${asString(a.amountOut)},${a.stepRouteId},${String(a.hook).toLowerCase()},${a.hookCodehash},NOW()
        ) ON CONFLICT (chain_id,router,transaction_hash,log_index) DO UPDATE SET
          block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,receipt_id=EXCLUDED.receipt_id,step_index=EXCLUDED.step_index,provider_id=EXCLUDED.provider_id,adapter=EXCLUDED.adapter,
          token_in=EXCLUDED.token_in,token_out=EXCLUDED.token_out,amount_in=EXCLUDED.amount_in,amount_out=EXCLUDED.amount_out,
          step_route_id=EXCLUDED.step_route_id,hook=EXCLUDED.hook,hook_codehash=EXCLUDED.hook_codehash,indexed_at=NOW()`;
      } else if (event.eventName === "SwapSettled") {
        const legacy = manifest.routerVersion < 2;
        await tx`INSERT INTO perm_settlements (
          chain_id,router,router_version,transaction_hash,log_index,block_number,block_hash,block_timestamp,receipt_id,quote_id,account,
          recipient,token_in,token_out,amount_in,routed_input,amount_out,gross_fee,rebate,net_fee,referral_fee,treasury_fee,
          policy_version,route_id,route_hash,legacy,indexed_at
        ) VALUES (
          ${manifest.chainId},${router},${manifest.routerVersion},${log.transactionHash.toLowerCase()},${log.logIndex},${log.blockNumber.toString()},${log.blockHash},${blockTimestamp},
          ${a.receiptId},${a.quoteId},${String(a.account).toLowerCase()},${String(a.recipient).toLowerCase()},${String(a.tokenIn).toLowerCase()},
          ${String(a.tokenOut).toLowerCase()},${asString(a.amountIn)},${asString(a.routedInput)},${asString(a.amountOut)},${asString(a.grossFee)},
          ${asString(a.rebate)},${asString(a.netFee)},${asString(a.referralFee)},${legacy ? "0" : asString(a.treasuryFee)},${Number(a.policyVersion)},
          ${legacy ? a.providerId : a.routeId},${legacy ? null : a.routeHash},${legacy},NOW()
        ) ON CONFLICT (chain_id,router,transaction_hash,log_index) DO UPDATE SET
          block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash,block_timestamp=EXCLUDED.block_timestamp,receipt_id=EXCLUDED.receipt_id,quote_id=EXCLUDED.quote_id,
          account=EXCLUDED.account,recipient=EXCLUDED.recipient,token_in=EXCLUDED.token_in,token_out=EXCLUDED.token_out,
          amount_in=EXCLUDED.amount_in,routed_input=EXCLUDED.routed_input,amount_out=EXCLUDED.amount_out,gross_fee=EXCLUDED.gross_fee,
          rebate=EXCLUDED.rebate,net_fee=EXCLUDED.net_fee,referral_fee=EXCLUDED.referral_fee,treasury_fee=EXCLUDED.treasury_fee,
          policy_version=EXCLUDED.policy_version,route_id=EXCLUDED.route_id,route_hash=EXCLUDED.route_hash,legacy=EXCLUDED.legacy,indexed_at=NOW()`;
      }
    }
    await writeState(tx, "lastIndexedBlock", toBlock.toString());
    await writeState(tx, "lastIndexedBlockHash", tipBlock.hash);
    await writeState(tx, "lastIndexedAt", new Date().toISOString());
  });
  console.log(`indexed ${fromBlock}-${toBlock}: ${logs.length} router logs`);
}

async function syncOnce() {
  const latest = await client.getBlockNumber();
  const safeTip = latest > confirmations ? latest - confirmations : 0n;
  const forcedTip = process.env.INDEXER_TO_BLOCK
    ? BigInt(boundedInteger("INDEXER_TO_BLOCK", 0, 0, Number.MAX_SAFE_INTEGER))
    : safeTip;
  const target = forcedTip < safeTip ? forcedTip : safeTip;
  let saved = await state("lastIndexedBlock");
  let savedHash = await state("lastIndexedBlockHash");
  if (saved && !savedHash) {
    const savedBlock = BigInt(saved);
    if (savedBlock > latest) throw new Error(`Indexer cursor ${savedBlock} is ahead of RPC tip ${latest}`);
    const canonical = await client.getBlock({ blockNumber: savedBlock });
    await sql.begin((tx) => writeState(tx, "lastIndexedBlockHash", canonical.hash));
    savedHash = canonical.hash;
  }
  if (saved && savedHash) {
    const savedBlock = BigInt(saved);
    if (savedBlock > latest) throw new Error(`Indexer cursor ${savedBlock} is ahead of RPC tip ${latest}`);
    const canonical = await client.getBlock({ blockNumber: savedBlock });
    if (canonical.hash.toLowerCase() !== savedHash.toLowerCase()) {
      const floor = BigInt(manifest.deploymentBlock) - 1n;
      const rewind = savedBlock > reorgDepth && savedBlock - reorgDepth > floor ? savedBlock - reorgDepth : floor;
      const rewindBlock = await client.getBlock({ blockNumber: rewind });
      await sql.begin(async (tx) => {
        await tx`DELETE FROM perm_route_steps WHERE chain_id=${manifest.chainId} AND router=${router} AND block_number > ${rewind.toString()}`;
        await tx`DELETE FROM perm_settlements WHERE chain_id=${manifest.chainId} AND router=${router} AND block_number > ${rewind.toString()}`;
        await writeState(tx, "lastIndexedBlock", rewind.toString());
        await writeState(tx, "lastIndexedBlockHash", rewindBlock.hash);
        await writeState(tx, "lastReorgDetectedAt", new Date().toISOString());
      });
      console.warn(`chain reorg detected at ${savedBlock}; rewound index to ${rewind}`);
      saved = rewind.toString();
    }
  }
  let fromBlock = saved ? BigInt(saved) + 1n : BigInt(manifest.deploymentBlock);
  if (fromBlock > target) {
    console.log(`indexer current at ${saved || "uninitialized"}; safe tip ${target}`);
    return;
  }
  while (fromBlock <= target && !stopping) {
    const toBlock = fromBlock + chunkSize - 1n > target ? target : fromBlock + chunkSize - 1n;
    const logs = await client.getLogs({ address: manifest.permRouter, fromBlock, toBlock });
    await persistChunk(fromBlock, toBlock, logs);
    fromBlock = toBlock + 1n;
  }
}

async function main() {
  console.log(`indexer target ${indexerMode}: chain ${manifest.chainId}, Router v${manifest.routerVersion}, ${manifest.permRouter}, deployment block ${manifest.deploymentBlock}`);
  await migrate();
  do {
    await syncOnce();
    if (!process.env.INDEXER_WATCH || process.env.INDEXER_WATCH === "0" || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (!stopping);
  await sql.end({ timeout: 5 });
}

main().catch(async (error) => {
  console.error(error.shortMessage || error.message || error);
  try { await sql.end({ timeout: 1 }); } catch {}
  process.exitCode = 1;
});
