#!/usr/bin/env node
// Standalone Perm remote quote signer (Node >= 20). Deploy on any host that terminates HTTPS
// (Render, Railway, Fly.io, Cloud Run, a VPS behind Caddy…). See docs/MAINNET_RUNBOOK.md §3.
//
//   POST /sign     → signs a policy-checked PermQuote (see signer-core.mjs)
//   GET  /health   → { ok, address, chainId, router } (no secrets)
//
// Env: SIGNER_PRIVATE_KEY, PERM_QUOTE_SIGNER_TOKEN, SIGNER_CHAIN_ID, SIGNER_ROUTER_ADDRESS
//      [SIGNER_EXPECTED_ADDRESS] [SIGNER_ACCOUNT_ALLOWLIST] [SIGNER_MAX_AMOUNT_IN_WEI]
//      [SIGNER_MAX_TTL_SECONDS=180] [PORT=8787] [HOST=0.0.0.0]
//      [TLS_CERT_FILE + TLS_KEY_FILE]  → serve HTTPS directly (otherwise plain HTTP behind a TLS proxy)
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { MAX_BODY_BYTES, handleSignRequest, loadConfig } from "./signer-core.mjs";

const config = loadConfig();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "0.0.0.0";

// Small per-IP token bucket: the web app quotes at most a few times per second per user.
const buckets = new Map();
function allow(ip) {
  const now = Date.now();
  const bucket = buckets.get(ip) || { tokens: 30, at: now };
  bucket.tokens = Math.min(30, bucket.tokens + ((now - bucket.at) / 1000) * 5);
  bucket.at = now;
  buckets.set(ip, bucket);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function send(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

async function onRequest(request, response) {
  const url = new URL(request.url || "/", "http://signer");
  if (request.method === "GET" && url.pathname === "/health") {
    return send(response, 200, { ok: true, address: config.account.address, chainId: config.chainId, router: config.router });
  }
  if (request.method !== "POST" || (url.pathname !== "/sign" && url.pathname !== "/")) return send(response, 404, { error: "not found" });
  const ip = (request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").toString().split(",")[0].trim();
  if (!allow(ip)) return send(response, 429, { error: "rate limited" });

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return send(response, 413, { error: "body too large" });
    chunks.push(chunk);
  }
  try {
    const result = await handleSignRequest({
      authorization: request.headers.authorization,
      contentType: request.headers["content-type"],
      bodyText: Buffer.concat(chunks).toString("utf8"),
      config,
    });
    if (result.audit) console.log(JSON.stringify({ event: "signed", ...result.audit }));
    else console.warn(JSON.stringify({ event: "rejected", status: result.status, error: result.body.error, ip }));
    return send(response, result.status, result.body);
  } catch (cause) {
    console.error(JSON.stringify({ event: "error", message: cause instanceof Error ? cause.message : String(cause) }));
    return send(response, 500, { error: "signer error" });
  }
}

const server = process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
  ? https.createServer({ cert: fs.readFileSync(process.env.TLS_CERT_FILE), key: fs.readFileSync(process.env.TLS_KEY_FILE) }, onRequest)
  : http.createServer(onRequest);
server.listen(port, host, () => {
  console.log(`Perm quote signer ${config.account.address} · chain ${config.chainId} · router ${config.router} · ${server instanceof https.Server ? "https" : "http"}://${host}:${port}`);
});
