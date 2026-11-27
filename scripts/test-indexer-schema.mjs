import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const schema = await readFile(new URL("../indexer/schema.sql", import.meta.url), "utf8");
const db = new PGlite();

const chainId = 46630;
const router = `0x${"aa".repeat(20)}`;
const txHash = `0x${"11".repeat(32)}`;
const blockHash = `0x${"12".repeat(32)}`;
const receiptId = `0x${"22".repeat(32)}`;
const quoteId = `0x${"33".repeat(32)}`;
const account = `0x${"44".repeat(20)}`;
const recipient = `0x${"55".repeat(20)}`;
const tokenIn = `0x${"66".repeat(20)}`;
const tokenOut = `0x${"77".repeat(20)}`;
const adapter = `0x${"88".repeat(20)}`;
const providerId = `0x${"99".repeat(32)}`;
const routeId = `0x${"ab".repeat(32)}`;
const routeHash = `0x${"bc".repeat(32)}`;
const hook = `0x${"cd".repeat(20)}`;
const hookCodehash = `0x${"de".repeat(32)}`;
const maxNumeric = "9".repeat(78);

try {
  // The checked-in migration must be safe to run repeatedly on an existing database.
  await db.exec(schema);
  await db.exec(schema);

  const rateKey = "a".repeat(64);
  const firstLimit = await db.query("SELECT allowed,retry_after FROM perm_consume_rate_limit($1,2,0.01)", [rateKey]);
  const secondLimit = await db.query("SELECT allowed,retry_after FROM perm_consume_rate_limit($1,2,0.01)", [rateKey]);
  const thirdLimit = await db.query("SELECT allowed,retry_after FROM perm_consume_rate_limit($1,2,0.01)", [rateKey]);
  assert.equal(firstLimit.rows[0].allowed, true);
  assert.equal(secondLimit.rows[0].allowed, true);
  assert.equal(thirdLimit.rows[0].allowed, false);
  assert(Number(thirdLimit.rows[0].retry_after) >= 1);
  await assert.rejects(db.query("SELECT * FROM perm_consume_rate_limit('raw-ip',2,1)"), /invalid rate-limit key hash/i);

  const columns = await db.query(`
    SELECT table_name,column_name
    FROM information_schema.columns
    WHERE table_name IN ('perm_settlements','perm_route_steps')
  `);
  const names = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const expected of [
    "perm_settlements.block_hash",
    "perm_route_steps.block_hash",
    "perm_route_steps.hook_codehash",
  ]) assert(names.has(expected), `missing migration column ${expected}`);

  // RouteStepSettled precedes SwapSettled in a transaction. The deferred FK must allow
  // that event order while still rejecting orphan route evidence at commit.
  await db.exec("BEGIN");
  await db.query(`
    INSERT INTO perm_route_steps (
      chain_id,router,transaction_hash,log_index,block_number,block_hash,receipt_id,step_index,
      provider_id,adapter,token_in,token_out,amount_in,amount_out,step_route_id,hook,hook_codehash
    ) VALUES ($1,$2,$3,0,100,$4,$5,0,$6,$7,$8,$9,1000,997,$10,$11,$12)
  `, [chainId, router, txHash, blockHash, receiptId, providerId, adapter, tokenIn, tokenOut, routeId, hook, hookCodehash]);
  await db.query(`
    INSERT INTO perm_settlements (
      chain_id,router,router_version,transaction_hash,log_index,block_number,block_hash,block_timestamp,
      receipt_id,quote_id,account,recipient,token_in,token_out,amount_in,routed_input,amount_out,
      gross_fee,rebate,net_fee,referral_fee,treasury_fee,policy_version,route_id,route_hash,legacy
    ) VALUES ($1,$2,2,$3,1,100,$4,1700000000,$5,$6,$7,$8,$9,$10,$11,998,997,2,0,2,1,1,1,$12,$13,FALSE)
  `, [chainId, router, txHash, blockHash, receiptId, quoteId, account, recipient, tokenIn, tokenOut, maxNumeric, routeId, routeHash]);
  await db.exec("COMMIT");

  const settlement = await db.query(`
    SELECT amount_in,block_hash,route_hash FROM perm_settlements
    WHERE chain_id=$1 AND router=$2 AND transaction_hash=$3
  `, [chainId, router, txHash]);
  assert.equal(settlement.rows.length, 1);
  assert.equal(String(settlement.rows[0].amount_in), maxNumeric);
  assert.equal(settlement.rows[0].block_hash, blockHash);
  assert.equal(settlement.rows[0].route_hash, routeHash);

  const step = await db.query(`
    SELECT hook_codehash,block_hash FROM perm_route_steps
    WHERE chain_id=$1 AND router=$2 AND receipt_id=$3
  `, [chainId, router, receiptId]);
  assert.equal(step.rows.length, 1);
  assert.equal(step.rows[0].hook_codehash, hookCodehash);
  assert.equal(step.rows[0].block_hash, blockHash);

  await db.query(`
    INSERT INTO perm_indexer_state (chain_id,router,key,value)
    VALUES ($1,$2,'lastIndexedBlock','100')
    ON CONFLICT (chain_id,router,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()
  `, [chainId, router]);
  await db.query(`
    INSERT INTO perm_indexer_state (chain_id,router,key,value)
    VALUES ($1,$2,'lastIndexedBlock','101')
    ON CONFLICT (chain_id,router,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()
  `, [chainId, router]);
  const state = await db.query("SELECT value FROM perm_indexer_state WHERE chain_id=$1 AND router=$2 AND key='lastIndexedBlock'", [chainId, router]);
  assert.equal(state.rows[0].value, "101");

  await db.exec("BEGIN");
  await db.query(`
    INSERT INTO perm_route_steps (
      chain_id,router,transaction_hash,log_index,block_number,block_hash,receipt_id,step_index,
      provider_id,adapter,token_in,token_out,amount_in,amount_out,step_route_id,hook,hook_codehash
    ) VALUES ($1,$2,$3,9,102,$4,$5,1,$6,$7,$8,$9,1,1,$10,$11,$12)
  `, [chainId, router, `0x${"ef".repeat(32)}`, blockHash, `0x${"f0".repeat(32)}`, providerId, adapter, tokenIn, tokenOut, routeId, hook, hookCodehash]);
  await assert.rejects(db.exec("COMMIT"), /foreign key constraint/i);
  await db.exec("ROLLBACK").catch(() => undefined);

  await db.query("DELETE FROM perm_settlements WHERE chain_id=$1 AND router=$2 AND transaction_hash=$3", [chainId, router, txHash]);
  const cascaded = await db.query("SELECT COUNT(*)::int AS count FROM perm_route_steps");
  assert.equal(cascaded.rows[0].count, 0);

  console.log("Indexer schema: idempotent migration, shared token bucket, 78-digit numerics, deferred evidence FK, state upsert, and cascade passed");
} finally {
  await db.close();
}
