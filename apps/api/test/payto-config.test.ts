/**
 * Treasury address validation: an invalid ZGUARD_X402_PAY_TO (e.g. a 64-hex secret pasted into the
 * wrong variable) must never be echoed publicly and must disable payments (fail closed).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSettlementMode } from "../src/services/x402.js";
import { createOfflineApi, offlineConfig, registerTenant } from "./helpers.js";

const SECRET_LIKE = "f".repeat(8) + "0123456789abcdef".repeat(3) + "deadbeef";

describe("[payTo] treasury address validation", () => {
  it("rejects a 64-hex value, hides it from /v1/config and the 402 quote, refuses payments", async () => {
    const config = offlineConfig({ ZGUARD_X402_PAY_TO: SECRET_LIKE });
    assert.ok(config.x402PayToError);
    assert.equal(config.x402PayToError!.includes(SECRET_LIKE), false);
    assert.equal(resolveSettlementMode(config).ok, false);

    const { app } = createOfflineApi({ ZGUARD_X402_PAY_TO: SECRET_LIKE, ZGUARD_DEV_FREE_CREDIT_MICRO_USDG: "0" });
    const cfgText = await (await app.request("/v1/config")).text();
    assert.equal(cfgText.includes(SECRET_LIKE), false);
    const cfg = JSON.parse(cfgText);
    assert.equal(cfg.paymentRails.payTo, null);
    assert.equal(cfg.paymentRails.effectiveSettlementMode, "unavailable");

    const { apiKey } = await registerTenant(app);
    const quote = await app.request("/v1/verify", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: "{}",
    });
    assert.equal(quote.status, 402);
    const qText = await quote.text();
    assert.equal(qText.includes(SECRET_LIKE), false);
    assert.deepEqual(JSON.parse(qText).accepts, []);
  });

  it("missing payTo in production refuses payments; valid address passes", () => {
    const prod = offlineConfig({ NODE_ENV: "production", ZGUARD_X402_PAY_TO: "", ZGUARD_ALLOW_LOCAL_STORE_IN_PRODUCTION: "true" });
    assert.match(prod.x402PayToError ?? "", /not set/);
    const ok = offlineConfig({ ZGUARD_X402_PAY_TO: "0x" + "ab".repeat(20) });
    assert.equal(ok.x402PayToError, null);
    assert.equal(resolveSettlementMode(ok).ok, true);
  });
});
