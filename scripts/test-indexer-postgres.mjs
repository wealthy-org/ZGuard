import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import postgres from "postgres";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for the destructive PostgreSQL integration test");
const parsedUrl = new URL(databaseUrl);
if (process.env.PERM_ALLOW_TEST_DATABASE !== "1" && !parsedUrl.pathname.toLowerCase().includes("test")) {
  throw new Error("Refusing to run against a database whose name does not contain 'test'");
}

const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  ssl: process.env.PGSSLMODE === "disable" ? false : "require",
  onnotice: () => {},
});
const schema = await readFile(new URL("../indexer/schema.sql", import.meta.url), "utf8");

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
  await sql.unsafe("DROP FUNCTION IF EXISTS perm_consume_rate_limit(TEXT,DOUBLE PRECISION,DOUBLE PRECISION)");
  await sql.unsafe("DROP TABLE IF EXISTS perm_rate_limits,perm_route_steps,perm_settlements,perm_indexer_state CASCADE");
  // Exercise the same whole-file simple-query migration path used by the indexer.
  await sql.unsafe(schema);
  await sql.unsafe(schema);

  const rateKey = "a".repeat(64);
  const [firstLimit] = await sql`SELECT allowed,retry_after FROM perm_consume_rate_limit(${rateKey},2,0.01)`;
  const [secondLimit] = await sql`SELECT allowed,retry_after FROM perm_consume_rate_limit(${rateKey},2,0.01)`;
  const [thirdLimit] = await sql`SELECT allowed,retry_after FROM perm_consume_rate_limit(${rateKey},2,0.01)`;
  assert.equal(firstLimit.allowed, true);
  assert.equal(secondLimit.allowed, true);
  assert.equal(thirdLimit.allowed, false);
  assert(Number(thirdLimit.retry_after) >= 1);
  await assert.rejects(sql`SELECT * FROM perm_consume_rate_limit('raw-ip',2,1)`, /invalid rate-limit key hash/i);

  const columns = await sql`
    SELECT table_name,column_name
    FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name IN ('perm_settlements','perm_route_steps')
  `;
  const names = new Set(columns.map((row) => `${row.table_name}.${row.column_name}`));
  for (const expected of [
    "perm_settlements.block_hash",
    "perm_route_steps.block_hash",
    "perm_route_steps.hook_codehash",
  ]) assert(names.has(expected), `missing migration column ${expected}`);

  await sql.begin(async (tx) => {
    // RouteStepSettled is emitted before SwapSettled; the deferred FK must permit this order.
    await tx`
      INSERT INTO perm_route_steps (
        chain_id,router,transaction_hash,log_index,block_number,block_hash,receipt_id,step_index,
        provider_id,adapter,token_in,token_out,amount_in,amount_out,step_route_id,hook,hook_codehash
      ) VALUES (
        ${chainId},${router},${txHash},0,100,${blockHash},${receiptId},0,
        ${providerId},${adapter},${tokenIn},${tokenOut},1000,997,${routeId},${hook},${hookCodehash}
      )
    `;
    await tx`
      INSERT INTO perm_settlements (
        chain_id,router,router_version,transaction_hash,log_index,block_number,block_hash,block_timestamp,
        receipt_id,quote_id,account,recipient,token_in,token_out,amount_in,routed_input,amount_out,
        gross_fee,rebate,net_fee,referral_fee,treasury_fee,policy_version,route_id,route_hash,legacy
      ) VALUES (
        ${chainId},${router},2,${txHash},1,100,${blockHash},1700000000,
        ${receiptId},${quoteId},${account},${recipient},${tokenIn},${tokenOut},${maxNumeric},998,997,
        2,0,2,1,1,1,${routeId},${routeHash},FALSE
      )
    `;
  });

  const [settlement] = await sql`
    SELECT amount_in::text,block_hash,route_hash FROM perm_settlements
    WHERE chain_id=${chainId} AND router=${router} AND transaction_hash=${txHash}
  `;
  assert.equal(settlement.amount_in, maxNumeric);
  assert.equal(settlement.block_hash, blockHash);
  assert.equal(settlement.route_hash, routeHash);

  const [step] = await sql`
    SELECT hook_codehash,block_hash FROM perm_route_steps
    WHERE chain_id=${chainId} AND router=${router} AND receipt_id=${receiptId}
  `;
  assert.equal(step.hook_codehash, hookCodehash);
  assert.equal(step.block_hash, blockHash);

  await sql`
    INSERT INTO perm_indexer_state (chain_id,router,key,value)
    VALUES (${chainId},${router},'lastIndexedBlock','100')
    ON CONFLICT (chain_id,router,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()
  `;
  await sql`
    INSERT INTO perm_indexer_state (chain_id,router,key,value)
    VALUES (${chainId},${router},'lastIndexedBlock','101')
    ON CONFLICT (chain_id,router,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()
  `;
  const [state] = await sql`
    SELECT value FROM perm_indexer_state
    WHERE chain_id=${chainId} AND router=${router} AND key='lastIndexedBlock'
  `;
  assert.equal(state.value, "101");

  await assert.rejects(sql.begin(async (tx) => {
    await tx`
      INSERT INTO perm_route_steps (
        chain_id,router,transaction_hash,log_index,block_number,block_hash,receipt_id,step_index,
        provider_id,adapter,token_in,token_out,amount_in,amount_out,step_route_id,hook,hook_codehash
      ) VALUES (
        ${chainId},${router},${`0x${"ef".repeat(32)}`},9,102,${blockHash},${`0x${"f0".repeat(32)}`},1,
        ${providerId},${adapter},${tokenIn},${tokenOut},1,1,${routeId},${hook},${hookCodehash}
      )
    `;
  }), /foreign key constraint/i);

  await sql`DELETE FROM perm_settlements WHERE chain_id=${chainId} AND router=${router} AND transaction_hash=${txHash}`;
  const [cascaded] = await sql`SELECT COUNT(*)::int AS count FROM perm_route_steps`;
  assert.equal(cascaded.count, 0);

  console.log("PostgreSQL schema: whole-file idempotency, shared token bucket, 78-digit numerics, deferred evidence FK, state upsert, and cascade passed");
} finally {
  await sql.end({ timeout: 2 });
}
