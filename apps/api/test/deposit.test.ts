/**
 * Deposit settlement mode (no relayer) + X402-4 claim binding + confirmation depth.
 * Client flow: transfer USDG to payTo -> sign depositClaimMessage(txHash, chainId) with the SAME
 * wallet -> X-PAYMENT {network, payload:{txHash, claimSignature}}.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import {
  NETWORK_RHC_TESTNET,
  RHC_TESTNET_ASSETS,
  buildDepositClaimHeader,
  depositClaimMessage,
} from "@zguard/sdk";
import { LocalJsonStore } from "../src/db/store.js";
import { verifyAndConsumeXPayment } from "../src/services/x402.js";
import {
  PAYEE_A,
  PAYER_PK,
  THIEF_PK,
  TRANSFER_TOPIC,
  fakeChainClient,
  offlineConfig,
  topicAddr,
  u256,
} from "./helpers.js";

const USDG_T = RHC_TESTNET_ASSETS.USDG.address;
const TX = `0x${"12".repeat(32)}`;
const payer = privateKeyToAccount(PAYER_PK);
const thief = privateKeyToAccount(THIEF_PK);

function transferLog(from: string, to: string, amount: bigint) {
  return { address: USDG_T, topics: [TRANSFER_TOPIC, topicAddr(from), topicAddr(to)], data: u256(amount) };
}

function chain(opts: { head?: bigint; status?: "success" | "reverted"; logs?: ReturnType<typeof transferLog>[] } = {}) {
  return fakeChainClient({
    head: opts.head ?? 110n,
    receipts: {
      [TX]: {
        status: opts.status ?? "success",
        blockNumber: 100n,
        from: payer.address,
        logs: opts.logs ?? [transferLog(payer.address, PAYEE_A, 2_000_000n)],
      },
    },
  });
}

const cfg = offlineConfig({ ZGUARD_X402_SETTLEMENT_MODE: "deposit", ZGUARD_X402_MIN_CONFIRMATIONS: "3" });
const store = () => new LocalJsonStore("zg_", join(mkdtempSync(join(tmpdir(), "zg-dep-")), "s.json"));

async function claim(signer = payer, txHash = TX) {
  const sig = await signer.signMessage({ message: depositClaimMessage(txHash, 46630) });
  return buildDepositClaimHeader({ network: NETWORK_RHC_TESTNET, txHash, claimSignature: sig });
}

describe("[deposit] settlement mode", () => {
  it("message format is exactly the documented one", () => {
    assert.equal(
      depositClaimMessage("0xABC", 46630),
      "ZGuard credit claim\ntx:0xabc\nchain:46630"
    );
  });

  it("credits the payer's own transfer when the claim is signed by the payer", async () => {
    const out = await verifyAndConsumeXPayment({
      config: cfg, client: chain(), store: store(), rawHeader: await claim(), minimumMicroUsdg: 1n, tenantId: null,
    });
    assert.equal(out.ok, true);
    if (out.ok) {
      assert.equal(out.creditedMicroUsdg, 2_000_000n);
      assert.equal(out.payer, payer.address.toLowerCase());
      assert.equal(out.settlementTxHash, TX);
    }
  });

  it("[X402-4][FIXED] a thief copying a public txHash is rejected", async () => {
    const out = await verifyAndConsumeXPayment({
      config: cfg, client: chain(), store: store(), rawHeader: await claim(thief), minimumMicroUsdg: 1n, tenantId: null,
    });
    assert.equal(out.ok, false);
    assert.match((out as { error: string }).error, /No USDG transfer from claim signer/);
  });

  it("txHash without claimSignature is rejected", async () => {
    const out = await verifyAndConsumeXPayment({
      config: cfg,
      client: chain(),
      store: store(),
      rawHeader: JSON.stringify({ network: NETWORK_RHC_TESTNET, payload: { txHash: TX } }),
      minimumMicroUsdg: 1n,
      tenantId: null,
    });
    assert.equal(out.ok, false);
    assert.match((out as { error: string }).error, /claimSignature/);
  });

  it("only transfers FROM the signer count (a third party's transfer in the same tx is ignored)", async () => {
    const out = await verifyAndConsumeXPayment({
      config: cfg,
      client: chain({ logs: [transferLog(thief.address, PAYEE_A, 9_000_000n), transferLog(payer.address, PAYEE_A, 1000n)] }),
      store: store(),
      rawHeader: await claim(),
      minimumMicroUsdg: 1n,
      tenantId: null,
    });
    assert.equal(out.ok, true);
    if (out.ok) assert.equal(out.creditedMicroUsdg, 1000n);
  });

  it("waits for confirmations, and does not burn the claim while waiting", async () => {
    const s = store();
    const header = await claim();
    const early = await verifyAndConsumeXPayment({
      config: cfg, client: chain({ head: 101n }), store: s, rawHeader: header, minimumMicroUsdg: 1n, tenantId: null,
    });
    assert.equal(early.ok, false);
    assert.match((early as { error: string }).error, /confirmation/);
    const later = await verifyAndConsumeXPayment({
      config: cfg, client: chain({ head: 103n }), store: s, rawHeader: header, minimumMicroUsdg: 1n, tenantId: null,
    });
    assert.equal(later.ok, true);
  });

  it("replaying the same claim is blocked", async () => {
    const s = store();
    const header = await claim();
    const a = await verifyAndConsumeXPayment({ config: cfg, client: chain(), store: s, rawHeader: header, minimumMicroUsdg: 1n, tenantId: null });
    const b = await verifyAndConsumeXPayment({ config: cfg, client: chain(), store: s, rawHeader: header, minimumMicroUsdg: 1n, tenantId: null });
    assert.equal(a.ok, true);
    assert.equal(b.ok, false);
  });

  it("reverted deposit tx is rejected", async () => {
    const out = await verifyAndConsumeXPayment({
      config: cfg, client: chain({ status: "reverted" }), store: store(), rawHeader: await claim(), minimumMicroUsdg: 1n, tenantId: null,
    });
    assert.equal(out.ok, false);
  });

  it("underpayment is rejected", async () => {
    const out = await verifyAndConsumeXPayment({
      config: cfg, client: chain(), store: store(), rawHeader: await claim(), minimumMicroUsdg: 5_000_000n, tenantId: null,
    });
    assert.equal(out.ok, false);
  });
});
