/**
 * §9.9 buyback config (apps/api/src/config.ts).
 *
 * [BB-1] ZGUARD_BUYBACK_REVENUE_BPS was `Number(env)` without validation: "50.5", "abc" or "" made
 *        `BigInt()` throw inside computeBuybackShare AFTER the credit was charged, so every paid call
 *        failed with 500. Now: integer 0..10000, else the default 10000 + a config error.
 * [BB-2] buyback wallet / product token / burn address were published in /v1/config verbatim (any
 *        string), and pay-to or buyback could be a third-party contract (e.g. the pons buyback vault),
 *        sending revenue to someone else. Now validated, hidden when invalid, foreign contracts refused.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PONS_V2_CONTRACTS, RHC_CANONICAL_ASSETS } from "@zguard/sdk";
import { createZGuardApp } from "../src/app.js";
import { loadConfig, resolveBuybackConfig, resolvePayTo } from "../src/config.js";
import { LocalJsonStore } from "../src/db/store.js";

const SAFE = "0xad5501954A52792280D868F7e613Efcc4F80fa6c";

function app(overrides: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "zguard-bb-"));
  const config = loadConfig({
    ...process.env,
    DATABASE_URL: "",
    ZGUARD_ACTIVE_CHAIN_ID: "4663",
    ZGUARD_DEV_FREE_CREDIT_MICRO_USDG: "60000",
    ZGUARD_X402_PAY_TO: SAFE,
    ...overrides,
  });
  return createZGuardApp({ config, store: new LocalJsonStore("zg_", join(dir, "store.json")) }).app;
}

describe("[BB-1] a bad revenue split never breaks paid calls", () => {
  for (const bps of ["50.5", "abc", "-1", "20000"]) {
    it(`ZGUARD_BUYBACK_REVENUE_BPS=${bps} → paid /v1/check still answers`, async () => {
      const a = app({ ZGUARD_BUYBACK_REVENUE_BPS: bps });
      const reg = await a.request("/v1/register", { method: "POST" });
      const { apiKey } = (await reg.json()) as { apiKey: string };
      const res = await a.request("/v1/check", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ text: "hello" }),
      });
      assert.equal(res.status, 200);
      const cfg = (await (await a.request("/v1/config")).json()) as { buyback: { buybackRevenueBps: number; configErrors: string[] } };
      assert.equal(cfg.buyback.buybackRevenueBps, 10000);
      assert.ok(cfg.buyback.configErrors.some((e) => e.includes("ZGUARD_BUYBACK_REVENUE_BPS")));
    });
  }
  it("valid split is used", () => {
    assert.equal(resolveBuybackConfig({ ZGUARD_BUYBACK_REVENUE_BPS: "2500" }).buybackRevenueBps, 2500);
  });
});

describe("[BB-2] treasury / buyback addresses are validated", () => {
  it("garbage buyback wallet is hidden, not published", async () => {
    const a = app({ ZGUARD_BUYBACK_WALLET: "<script>alert(1)</script>" });
    const cfg = (await (await a.request("/v1/config")).json()) as { buyback: { buybackWallet: string | null; configErrors: string[] } };
    assert.equal(cfg.buyback.buybackWallet, null);
    assert.equal(cfg.buyback.configErrors.length, 1);
    assert.ok(!JSON.stringify(cfg).includes("<script>"));
  });
  it("pons buyback vault as our buyback wallet → refused", () => {
    const r = resolveBuybackConfig({ ZGUARD_BUYBACK_WALLET: PONS_V2_CONTRACTS.buybackVault });
    assert.equal(r.buybackWallet, null);
    assert.match(r.buybackConfigErrors[0]!, /third-party/);
  });
  it("USDG as product token → refused", () => {
    assert.equal(resolveBuybackConfig({ ZGUARD_PONS_TOKEN_ADDRESS: RHC_CANONICAL_ASSETS.USDG.address }).ponsTokenAddress, null);
  });
  it("burn address as buyback wallet → refused", () => {
    assert.equal(resolveBuybackConfig({ ZGUARD_BUYBACK_WALLET: "0x000000000000000000000000000000000000dEaD" }).buybackWallet, null);
  });
  it("pay-to pointing at a third-party contract → payments refused", () => {
    const r = resolvePayTo({ ZGUARD_X402_PAY_TO: PONS_V2_CONTRACTS.feeEscrow }, true);
    assert.ok(r.x402PayToError);
  });
  it("the ZGuard Safe is accepted for pay-to and buyback", () => {
    assert.equal(resolvePayTo({ ZGUARD_X402_PAY_TO: SAFE }, true).x402PayToError, null);
    const r = resolveBuybackConfig({ ZGUARD_BUYBACK_WALLET: SAFE });
    assert.equal(r.buybackWallet, SAFE);
    assert.deepEqual(r.buybackConfigErrors, []);
  });
});
