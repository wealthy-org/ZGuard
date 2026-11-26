#!/usr/bin/env node
/**
 * ZGuard + Perm production monitor (gap: monitoring / ops).
 *
 * Checks, every run:
 *   api_health   GET  {API}/health        200, status ok, sequencer up, latest block fresh
 *   api_payment  GET  {API}/v1/config     payTo is a valid non-zero address, no settlement error
 *   web_home     GET  {WEB}/              200
 *   perm_gate    GET  {PERM}/api/zguard   mode=enforce and ready=true (off/not ready = alert)
 *   perm_credit  GET  {API}/v1/balance    credit of Perm's ZGuard key >= MIN_SWAPS x guard price
 *
 * Exit code 1 when any check fails, so a scheduled GitHub Actions run turns red and GitHub
 * emails the repo owner. If ZGUARD_ALERT_WEBHOOK_URL is set, a short alert is also POSTed
 * (body has both `content` for Discord and `text` for Slack).
 *
 * Env (all optional except where noted):
 *   ZGUARD_MONITOR_API_URL   default https://zguard-delta.vercel.app
 *   ZGUARD_MONITOR_WEB_URL   default = API URL
 *   PERM_MONITOR_URL         default https://perm-iota.vercel.app ("" disables Perm checks)
 *   PERM_ZGUARD_API_KEY      Perm's zg_live_ key; without it perm_credit is skipped (warning)
 *   ZGUARD_MONITOR_MIN_SWAPS default 5 (alert when credit < 5 guard calls)
 *   ZGUARD_MONITOR_MAX_BLOCK_AGE_SECONDS default 300
 *   ZGUARD_ALERT_WEBHOOK_URL Discord/Slack-compatible webhook
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = /^0x0{40}$/;

export function settings(env = process.env) {
  const trim = (value) => (typeof value === "string" ? value.trim().replace(/\/+$/, "") : "");
  const int = (raw, fallback, min, max) => {
    const value = Number(raw ?? fallback);
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
  };
  const api = trim(env.ZGUARD_MONITOR_API_URL) || "https://zguard-delta.vercel.app";
  return {
    api,
    web: trim(env.ZGUARD_MONITOR_WEB_URL) || api,
    perm: env.PERM_MONITOR_URL === undefined ? "https://perm-iota.vercel.app" : trim(env.PERM_MONITOR_URL),
    permKey: (env.PERM_ZGUARD_API_KEY ?? "").trim(),
    minSwaps: int(env.ZGUARD_MONITOR_MIN_SWAPS, 5, 1, 100_000),
    maxBlockAge: int(env.ZGUARD_MONITOR_MAX_BLOCK_AGE_SECONDS, 300, 10, 86_400),
    webhook: (env.ZGUARD_ALERT_WEBHOOK_URL ?? "").trim(),
  };
}

// ---- pure evaluators (unit-tested in scripts/monitor.test.mjs) ----

export function evalHealth(res, maxBlockAge) {
  if (!res.ok) return fail(`HTTP ${res.status ?? "error"}${res.error ? ` (${res.error})` : ""}`);
  const body = res.body ?? {};
  if (body.status !== "ok") return fail(`status=${String(body.status)}`);
  const seq = body.sequencer;
  if (seq && seq.up === false) return fail("sequencer down");
  const age = Number(seq?.latestBlockAgeSeconds);
  if (Number.isFinite(age) && age > maxBlockAge) return fail(`latest block ${age}s old (> ${maxBlockAge}s)`);
  return pass(`chain ${body.chainId} · storage ${body.storageDriver ?? "?"} · block age ${Number.isFinite(age) ? `${age}s` : "?"}`);
}

export function evalPayment(res) {
  if (!res.ok) return fail(`HTTP ${res.status ?? "error"}${res.error ? ` (${res.error})` : ""}`);
  const rails = res.body?.paymentRails ?? {};
  if (rails.settlementError) return fail(`settlement error: ${rails.settlementError}`);
  if (typeof rails.payTo !== "string" || !ADDRESS.test(rails.payTo) || ZERO.test(rails.payTo)) {
    return fail(`payTo invalid (${String(rails.payTo)}): x402 payments cannot be accepted`);
  }
  return pass(`payTo ${rails.payTo.slice(0, 6)}…${rails.payTo.slice(-4)} · mode ${rails.effectiveSettlementMode ?? rails.settlementMode ?? "?"}`);
}

export function evalWeb(res) {
  return res.ok ? pass(`HTTP ${res.status}`) : fail(`HTTP ${res.status ?? "error"}${res.error ? ` (${res.error})` : ""}`);
}

export function evalPermGate(res) {
  if (!res.ok) return fail(`HTTP ${res.status ?? "error"}${res.error ? ` (${res.error})` : ""}`);
  const body = res.body ?? {};
  if (body.mode === "off") return fail("PERM_ZGUARD_MODE=off: Perm swaps are UNGUARDED");
  if (body.mode !== "enforce") return fail(`unexpected mode ${String(body.mode)}`);
  if (body.ready !== true) return fail(`gate not ready (${body.problem ?? "unknown"}): every Perm swap is blocked`);
  return pass(`enforce · ready · ${body.network ?? "?"}`);
}

export function evalCredit(res, guardPrice, minSwaps) {
  if (res.skipped) return { status: "warn", detail: "PERM_ZGUARD_API_KEY not provided to the monitor; credit not checked" };
  if (!res.ok) {
    if (res.status === 401) return fail("ZGuard rejected Perm's API key (401): every Perm swap is blocked");
    return fail(`HTTP ${res.status ?? "error"}${res.error ? ` (${res.error})` : ""}`);
  }
  let credit;
  try {
    credit = BigInt(String(res.body?.creditMicroUsdg ?? ""));
  } catch {
    return fail("balance response has no creditMicroUsdg");
  }
  const price = BigInt(Number.isSafeInteger(guardPrice) && guardPrice > 0 ? guardPrice : 15_000);
  const swapsLeft = credit / price;
  const usdg = (Number(credit) / 1e6).toFixed(6);
  if (credit < price) return fail(`credit ${usdg} USDG < one guard call: Perm swaps are blocked now. Top up on ZGuard (#/api → Buy Credit)`);
  if (swapsLeft < BigInt(minSwaps)) return fail(`credit ${usdg} USDG ≈ ${swapsLeft} swaps left (< ${minSwaps}). Top up on ZGuard soon`);
  return pass(`credit ${usdg} USDG ≈ ${swapsLeft} swaps`);
}

function pass(detail) {
  return { status: "pass", detail };
}
function fail(detail) {
  return { status: "fail", detail };
}

export function summarize(results) {
  const failed = results.filter((r) => r.status === "fail");
  const lines = results.map((r) => `${r.status === "pass" ? "✅" : r.status === "warn" ? "⚠️" : "❌"} ${r.name.padEnd(12)} ${r.detail}${r.ms !== undefined ? ` (${r.ms} ms)` : ""}`);
  return { ok: failed.length === 0, failed, text: lines.join("\n") };
}

// ---- I/O ----

async function getJson(url, headers = {}, timeoutMs = 20_000) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { "user-agent": "zguard-monitor/1", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
    let body = null;
    const type = res.headers.get("content-type") ?? "";
    if (type.includes("json")) body = await res.json().catch(() => null);
    else await res.arrayBuffer().catch(() => null);
    return { ok: res.ok, status: res.status, body, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: undefined, error: error?.name === "TimeoutError" ? "timeout" : String(error?.message ?? error), ms: Date.now() - started };
  }
}

async function postWebhook(url, text) {
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text.slice(0, 1900), text }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error(`webhook failed: ${error?.message ?? error}`);
  }
}

export async function run(env = process.env) {
  const s = settings(env);
  const results = [];
  const add = (name, verdict, ms) => results.push({ name, ...verdict, ms });

  const [health, config, web, gate] = await Promise.all([
    getJson(`${s.api}/health`),
    getJson(`${s.api}/v1/config`),
    getJson(`${s.web}/`),
    s.perm ? getJson(`${s.perm}/api/zguard`) : Promise.resolve(null),
  ]);
  add("api_health", evalHealth(health, s.maxBlockAge), health.ms);
  add("api_payment", evalPayment(config), config.ms);
  add("web_home", evalWeb(web), web.ms);
  if (gate) add("perm_gate", evalPermGate(gate), gate.ms);

  if (s.perm) {
    const guardPrice = Number(config.body?.pricesMicroUsdg?.guard);
    const balance = s.permKey ? await getJson(`${s.api}/v1/balance`, { authorization: `Bearer ${s.permKey}` }) : { skipped: true };
    add("perm_credit", evalCredit(balance, guardPrice, s.minSwaps), balance.ms);
  }

  const summary = summarize(results);
  const stamp = new Date().toISOString();
  console.log(`ZGuard monitor ${stamp}\n${summary.text}`);
  if (!summary.ok && s.webhook) {
    await postWebhook(s.webhook, `🚨 ZGuard monitor ${stamp}\n${summary.failed.map((r) => `❌ ${r.name}: ${r.detail}`).join("\n")}`);
  }
  return summary;
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  run().then((summary) => {
    process.exitCode = summary.ok ? 0 : 1;
  });
}
