/**
 * X402 regression suite (formerly [GAP] PoCs X402-1/X402-2). Inverted assertions: credit is only
 * granted for money that verifiably reached the treasury.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { EIP3009_TRANSFER_TYPES, NETWORK_RHC_TESTNET, RHC_TESTNET_ASSETS } from "@zguard/sdk";
import { LocalJsonStore } from "../src/db/store.js";
import { resolveSettlementMode, verifyAndConsumeXPayment } from "../src/services/x402.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PAYEE_A,
  PAYER_PK,
  RELAYER_PK,
  createOfflineApi,
  fakeChainClient,
  offlineConfig,
} from "./helpers.js";

async function signedAuthHeader(amount = 5_000_000n, nonceByte = "ab") {
  const payer = privateKeyToAccount(PAYER_PK);
  const nonce = (`0x${nonceByte.repeat(32)}`) as `0x${string}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  const signature = await payer.signTypedData({
    domain: RHC_TESTNET_ASSETS.USDG.eip712Domain,
    types: EIP3009_TRANSFER_TYPES,
    primaryType: "TransferWithAuthorization",
    message: { from: payer.address, to: PAYEE_A, value: amount, validAfter: 0n, validBefore, nonce },
  });
  return JSON.stringify({
    x402Version: 1,
    scheme: "exact",
    network: NETWORK_RHC_TESTNET,
    payload: {
      authorization: {
        kind: "TransferWithAuthorization",
        from: payer.address,
        to: PAYEE_A,
        value: amount.toString(),
        validAfter: "0",
        validBefore: validBefore.toString(),
        nonce,
        signature,
      },
    },
  });
}

function freshStore() {
  return new LocalJsonStore("zg_", join(mkdtempSync(join(tmpdir(), "zg-x402-")), "s.json"));
}

describe("[X402] settlement integrity", () => {
  it("[X402-1][FIXED] default auto mode without relayer gives NO credit for an EIP-3009 signature from an empty wallet", async () => {
    const { app } = createOfflineApi({ ZGUARD_DEV_FREE_CREDIT_MICRO_USDG: "0" });
    const res = await app.request("/v1/register", {
      method: "POST",
      headers: { "X-PAYMENT": await signedAuthHeader(), "x-forwarded-for": "198.51.100.50" },
    });
    assert.equal(res.status, 402, "must not mint credit without settlement");
    const body = (await res.json()) as { error: string; settlement: { mode: string } };
    assert.match(body.error, /deposit settlement mode/);
    assert.equal(body.settlement.mode, "deposit");
  });

  it("[X402-2][FIXED] relayer configured but settlement fails => rejected, nonce NOT consumed", async () => {
    const cfg = offlineConfig({
      ZGUARD_X402_SETTLEMENT_MODE: "onchain",
      ZGUARD_X402_RELAYER_PRIVATE_KEY: RELAYER_PK,
    });
    const store = freshStore();
    const client = fakeChainClient({ balance: 10_000_000n });
    const header = await signedAuthHeader();
    const first = await verifyAndConsumeXPayment({
      config: cfg,
      client,
      store,
      rawHeader: header,
      minimumMicroUsdg: 1n,
      tenantId: null,
    });
    assert.equal(first.ok, false);
    assert.match((first as { error: string }).error, /settlement failed/i);

    // nonce must still be fresh (settlement failure never burns it)
    const payer = privateKeyToAccount(PAYER_PK).address.toLowerCase();
    const fresh = await store.consumePaymentNonce({
      nonceKey: `eip3009:46630:${payer}:0x${"ab".repeat(32)}`,
      tenantId: null,
      network: NETWORK_RHC_TESTNET,
      asset: RHC_TESTNET_ASSETS.USDG.address,
      payer,
      amountMicro: 1n,
    });
    assert.equal(fresh, true);
  });

  it("[X402-3] onchain mode without relayer key is rejected", async () => {
    const cfg = offlineConfig({ ZGUARD_X402_SETTLEMENT_MODE: "onchain" });
    const r = resolveSettlementMode(cfg);
    assert.equal(r.ok, false);
    const out = await verifyAndConsumeXPayment({
      config: cfg,
      client: fakeChainClient({ balance: 10n ** 12n }),
      store: freshStore(),
      rawHeader: await signedAuthHeader(),
      minimumMicroUsdg: 1n,
      tenantId: null,
    });
    assert.equal(out.ok, false);
  });

  it("[X402-5] onchain mode checks payer balance before settling (empty wallet rejected)", async () => {
    const cfg = offlineConfig({
      ZGUARD_X402_SETTLEMENT_MODE: "onchain",
      ZGUARD_X402_RELAYER_PRIVATE_KEY: RELAYER_PK,
    });
    const out = await verifyAndConsumeXPayment({
      config: cfg,
      client: fakeChainClient({ balance: 0n }),
      store: freshStore(),
      rawHeader: await signedAuthHeader(),
      minimumMicroUsdg: 1n,
      tenantId: null,
    });
    assert.equal(out.ok, false);
    assert.match((out as { error: string }).error, /balance/i);
  });

  it("offchain (dev) mode is refused when NODE_ENV=production", async () => {
    const cfg = offlineConfig({ NODE_ENV: "production", ZGUARD_X402_SETTLEMENT_MODE: "offchain" });
    const r = resolveSettlementMode(cfg);
    assert.equal(r.ok, false);
    const out = await verifyAndConsumeXPayment({
      config: cfg,
      client: fakeChainClient({}),
      store: freshStore(),
      rawHeader: await signedAuthHeader(),
      minimumMicroUsdg: 1n,
      tenantId: null,
    });
    assert.equal(out.ok, false);
  });

  it("offchain dev mode still works locally (signature checked) and blocks replay", async () => {
    const cfg = offlineConfig({ ZGUARD_X402_SETTLEMENT_MODE: "offchain" });
    const store = freshStore();
    const header = await signedAuthHeader(5000n, "cd");
    const a = await verifyAndConsumeXPayment({
      config: cfg, client: fakeChainClient({}), store, rawHeader: header, minimumMicroUsdg: 1n, tenantId: null,
    });
    assert.equal(a.ok, true);
    const b = await verifyAndConsumeXPayment({
      config: cfg, client: fakeChainClient({}), store, rawHeader: header, minimumMicroUsdg: 1n, tenantId: null,
    });
    assert.equal(b.ok, false);
  });
});
