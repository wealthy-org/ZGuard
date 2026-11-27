#!/usr/bin/env node
/**
 * Verifies the hosted release stack before a Router-v2 candidate can be promoted.
 * Secrets are read from the environment and never written to the report.
 */
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
const { getAddress, isAddress, isHash } = require("viem");
const { verifyExecutableQuote } = require("./lib/operations-quote.cjs");

const root = path.resolve(__dirname, "..");
const candidatePath = path.resolve(process.cwd(), process.env.CANDIDATE_MANIFEST || "deployments/robinhood-testnet.v2-candidate.json");
if (!fs.existsSync(candidatePath)) throw new Error(`Candidate manifest not found: ${candidatePath}`);
const candidate = JSON.parse(fs.readFileSync(candidatePath, "utf8"));
if (candidate.schemaVersion !== 2 || candidate.routerVersion !== 2 || candidate.chainId !== 46630) {
  throw new Error("Operations verification requires a chain-46630 Router-v2 candidate");
}
if (candidate.aggregatorHookVerification !== "passed" || candidate.e2eVerification !== "passed") {
  throw new Error("Verified Aggregator Hook and Router-v2 E2E evidence are required before hosted operations verification");
}

function required(condition, message) {
  if (!condition) throw new Error(message);
}
function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}
function requiredUrl(name, value, protocol = "https:") {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be a valid URL`); }
  required(parsed.protocol === protocol, `${name} must use ${protocol}`);
  return parsed;
}
async function rpc(url, method) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    signal: AbortSignal.timeout(15_000),
  });
  required(response.ok, `${method} RPC request returned HTTP ${response.status}`);
  const payload = await response.json();
  required(!payload.error && payload.result, `${method} RPC request failed`);
  return payload.result;
}

async function main() {
  const stagingUrl = requiredUrl("PERM_STAGING_URL", process.env.PERM_STAGING_URL);
  const primaryRpc = requiredUrl("RH_TESTNET_RPC_URL", process.env.RH_TESTNET_RPC_URL);
  const fallbackRpc = requiredUrl("RH_TESTNET_FALLBACK_RPC_URL", process.env.RH_TESTNET_FALLBACK_RPC_URL);
  required(primaryRpc.href !== fallbackRpc.href, "Primary and fallback RPC URLs must be different");
  const databaseUrl = process.env.DATABASE_URL || process.env.PERM_INDEXER_DATABASE_URL;
  required(databaseUrl, "DATABASE_URL or PERM_INDEXER_DATABASE_URL is required");
  required(process.env.PERM_REQUIRE_INDEXER === "1", "PERM_REQUIRE_INDEXER must be 1");
  required(process.env.PERM_REQUIRE_SHARED_RATE_LIMIT === "1", "PERM_REQUIRE_SHARED_RATE_LIMIT must be 1");
  requiredUrl("PERM_ALERT_WEBHOOK_URL", process.env.PERM_ALERT_WEBHOOK_URL);
  required(typeof process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID === "string" && process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.trim().length >= 8,
    "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required");
  required(process.env.PERM_QUOTE_SIGNER_MODE === "remote", "PERM_QUOTE_SIGNER_MODE must be remote for release operations");
  required(!process.env.PERM_QUOTE_SIGNER_PRIVATE_KEY, "Release operations must not expose a local quote-signer private key");
  requiredUrl("PERM_QUOTE_SIGNER_URL", process.env.PERM_QUOTE_SIGNER_URL);
  required((process.env.PERM_QUOTE_SIGNER_TOKEN || "").length >= 16, "PERM_QUOTE_SIGNER_TOKEN is required");
  required(isAddress(process.env.QUOTE_SIGNER_ADDRESS) && same(process.env.QUOTE_SIGNER_ADDRESS, candidate.quoteSigner),
    "QUOTE_SIGNER_ADDRESS does not match the candidate manifest");

  const [primaryChainHex, fallbackChainHex, primaryBlockHex, fallbackBlockHex] = await Promise.all([
    rpc(primaryRpc.href, "eth_chainId"), rpc(fallbackRpc.href, "eth_chainId"),
    rpc(primaryRpc.href, "eth_blockNumber"), rpc(fallbackRpc.href, "eth_blockNumber"),
  ]);
  const primaryChain = Number(BigInt(primaryChainHex));
  const fallbackChain = Number(BigInt(fallbackChainHex));
  required(primaryChain === candidate.chainId && fallbackChain === candidate.chainId, "RPC chain IDs do not match the candidate");
  const primaryBlock = BigInt(primaryBlockHex);
  const fallbackBlock = BigInt(fallbackBlockHex);
  const rpcDistance = primaryBlock > fallbackBlock ? primaryBlock - fallbackBlock : fallbackBlock - primaryBlock;
  required(rpcDistance <= 300n, `Primary and fallback RPC differ by ${rpcDistance} blocks`);

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    ssl: process.env.PGSSLMODE === "disable" ? false : "require",
  });
  let indexer;
  try {
    const rateKey = createHash("sha256").update(`operations:${Date.now()}:${process.pid}`).digest("hex");
    const [first] = await sql`SELECT allowed,retry_after FROM perm_consume_rate_limit(${rateKey},1,0.01)`;
    const [second] = await sql`SELECT allowed,retry_after FROM perm_consume_rate_limit(${rateKey},1,0.01)`;
    required(first?.allowed === true && second?.allowed === false, "Shared PostgreSQL token bucket is not operational");
    const rows = await sql`
      SELECT key,value,updated_at FROM perm_indexer_state
      WHERE chain_id=${candidate.chainId} AND router=${candidate.permRouter.toLowerCase()}
        AND key IN ('lastIndexedBlock','lastIndexedBlockHash')
    `;
    const state = new Map(rows.map((row) => [row.key, row]));
    const cursor = state.get("lastIndexedBlock");
    const cursorHash = state.get("lastIndexedBlockHash");
    required(cursor && cursorHash, "Hosted indexer has no canonical cursor for the candidate router");
    const updatedLagSeconds = Math.max(0, Math.floor((Date.now() - new Date(cursor.updated_at).getTime()) / 1000));
    required(updatedLagSeconds <= 900, `Hosted indexer cursor is ${updatedLagSeconds}s old`);
    const maxIndexerBlockLagRaw = process.env.OPERATIONS_MAX_INDEXER_BLOCK_LAG || "300";
    required(/^\d+$/.test(maxIndexerBlockLagRaw) && Number(maxIndexerBlockLagRaw) <= 1_000_000,
      "OPERATIONS_MAX_INDEXER_BLOCK_LAG must be an integer between 0 and 1,000,000");
    const maxIndexerBlockLag = BigInt(maxIndexerBlockLagRaw);
    required(/^\d+$/.test(cursor.value), "Hosted indexer cursor is not an integer block number");
    const cursorBlock = BigInt(cursor.value);
    required(primaryBlock >= cursorBlock, `Hosted indexer cursor ${cursor.value} is ahead of the primary RPC block ${primaryBlock}`);
    const indexerBlockLag = primaryBlock - cursorBlock;
    required(indexerBlockLag <= maxIndexerBlockLag,
      `Hosted indexer is ${indexerBlockLag} blocks behind (limit ${maxIndexerBlockLag}; override with OPERATIONS_MAX_INDEXER_BLOCK_LAG)`);
    indexer = { lastIndexedBlock: cursor.value, lastIndexedBlockHash: cursorHash.value, updatedLagSeconds, blockLag: indexerBlockLag.toString(), maxIndexerBlockLag: maxIndexerBlockLagRaw };
  } finally {
    await sql.end({ timeout: 2 });
  }

  const healthResponse = await fetch(new URL("/api/health?requireExecution=1", stagingUrl), {
    headers: { accept: "application/json", "user-agent": "PermOperationsVerifier/2.0" },
    signal: AbortSignal.timeout(30_000),
  });
  const health = await healthResponse.json();
  required(healthResponse.ok && health.executionReady === true && health.status === "ready", "Staging execution health is not ready");
  for (const [name, value] of Object.entries(health.checks || {})) {
    if (typeof value === "boolean") required(value, `Staging health check failed: ${name}`);
  }

  const testAccount = candidate.e2eVerificationResults?.directV4?.account || process.env.RELEASE_TEST_ACCOUNT;
  required(isAddress(testAccount), "A verified non-treasury RELEASE_TEST_ACCOUNT is required");
  const quoteResponse = await fetch(new URL("/api/quote", stagingUrl), {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "PermOperationsVerifier/2.0" },
    body: JSON.stringify({
      tokenIn: process.env.RELEASE_QUOTE_TOKEN_IN || "ETH",
      tokenOut: process.env.RELEASE_QUOTE_TOKEN_OUT || "NVDA",
      amountIn: process.env.RELEASE_QUOTE_AMOUNT_IN || "1000000000000",
      slippageBps: 50,
      account: getAddress(testAccount),
      recipient: getAddress(testAccount),
      routingMode: "best",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const quote = await quoteResponse.json();
  required(quoteResponse.ok, `Staging quote failed: ${quote.error || quoteResponse.status}`);
  const { recoveredQuoteSigner } = await verifyExecutableQuote(quote, candidate);

  const historyResponse = await fetch(new URL(`/api/history?account=${getAddress(testAccount)}`, stagingUrl), {
    headers: { accept: "application/json", "user-agent": "PermOperationsVerifier/2.0" },
    signal: AbortSignal.timeout(30_000),
  });
  const history = await historyResponse.json();
  required(historyResponse.ok && history.source === "postgres-indexer", "Staging history is not using the hosted PostgreSQL indexer");

  const receiptHash = candidate.releaseEvidence?.directV4?.transactionHash;
  required(isHash(receiptHash), "Verified direct-v4 receipt evidence is required");
  const receiptResponse = await fetch(new URL(`/api/receipts?tx=${receiptHash}`, stagingUrl), {
    headers: { accept: "application/json", "user-agent": "PermOperationsVerifier/2.0" },
    signal: AbortSignal.timeout(30_000),
  });
  const receipt = await receiptResponse.json();
  required(receiptResponse.ok && receipt.transaction?.routerVersion === 2, "Staging receipt endpoint did not return Router-v2 evidence");
  required(same(receipt.transaction.router, candidate.permRouter), "Staging receipt endpoint uses a different router");

  const securityHeaders = [
    "content-security-policy", "strict-transport-security", "cross-origin-opener-policy",
    "permissions-policy", "x-content-type-options", "x-frame-options",
  ];
  for (const header of securityHeaders) required(receiptResponse.headers.get(header), `Staging response is missing ${header}`);
  const contentSecurityPolicy = receiptResponse.headers.get("content-security-policy") || "";
  required(/(?:^|;)\s*frame-ancestors\s+'none'\s*(?:;|$)/i.test(contentSecurityPolicy),
    "Staging CSP must deny framing with frame-ancestors 'none'");
  required(receiptResponse.headers.get("x-frame-options")?.toUpperCase() === "DENY",
    "Staging X-Frame-Options must be DENY");

  if (process.env.CONFIRM_ALERT_WEBHOOK_TEST === "SEND_TEST_ALERT") {
    const alertResponse = await fetch(process.env.PERM_ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `Perm release preflight test for ${candidate.permRouter}`, test: true }),
      signal: AbortSignal.timeout(10_000),
    });
    required(alertResponse.ok, `Alert webhook test returned HTTP ${alertResponse.status}`);
  } else {
    throw new Error("Set CONFIRM_ALERT_WEBHOOK_TEST=SEND_TEST_ALERT to verify the real alert destination");
  }

  const result = {
    candidateRouter: candidate.permRouter,
    stagingOrigin: stagingUrl.origin,
    primaryRpcBlock: primaryBlock.toString(),
    fallbackRpcBlock: fallbackBlock.toString(),
    indexer,
    healthStatus: health.status,
    executableQuoteId: quote.quoteId,
    indexedHistorySource: history.source,
    verifiedReceipt: receiptHash,
    quoteSignerMode: "remote",
    quoteSignerAddress: getAddress(process.env.QUOTE_SIGNER_ADDRESS),
    recoveredQuoteSigner,
    securityHeaders,
    alertWebhookTest: "passed",
  };
  candidate.operationsVerification = "passed";
  candidate.operationsVerifiedAt = new Date().toISOString();
  candidate.operationsVerificationResults = result;
  candidate.executionReady = false;
  fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);
  console.log(JSON.stringify({ candidate: path.relative(root, candidatePath), status: "passed", result }, null, 2));
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exitCode = 1;
});
