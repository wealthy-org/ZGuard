import postgres, { type Sql } from "postgres";
import type { Address } from "viem";
import { PERM_ROUTER_ADDRESS, PERM_CHAIN_ID } from "@/lib/web3/config";

type GlobalIndexer = typeof globalThis & { __permIndexerSql?: Sql };
const connectionString = process.env.DATABASE_URL || process.env.PERM_INDEXER_DATABASE_URL;

function database() {
  if (!connectionString) return undefined;
  const global = globalThis as GlobalIndexer;
  global.__permIndexerSql ??= postgres(connectionString, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: process.env.PGSSLMODE === "disable" ? false : "require",
  });
  return global.__permIndexerSql;
}

export function indexedHistoryAvailable() {
  return Boolean(connectionString && PERM_ROUTER_ADDRESS);
}

export async function readIndexedHistory(
  account: Address | undefined,
  before: { blockNumber: bigint; logIndex?: number } | undefined,
  limit = 50,
) {
  const sql = database();
  if (!sql || !PERM_ROUTER_ADDRESS) return undefined;
  const accountFilter = account ? sql`AND account=${account.toLowerCase()}` : sql``;
  const cursorFilter = before === undefined
    ? sql``
    : before.logIndex === undefined
      ? sql`AND block_number < ${before.blockNumber.toString()}`
      : sql`AND (block_number < ${before.blockNumber.toString()} OR (block_number = ${before.blockNumber.toString()} AND log_index < ${before.logIndex}))`;
  const rows = await sql<Array<Record<string, string | number | boolean | null>>>`
    SELECT transaction_hash,log_index,block_number,block_timestamp,receipt_id,quote_id,account,recipient,
      token_in,token_out,amount_in,routed_input,amount_out,gross_fee,rebate,net_fee,referral_fee,treasury_fee,
      policy_version,route_id,route_hash,legacy
    FROM perm_settlements
    WHERE chain_id=${PERM_CHAIN_ID} AND router=${PERM_ROUTER_ADDRESS.toLowerCase()}
      ${accountFilter} ${cursorFilter}
    ORDER BY block_number DESC,log_index DESC
    LIMIT ${Math.max(1, Math.min(limit, 100))}
  `;
  const items = rows.map((row) => ({
    transactionHash: row.transaction_hash,
    logIndex: Number(row.log_index),
    blockNumber: String(row.block_number),
    blockTimestamp: row.block_timestamp === null ? null : Number(row.block_timestamp),
    receiptId: row.receipt_id,
    quoteId: row.quote_id,
    account: row.account,
    recipient: row.recipient,
    tokenIn: row.token_in,
    tokenOut: row.token_out,
    amountIn: String(row.amount_in),
    routedInput: String(row.routed_input),
    amountOut: String(row.amount_out),
    grossFee: String(row.gross_fee),
    rebate: String(row.rebate),
    netFee: String(row.net_fee),
    referralFee: String(row.referral_fee),
    treasuryFee: String(row.treasury_fee),
    policyVersion: Number(row.policy_version),
    routeId: row.route_id,
    routeHash: row.route_hash,
    legacy: Boolean(row.legacy),
  }));
  const stateRows = await sql<Array<{ value: string }>>`
    SELECT value FROM perm_indexer_state
    WHERE chain_id=${PERM_CHAIN_ID} AND router=${PERM_ROUTER_ADDRESS.toLowerCase()} AND key='lastIndexedBlock'
  `;
  return {
    items,
    indexedThrough: stateRows[0]?.value || null,
    nextBefore: items.length === Math.max(1, Math.min(limit, 100))
      ? items.at(-1) ? `${items.at(-1)?.blockNumber}:${items.at(-1)?.logIndex}` : null
      : null,
  };
}

export async function indexerHealth() {
  const sql = database();
  if (!sql || !PERM_ROUTER_ADDRESS) return undefined;
  const rows = await sql<Array<{ key: string; value: string; updated_at: Date }>>`
    SELECT key,value,updated_at FROM perm_indexer_state
    WHERE chain_id=${PERM_CHAIN_ID} AND router=${PERM_ROUTER_ADDRESS.toLowerCase()}
      AND key IN ('lastIndexedBlock','lastIndexedBlockHash','lastReorgDetectedAt')
  `;
  const values = new Map(rows.map((row) => [row.key, row]));
  const cursor = values.get("lastIndexedBlock");
  return cursor ? {
    lastIndexedBlock: cursor.value,
    lastIndexedBlockHash: values.get("lastIndexedBlockHash")?.value || null,
    lastReorgDetectedAt: values.get("lastReorgDetectedAt")?.value || null,
    updatedAt: cursor.updated_at.toISOString(),
  } : null;
}
