#!/usr/bin/env node
/** Monitors the explicitly non-release allowlisted Router-v2 staging stack.
 * This does not evaluate, grant, or imply production release readiness. */
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
const {
  ALLOWLISTED_STAGING_INDEXER_MODE,
  loadIndexerTarget,
} = require("./lib/indexer-target.cjs");

const root = path.resolve(__dirname, "..");
const { manifest, mode } = loadIndexerTarget({ root });
if (mode !== ALLOWLISTED_STAGING_INDEXER_MODE || manifest.nonRelease !== true || manifest.executionReady !== false) {
  throw new Error("The staging monitor requires the explicit non-release allowlisted indexer target");
}

function required(condition, message) {
  if (!condition) throw new Error(message);
}

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name] ?? String(fallback);
  required(/^\d+$/.test(raw), `${name} must be an integer`);
  const value = Number(raw);
  required(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    `${name} must be between ${minimum} and ${maximum}`);
  return value;
}

function httpsUrl(name, value) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be a valid URL`); }
  required(parsed.protocol === "https:" && !parsed.username && !parsed.password,
    `${name} must be a credential-free HTTPS URL`);
  return parsed;
}

const stagingUrl = httpsUrl("PERM_STAGING_URL", process.env.PERM_STAGING_URL);
const primaryRpc = httpsUrl("RH_TESTNET_RPC_URL", process.env.RH_TESTNET_RPC_URL);
const fallbackRpc = httpsUrl("RH_TESTNET_FALLBACK_RPC_URL", process.env.RH_TESTNET_FALLBACK_RPC_URL);
required(primaryRpc.href !== fallbackRpc.href, "Primary and fallback RPC URLs must be different");
const alertWebhook = httpsUrl("PERM_ALERT_WEBHOOK_URL", process.env.PERM_ALERT_WEBHOOK_URL);
const databaseUrl = process.env.DATABASE_URL || process.env.PERM_INDEXER_DATABASE_URL;
required(databaseUrl, "DATABASE_URL or PERM_INDEXER_DATABASE_URL is required");
let parsedDatabase;
try { parsedDatabase = new URL(databaseUrl); } catch { throw new Error("Indexer database URL is invalid"); }
required(["postgres:", "postgresql:"].includes(parsedDatabase.protocol), "Indexer database must use PostgreSQL");

const maxBlockLagSeconds = boundedInteger("MONITOR_MAX_BLOCK_LAG_SECONDS", 900, 1, 86_400);
const maxRpcDistance = BigInt(boundedInteger("MONITOR_MAX_RPC_BLOCK_DISTANCE", 300, 0, 1_000_000));
// The hosted staging indexer runs every five minutes on a fast-block testnet.
// These bounds tolerate one delayed scheduler interval while still alerting on a stalled cursor.
const maxIndexerBlockLag = BigInt(boundedInteger("MONITOR_MAX_INDEXER_BLOCK_LAG", 5_000, 0, 1_000_000));
const maxIndexerTimeLag = boundedInteger("MONITOR_MAX_INDEXER_TIME_LAG_SECONDS", 1_800, 1, 86_400);
const timeoutMs = boundedInteger("MONITOR_HTTP_TIMEOUT_MS", 20_000, 1_000, 60_000);
const failures = [];
const checks = {};
const redactions = [databaseUrl, primaryRpc.href, fallbackRpc.href, alertWebhook.href].sort((a, b) => b.length - a.length);

function safeMessage(cause) {
  let message = cause instanceof Error ? cause.message : String(cause);
  for (const value of redactions) message = message.split(value).join("[redacted]");
  message = message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgresql://[redacted]@");
  return message.slice(0, 500);
}

async function readJson(response, label) {
  const text = await response.text();
  required(text.length <= 1_000_000, `${label} response is too large`);
  try { return JSON.parse(text); } catch { throw new Error(`${label} returned invalid JSON`); }
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "PermStagingMonitor/1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  required(response.ok, `${method} returned HTTP ${response.status}`);
  const payload = await readJson(response, method);
  required(!payload.error && payload.result !== undefined && payload.result !== null, `${method} RPC request failed`);
  return payload.result;
}

async function inspectRpc(label, url) {
  const [chainHex, block] = await Promise.all([
    rpc(url, "eth_chainId"),
    rpc(url, "eth_getBlockByNumber", ["latest", false]),
  ]);
  const chainId = Number(BigInt(chainHex));
  const blockNumber = BigInt(block.number);
  const blockTimestamp = Number(BigInt(block.timestamp));
  const blockLagSeconds = Math.max(0, Math.floor(Date.now() / 1_000) - blockTimestamp);
  required(chainId === 46_630, `${label} RPC chain ${chainId} is not 46630`);
  required(blockLagSeconds <= maxBlockLagSeconds,
    `${label} RPC latest block is ${blockLagSeconds}s old (limit ${maxBlockLagSeconds}s)`);
  return { chainId, blockNumber, blockHash: block.hash, blockLagSeconds };
}

async function inspectHealth() {
  const request = async (query) => {
    const response = await fetch(new URL(`/api/health?${query}`, stagingUrl), {
      headers: { accept: "application/json", "user-agent": "PermStagingMonitor/1.0", "cache-control": "no-cache" },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: response.status, body: await readJson(response, `health ${query}`) };
  };
  const [staging, execution] = await Promise.all([request("requireStaging=1"), request("requireExecution=1")]);
  required(staging.status === 200, `Staging health returned HTTP ${staging.status}`);
  required(staging.body.status === "staging-ready-non-release" && staging.body.stagingReady === true,
    "Hosted staging health is not ready");
  required(staging.body.executionReady === false && staging.body.nonReleaseStaging === true,
    "Hosted staging crossed the non-release boundary");
  required(staging.body.stagingChecks?.e2eCanonical === true
    && staging.body.stagingChecks?.e2eAllowlistedAccount === true
    && staging.body.stagingChecks?.e2eDirectRoutesOnly === true,
  "Hosted staging E2E evidence is no longer canonical and direct-only");
  required(execution.status === 503 && execution.body.executionReady === false,
    "Production execution health must remain fail-closed on allowlisted staging");
  return {
    stagingHttpStatus: staging.status,
    releaseHttpStatus: execution.status,
    status: staging.body.status,
    stagingReady: staging.body.stagingReady,
    executionReady: staging.body.executionReady,
    e2eConfirmations: staging.body.stagingChecks?.e2eConfirmations || null,
  };
}

async function inspectDatabase(primary) {
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    ssl: process.env.PGSSLMODE === "disable" ? false : "require",
  });
  try {
    const rows = await sql`
      SELECT key,value,updated_at FROM perm_indexer_state
      WHERE chain_id=${manifest.chainId} AND router=${manifest.permRouter.toLowerCase()}
        AND key IN ('lastIndexedBlock','lastIndexedBlockHash')
    `;
    const state = new Map(rows.map((row) => [row.key, row]));
    const cursor = state.get("lastIndexedBlock");
    const cursorHash = state.get("lastIndexedBlockHash");
    required(cursor && cursorHash, "Staging indexer has no canonical cursor");
    const indexedBlock = BigInt(cursor.value);
    required(indexedBlock >= BigInt(manifest.deploymentBlock), "Staging indexer cursor precedes deployment");
    required(indexedBlock <= primary.blockNumber, "Staging indexer cursor is ahead of the primary RPC");
    const indexedLag = primary.blockNumber - indexedBlock;
    const updatedLagSeconds = Math.max(0, Math.floor((Date.now() - new Date(cursor.updated_at).getTime()) / 1_000));
    required(indexedLag <= maxIndexerBlockLag,
      `Staging indexer is ${indexedLag} blocks behind (limit ${maxIndexerBlockLag})`);
    required(updatedLagSeconds <= maxIndexerTimeLag,
      `Staging indexer cursor is ${updatedLagSeconds}s old (limit ${maxIndexerTimeLag}s)`);
    const canonical = await rpc(primaryRpc, "eth_getBlockByNumber", [`0x${indexedBlock.toString(16)}`, false]);
    required(canonical?.hash && canonical.hash.toLowerCase() === cursorHash.value.toLowerCase(),
      `Staging indexer cursor hash is not canonical at block ${indexedBlock}`);

    const settlementRows = await sql`
      SELECT COUNT(*)::int AS count FROM perm_settlements
      WHERE chain_id=${manifest.chainId} AND router=${manifest.permRouter.toLowerCase()}
    `;
    const settlementCount = Number(settlementRows[0]?.count || 0);
    required(settlementCount >= 1, "Staging indexer has not recorded the canonical settlement");

    const rateKey = createHash("sha256").update(`staging-monitor:${Date.now()}:${process.pid}`).digest("hex");
    const [first] = await sql`SELECT allowed,retry_after FROM perm_consume_rate_limit(${rateKey},1,0.01)`;
    const [second] = await sql`SELECT allowed,retry_after FROM perm_consume_rate_limit(${rateKey},1,0.01)`;
    required(first?.allowed === true && second?.allowed === false,
      "Shared PostgreSQL rate limiter is not operational");
    return {
      lastIndexedBlock: indexedBlock.toString(),
      lastIndexedBlockHash: cursorHash.value,
      blockLag: indexedLag.toString(),
      updatedLagSeconds,
      settlementCount,
      sharedRateLimit: true,
    };
  } finally {
    await sql.end({ timeout: 2 });
  }
}

async function sendAlert(report, test) {
  const response = await fetch(alertWebhook, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "PermStagingMonitor/1.0" },
    body: JSON.stringify({
      text: test
        ? `Perm allowlisted staging monitor test: ${report.status.toUpperCase()}`
        : `Perm allowlisted staging monitor: ${report.status.toUpperCase()} (${report.failures.length} failures)`,
      service: "perm-allowlisted-staging",
      status: report.status,
      test,
      report,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  required(response.ok, `Alert webhook returned HTTP ${response.status}`);
}

async function main() {
  let primary;
  let fallback;
  try {
    [primary, fallback] = await Promise.all([
      inspectRpc("Primary", primaryRpc),
      inspectRpc("Fallback", fallbackRpc),
    ]);
    const distance = primary.blockNumber > fallback.blockNumber
      ? primary.blockNumber - fallback.blockNumber
      : fallback.blockNumber - primary.blockNumber;
    required(distance <= maxRpcDistance, `Primary and fallback RPCs differ by ${distance} blocks`);
    checks.rpc = {
      primaryBlock: primary.blockNumber.toString(),
      fallbackBlock: fallback.blockNumber.toString(),
      blockDistance: distance.toString(),
      primaryBlockLagSeconds: primary.blockLagSeconds,
      fallbackBlockLagSeconds: fallback.blockLagSeconds,
    };
  } catch (cause) {
    failures.push(`RPC verification failed: ${safeMessage(cause)}`);
  }

  try { checks.hostedHealth = await inspectHealth(); }
  catch (cause) { failures.push(`Hosted boundary verification failed: ${safeMessage(cause)}`); }

  if (primary) {
    try { checks.database = await inspectDatabase(primary); }
    catch (cause) { failures.push(`Database verification failed: ${safeMessage(cause)}`); }
  } else {
    failures.push("Database canonicality check was skipped because the primary RPC failed");
  }

  const report = {
    status: failures.length ? "critical" : "ok",
    checkedAt: new Date().toISOString(),
    purpose: "perm-non-release-allowlisted-staging-monitor",
    nonRelease: true,
    chainId: manifest.chainId,
    routerVersion: manifest.routerVersion,
    router: manifest.permRouter,
    failures,
    checks,
  };
  const testAlert = process.env.CONFIRM_ALERT_WEBHOOK_TEST === "SEND_TEST_ALERT";
  if (report.status === "critical" || testAlert) {
    try {
      await sendAlert(report, testAlert);
      checks.alertWebhook = { sent: true, test: testAlert };
    } catch (cause) {
      failures.push(`Alert delivery failed: ${safeMessage(cause)}`);
      report.status = "critical";
      checks.alertWebhook = { sent: false, test: testAlert };
    }
  }

  const output = process.env.MONITOR_OUTPUT;
  if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "ok") process.exitCode = 1;
}

main().catch((cause) => {
  console.error(safeMessage(cause));
  process.exitCode = 1;
});
