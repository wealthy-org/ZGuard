/**
 * Browser USDG deposit top-up (I9 #17): call order, exact calldata/claim bytes, and fail-closed refusals
 * before any wallet popup when the deployment cannot accept payments.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { depositClaimMessage as sdkClaimMessage } from "../../../packages/sdk/src/payment-claim";
import {
  depositClaimMessage,
  encodeErc20Transfer,
  formatMicroUsdg,
  parseUsdgToMicro,
  topUpWithUsdgDeposit,
  utf8ToHex,
} from "../src/lib/deposit";
import { describeWalletError } from "../src/lib/wallet-error";

const WALLET = "0x1111111111111111111111111111111111111111";
const PAY_TO = "0x141DB8c1C42B0fa5b13eE17136e4E037597886a8";
const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const TX = "0x" + "ab".repeat(32);
const SIG = "0x" + "cd".repeat(65);

function config(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 46630,
    network: "eip155:46630",
    paymentRails: {
      payTo: PAY_TO,
      usdgAddress: USDG,
      effectiveSettlementMode: "deposit",
      settlementError: null,
      minConfirmations: 3,
      ...overrides,
    },
  };
}

function harness(opts: { cfg?: unknown; receiptStatus?: string; balance?: bigint; rpcDown?: boolean; registerReplies?: Array<{ status: number; body: unknown }> } = {}) {
  const calls: Array<{ method: string; params?: unknown[] }> = [];
  const fetches: Array<{ url: string; init?: RequestInit }> = [];
  let head = 100n;
  const provider = {
    async request(args: { method: string; params?: unknown[] }) {
      calls.push(args);
      if (opts.rpcDown) throw { code: -32603, message: "Failed to fetch" }; // MetaMask-style plain object
      switch (args.method) {
        case "eth_call":
          return "0x" + (opts.balance ?? 10_000_000n).toString(16).padStart(64, "0");
        case "eth_sendTransaction":
          return TX;
        case "personal_sign":
          return SIG;
        case "eth_getTransactionReceipt":
          return { status: opts.receiptStatus ?? "0x1", blockNumber: "0x64" }; // block 100
        case "eth_blockNumber":
          head += 2n;
          return "0x" + head.toString(16);
        default:
          throw new Error(`unexpected ${args.method}`);
      }
    },
  };
  const replies = [...(opts.registerReplies ?? [{ status: 201, body: { apiKey: "zg_live_paid", creditMicroUsdg: "160000" } }])];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    fetches.push({ url, init });
    if (url === "/v1/config") return new Response(JSON.stringify(opts.cfg ?? config()), { status: 200 });
    const r = replies.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { calls, fetches, provider, fetchImpl };
}

describe("[deposit-ui] browser USDG top-up", () => {
  it("helpers: amounts, calldata and claim message match the SDK byte for byte", () => {
    assert.equal(parseUsdgToMicro("0.10"), 100000n);
    assert.equal(parseUsdgToMicro("1"), 1000000n);
    assert.equal(parseUsdgToMicro("0.000001"), 1n);
    for (const bad of ["", "-1", "0", "1.0000001", "abc", "1e3"]) assert.throws(() => parseUsdgToMicro(bad));
    assert.equal(formatMicroUsdg(160000n), "0.16");
    assert.equal(
      encodeErc20Transfer(PAY_TO, 100000n),
      "0xa9059cbb000000000000000000000000141db8c1c42b0fa5b13ee17136e4e037597886a8" +
        "00000000000000000000000000000000000000000000000000000000000186a0"
    );
    assert.equal(depositClaimMessage(TX.toUpperCase().replace("0X", "0x"), 46630), sdkClaimMessage(TX, 46630));
  });

  it("happy path: transfer → personal_sign(claim) → receipt → confirmations → register with X-PAYMENT", async () => {
    const h = harness();
    const res = await topUpWithUsdgDeposit({
      provider: h.provider,
      walletAddress: WALLET,
      walletChainId: 46630,
      amountMicro: 100000n,
      fetchImpl: h.fetchImpl,
      pollMs: 1,
    });
    assert.equal(res.apiKey, "zg_live_paid");
    assert.equal(res.txHash, TX);
    const methods = h.calls.map((c) => c.method);
    assert.deepEqual(methods.slice(0, 4), ["eth_call", "eth_sendTransaction", "personal_sign", "eth_getTransactionReceipt"]);
    const tx = (h.calls[1].params as Array<Record<string, string>>)[0];
    assert.equal(tx.to, USDG);
    assert.equal(tx.from, WALLET);
    assert.equal(tx.data, encodeErc20Transfer(PAY_TO, 100000n));
    assert.deepEqual(h.calls[2].params, [utf8ToHex(sdkClaimMessage(TX, 46630)), WALLET]);
    const reg = h.fetches.find((f) => f.url === "/v1/register")!;
    const xp = JSON.parse((reg.init!.headers as Record<string, string>)["X-PAYMENT"]);
    assert.deepEqual(xp, { network: "eip155:46630", payload: { txHash: TX, claimSignature: SIG } });
  });

  for (const [name, cfg, re] of [
    ["onchain mode", config({ effectiveSettlementMode: "onchain" }), /deposit mode/],
    ["payments unavailable", config({ effectiveSettlementMode: "unavailable", settlementError: "bad payTo" }), /unavailable/],
    ["missing payTo", config({ payTo: null }), /payTo/],
  ] as const) {
    it(`refuses before any wallet call: ${name}`, async () => {
      const h = harness({ cfg });
      await assert.rejects(
        topUpWithUsdgDeposit({ provider: h.provider, walletAddress: WALLET, walletChainId: 46630, amountMicro: 1n, fetchImpl: h.fetchImpl }),
        re
      );
      assert.equal(h.calls.length, 0);
    });
  }

  it("refuses before any wallet call when the wallet is on another chain", async () => {
    const h = harness();
    await assert.rejects(
      topUpWithUsdgDeposit({ provider: h.provider, walletAddress: WALLET, walletChainId: 4663, amountMicro: 1n, fetchImpl: h.fetchImpl }),
      /switch to 46630/
    );
    assert.equal(h.calls.length, 0);
  });

  it("not enough USDG: stops after the balance read, no transfer popup", async () => {
    const h = harness({ balance: 50_000n });
    await assert.rejects(
      topUpWithUsdgDeposit({ provider: h.provider, walletAddress: WALLET, walletChainId: 46630, amountMicro: 100_000n, fetchImpl: h.fetchImpl }),
      /holds 0\.05 USDG.*0\.1 USDG needed/
    );
    assert.deepEqual(h.calls.map((c) => c.method), ["eth_call"]);
  });

  it("wallet RPC unreachable: readable message instead of [object Object]", async () => {
    const h = harness({ rpcDown: true });
    let caught: unknown;
    try {
      await topUpWithUsdgDeposit({ provider: h.provider, walletAddress: WALLET, walletChainId: 46630, amountMicro: 1n, fetchImpl: h.fetchImpl });
    } catch (err) {
      caught = err;
    }
    const text = describeWalletError(caught);
    assert.doesNotMatch(text, /object Object/);
    assert.match(text, /could not reach the chain RPC/);
    assert.equal(describeWalletError({ code: 4001, message: "User rejected the request." }), "Rejected in wallet.");
    assert.match(describeWalletError({ code: -32000, message: "execution reverted: transfer amount exceeds balance" }), /not enough USDG/);
  });

  it("reverted transfer never claims", async () => {
    const h = harness({ receiptStatus: "0x0" });
    await assert.rejects(
      topUpWithUsdgDeposit({ provider: h.provider, walletAddress: WALLET, walletChainId: 46630, amountMicro: 1n, fetchImpl: h.fetchImpl, pollMs: 1 }),
      /reverted/
    );
    assert.equal(h.fetches.some((f) => f.url === "/v1/register"), false);
  });

  it("retries once on a confirmation lag, surfaces any other rejection", async () => {
    const lag = { status: 402, body: { error: "X-PAYMENT transaction has 2 confirmation(s); 3 required. Retry shortly." } };
    const ok = harness({ registerReplies: [lag, { status: 201, body: { apiKey: "zg_live_x", creditMicroUsdg: "1" } }] });
    const res = await topUpWithUsdgDeposit({
      provider: ok.provider, walletAddress: WALLET, walletChainId: 46630, amountMicro: 1n, fetchImpl: ok.fetchImpl, pollMs: 1,
    });
    assert.equal(res.apiKey, "zg_live_x");

    const replay = harness({ registerReplies: [{ status: 402, body: { error: "X-PAYMENT txHash already redeemed (replay blocked)" } }] });
    await assert.rejects(
      topUpWithUsdgDeposit({ provider: replay.provider, walletAddress: WALLET, walletChainId: 46630, amountMicro: 1n, fetchImpl: replay.fetchImpl, pollMs: 1 }),
      /replay blocked/
    );
    assert.equal(replay.fetches.filter((f) => f.url === "/v1/register").length, 1);
  });
});
