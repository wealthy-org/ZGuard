/**
 * STORE-1 regression (formerly a [GAP] PoC: anonymous GET /v1/receipts leaked every tenant's receipts
 * and the global revenue). Assertions are now inverted: the leak must NOT be reproducible.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NETWORK_RHC_TESTNET, RHC_TESTNET_ASSETS } from "@zguard/sdk";
import { PAYEE_A, createOfflineApi, registerTenant } from "./helpers.js";

const ADMIN = "admin-key-for-tests-0123456789";

async function makeReceipt(
  app: { request: (p: string, i?: RequestInit) => Response | Promise<Response> },
  apiKey: string
) {
  const res = await app.request("/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      network: NETWORK_RHC_TESTNET,
      quote: { asset: RHC_TESTNET_ASSETS.USDG.address, payTo: PAYEE_A, amount: "777", chainId: 46630 },
      payload: {
        type: "eip3009",
        authorization: {
          from: "0x2222222222222222222222222222222222222222",
          to: PAYEE_A,
          value: "777",
          domain: RHC_TESTNET_ASSETS.USDG.eip712Domain,
        },
      },
    }),
  });
  assert.equal(res.status, 200);
  return ((await res.json()) as { decisionId: string }).decisionId;
}

describe("[STORE-1][FIXED] /v1/receipts tenant isolation", () => {
  it("anonymous request is rejected with 401 (no receipts, no global revenue)", async () => {
    const { app } = createOfflineApi({ ZGUARD_ADMIN_API_KEY: ADMIN });
    const victim = await registerTenant(app, "198.51.100.1");
    await makeReceipt(app, victim.apiKey);

    const anon = await app.request("/v1/receipts");
    assert.equal(anon.status, 401);
    const body = (await anon.json()) as Record<string, unknown>;
    assert.equal(body.receipts, undefined);
    assert.equal(body.revenue, undefined);
  });

  it("a tenant never sees another tenant's receipts or totals", async () => {
    const { app } = createOfflineApi({ ZGUARD_ADMIN_API_KEY: ADMIN });
    const victim = await registerTenant(app, "198.51.100.2");
    const attacker = await registerTenant(app, "198.51.100.3");
    const victimDecision = await makeReceipt(app, victim.apiKey);

    const res = await app.request("/v1/receipts", {
      headers: { Authorization: `Bearer ${attacker.apiKey}` },
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      scope: string;
      receipts: Array<{ decisionId: string; tenantId: string }>;
      revenue: { receiptCount: number };
    };
    assert.equal(json.scope, "tenant");
    assert.ok(!json.receipts.some((r) => r.decisionId === victimDecision));
    assert.equal(json.revenue.receiptCount, 0);

    const own = (await (
      await app.request("/v1/receipts", { headers: { Authorization: `Bearer ${victim.apiKey}` } })
    ).json()) as { receipts: Array<{ decisionId: string; tenantId: string }> };
    assert.ok(own.receipts.some((r) => r.decisionId === victimDecision));
    assert.ok(own.receipts.every((r) => r.tenantId === victim.tenantId));
  });

  it("global ledger only with the correct x-admin-key", async () => {
    const { app } = createOfflineApi({ ZGUARD_ADMIN_API_KEY: ADMIN });
    const t = await registerTenant(app, "198.51.100.4");
    await makeReceipt(app, t.apiKey);

    const wrong = await app.request("/v1/receipts", { headers: { "x-admin-key": "nope" } });
    assert.equal(wrong.status, 401);

    const admin = await app.request("/v1/receipts", { headers: { "x-admin-key": ADMIN } });
    assert.equal(admin.status, 200);
    const json = (await admin.json()) as { scope: string; revenue: { receiptCount: number } };
    assert.equal(json.scope, "admin-global");
    assert.ok(json.revenue.receiptCount >= 1);
  });

  it("invalid API key is 401", async () => {
    const { app } = createOfflineApi();
    const res = await app.request("/v1/receipts", { headers: { Authorization: "Bearer zg_live_bogus" } });
    assert.equal(res.status, 401);
  });
});
