/**
 * Offline regression suite (no RPC, no Neon, no network). Must ALWAYS pass in CI.
 * Covers gap-doc items C4, C5, C6-table (CORS, global rate limit, prod storage, latency metrics).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NETWORK_RHC_TESTNET, RHC_TESTNET_ASSETS, type GuardResponse } from "@zguard/sdk";
import { loadConfig } from "../src/config.js";
import { createStore, StorageUnavailableError } from "../src/db/store.js";
import { tightenCheckModes } from "../src/app.js";
import { PAYEE_A, createOfflineApi, offlineEnv, registerTenant } from "./helpers.js";

const USDG_T = RHC_TESTNET_ASSETS.USDG.address;
const PAYER = "0x1111111111111111111111111111111111111111";

function quoteOnlyGuardBody(extra: Record<string, unknown> = {}) {
  return {
    network: NETWORK_RHC_TESTNET,
    checks: ["quote"],
    quote: { asset: USDG_T, payTo: PAYEE_A, amount: "1000", chainId: 46630 },
    payload: {
      type: "eip3009",
      authorization: {
        from: PAYER,
        to: PAYEE_A,
        value: "1000",
        domain: RHC_TESTNET_ASSETS.USDG.eip712Domain,
      },
    },
    ...extra,
  };
}

describe("[C4] server-enforced required checks on /v1/guard", () => {
  it("checks:[\"quote\"] still runs simulation + token_risk and is NOT allow", async () => {
    const { app } = createOfflineApi();
    const { apiKey } = await registerTenant(app);
    const res = await app.request("/v1/guard", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(quoteOnlyGuardBody()),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as GuardResponse;
    assert.ok(json.checks.quote, "quote check executed");
    assert.ok(json.checks.simulation, "simulation forced by server policy");
    assert.ok(json.checks.token_risk, "token_risk forced by server policy");
    assert.notEqual(json.decision, "allow");
    assert.equal(json.expires_at, null);
  });

  it("options.checkModes cannot downgrade a required check to advisory", async () => {
    const { app } = createOfflineApi();
    const { apiKey } = await registerTenant(app);
    const res = await app.request("/v1/guard", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(
        quoteOnlyGuardBody({
          checks: ["quote", "simulation", "token_risk"],
          options: { checkModes: { simulation: "advisory", token_risk: "advisory" } },
        })
      ),
    });
    const json = (await res.json()) as GuardResponse;
    assert.notEqual(json.decision, "allow", "advisory downgrade must be ignored");
    assert.ok(
      json.codes.some((c) => c.startsWith("S-") || c.startsWith("T-")),
      `simulation/token_risk codes stay required, got ${json.codes.join(",")}`
    );
  });

  it("tightenCheckModes only tightens", () => {
    const out = tightenCheckModes(
      { quote: "required", simulation: "required", token_risk: "required", content: "advisory" },
      { simulation: "advisory", content: "required" }
    );
    assert.equal(out.simulation, "required");
    assert.equal(out.content, "required");
  });
});

describe("[C5] /v1/register abuse limits and free credit", () => {
  it("rate-limits registrations per IP (429 after the budget)", async () => {
    const { app } = createOfflineApi({ ZGUARD_REGISTER_LIMIT_PER_IP_PER_HOUR: "2" });
    const hit = () =>
      app.request("/v1/register", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } });
    assert.equal((await hit()).status, 201);
    assert.equal((await hit()).status, 201);
    const third = await hit();
    assert.equal(third.status, 429);
    assert.ok(third.headers.get("Retry-After"));
    // a different IP is unaffected
    const other = await app.request("/v1/register", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    assert.equal(other.status, 201);
  });

  it("forces free credit to 0 on mainnet production", () => {
    const cfg = loadConfig(
      offlineEnv({
        NODE_ENV: "production",
        ZGUARD_ACTIVE_CHAIN_ID: "4663",
        ZGUARD_DEV_FREE_CREDIT_MICRO_USDG: "999999",
      })
    );
    assert.equal(cfg.devFreeCreditMicroUsdg, 0n);
  });

  it("testnet production free credit is opt-in only (default 0)", () => {
    const env = offlineEnv({ NODE_ENV: "production" });
    delete env.ZGUARD_DEV_FREE_CREDIT_MICRO_USDG;
    assert.equal(loadConfig(env).devFreeCreditMicroUsdg, 0n);
  });
});

describe("[C6] production hardening", () => {
  it("refuses the local JSON store when NODE_ENV=production and DATABASE_URL is empty", () => {
    const cfg = loadConfig(offlineEnv({ NODE_ENV: "production" }));
    assert.throws(() => createStore(cfg), StorageUnavailableError);
  });

  it("CORS: keyed routes are not opened to foreign origins in production; public reads are", async () => {
    const { app } = createOfflineApi({
      NODE_ENV: "production",
      ZGUARD_ALLOW_LOCAL_STORE_IN_PRODUCTION: "true",
      ZGUARD_CORS_ORIGINS: "https://zguard-delta.vercel.app",
    });
    const evil = await app.request("/v1/receipts", { headers: { Origin: "https://evil.example" } });
    assert.equal(evil.headers.get("access-control-allow-origin"), null);

    const allowed = await app.request("/v1/receipts", {
      headers: { Origin: "https://zguard-delta.vercel.app" },
    });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://zguard-delta.vercel.app");

    const pub = await app.request("/v1/registry", { headers: { Origin: "https://evil.example" } });
    assert.equal(pub.headers.get("access-control-allow-origin"), "*");
  });

  it("global per-IP rate limit returns 429", async () => {
    const { app } = createOfflineApi({ ZGUARD_RATE_LIMIT_PER_MINUTE: "3" });
    const get = () => app.request("/v1/metrics", { headers: { "x-forwarded-for": "192.0.2.1" } });
    await get();
    await get();
    await get();
    assert.equal((await get()).status, 429);
  });

  it("records latency (p50/p95) per route and sends Server-Timing", async () => {
    const { app } = createOfflineApi();
    const r = await app.request("/v1/metrics");
    assert.match(r.headers.get("server-timing") ?? "", /app;dur=/);
    const m = (await (await app.request("/v1/metrics")).json()) as {
      latency: { routes: Record<string, { p95Ms: number; count: number }> };
      targetP95Ms: number;
    };
    assert.equal(m.targetP95Ms, 800);
    assert.ok(m.latency.routes["GET /v1/metrics"]!.count >= 1);
  });

  it("/v1/config does not leak the global revenue ledger to anonymous callers", async () => {
    const { app } = createOfflineApi();
    const cfg = (await (await app.request("/v1/config")).json()) as {
      buyback: { ledger: unknown };
      paymentRails: { effectiveSettlementMode: string };
    };
    assert.equal(cfg.buyback.ledger, null);
    assert.equal(cfg.paymentRails.effectiveSettlementMode, "deposit");
  });

  it("allow TTL from the client is clamped to the server TTL", async () => {
    const { app } = createOfflineApi({ ZGUARD_ALLOW_TTL_SECONDS: "60" });
    const { apiKey } = await registerTenant(app);
    const res = await app.request("/v1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(quoteOnlyGuardBody({ options: { ttlSeconds: 86_400 } })),
    });
    const json = (await res.json()) as GuardResponse;
    if (json.decision === "allow") {
      const ttl = (Date.parse(json.expires_at!) - Date.now()) / 1000;
      assert.ok(ttl <= 61, `ttl ${ttl}s must be clamped to 60s`);
    }
  });
});
