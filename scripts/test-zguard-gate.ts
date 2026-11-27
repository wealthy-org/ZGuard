import assert from "node:assert/strict";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { erc20Abi, permRouterAbi } from "../lib/web3/abis";
import {
  ZGuardRequestError,
  buildZGuardSwapRequest,
  computeZGuardPayloadHash,
  evaluateZGuardReceipt,
} from "../lib/zguard/request";
import { ZGuardBlockedError, fetchZGuardStatus, guardPermSwap } from "../lib/zguard/client";
import { callZGuard, zguardServerConfig } from "../lib/server/zguard";

// ZGuard gap C8 / brief §9.5: Perm swaps are default-on guarded and fail closed.

const ROUTER = "0xFdC667735C8998fEB83C4c3c7B4eCFB404DAFA87" as Address;
const FROM = "0x141DB8c1C42B0fa5b13eE17136e4E037597886a8" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const NVDA = "0x3ab049897b0697BdA766D8730fe1F955c9c103F0" as Address;

const swapRequest = {
  tokenIn: ZERO, tokenOut: NVDA, amountIn: 100000000000000n, minAmountOut: 123456789012345678n, gasEstimate: 250000n,
  recipient: FROM, deadline: 1795502330n, quotedAt: 1795502030n, policyVersion: 1, chainId: 46630n,
  quoteId: `0x${"ab".repeat(32)}` as Hex, referrer: ZERO, routeData: "0x1234abcd" as Hex,
} as const;
const permit = { nonce: 0n, deadline: 0n, signature: "0x" as Hex };
const encode = (request: typeof swapRequest | Record<string, unknown>) =>
  encodeFunctionData({ abi: permRouterAbi, functionName: "swapExactInput", args: [request as typeof swapRequest, `0x${"11".repeat(65)}` as Hex, permit] });
const data = encode(swapRequest);
const tx = { chainId: 46630, router: ROUTER, from: FROM, data, value: swapRequest.amountIn };

// 1. Hash parity with @zguard/sdk computePayloadHash. The constant was produced by the ZGuard SDK
//    (packages/sdk/src/hash.ts) for this exact fixture, and the live ZGuard API returned the same
//    payload_hash for it. If ZGuard changes its canonical form, this fails before users are blocked.
const ZGUARD_SDK_VECTOR = "0xc4ecff7cecbffd0e8efd8536a0ca01c9cb1ed029fb2921d53fa6b34505d9feae";
const built = buildZGuardSwapRequest(tx);
assert.equal(computeZGuardPayloadHash(built), ZGUARD_SDK_VECTOR);
assert.equal(built.network, "eip155:46630");
assert.equal(built.token, NVDA, "risk check runs on the output token");
assert.deepEqual(built.checks, ["quote", "simulation", "token_risk"]);
assert.equal(built.payload.tx.to, ROUTER);
assert.equal(built.payload.intent.expectedOut.minAmountOut, "123456789012345678");
assert.equal(built.payload.intent.function, "swapExactInput");

// Any byte change changes the hash (the verdict cannot be reused for another trade).
const otherData = encode({ ...swapRequest, minAmountOut: 1n });
assert.notEqual(computeZGuardPayloadHash(buildZGuardSwapRequest({ ...tx, data: otherData })), ZGUARD_SDK_VECTOR);

// Token-in risk is used when the output is native ETH.
const sellNvda = encode({ ...swapRequest, tokenIn: NVDA, tokenOut: ZERO });
assert.equal(buildZGuardSwapRequest({ ...tx, data: sellNvda, value: 0n }).token, NVDA);

// 2. The builder (also used by /api/zguard) refuses anything that is not this chain's swap.
const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, 1n] });
assert.throws(() => buildZGuardSwapRequest({ ...tx, data: approve }), ZGuardRequestError);
assert.throws(() => buildZGuardSwapRequest({ ...tx, chainId: 4663 }), /chain id/);
assert.throws(() => buildZGuardSwapRequest({ ...tx, value: 1n }), /value/);
assert.throws(() => buildZGuardSwapRequest({ ...tx, from: ZERO }), /sender/);
assert.throws(() => buildZGuardSwapRequest({ ...tx, data: "0xzz" as Hex }), /calldata/);

// 3. Verdict evaluation mirrors verifyReceiptForSigning: only a fresh, hash-bound allow passes.
const now = Date.parse("2026-11-26T00:00:00Z");
const future = new Date(now + 60_000).toISOString();
const allow = { decisionId: "dec_1", decision: "allow", codes: [], payload_hash: ZGUARD_SDK_VECTOR, expires_at: future };
assert.deepEqual(evaluateZGuardReceipt(allow, ZGUARD_SDK_VECTOR, now), { ok: true, decisionId: "dec_1", expiresAt: future });
assert.equal(evaluateZGuardReceipt({ ...allow, payload_hash: ZGUARD_SDK_VECTOR.toUpperCase().replace("0X", "0x") }, ZGUARD_SDK_VECTOR, now).ok, true);
for (const [receipt, decision] of [
  [{ ...allow, decision: "deny", codes: ["T-MINT"], reason: "token_risk denied" }, "deny"],
  [{ ...allow, decision: "abstain", codes: ["S-FAIL"] }, "abstain"],
  [{ ...allow, payload_hash: `0x${"00".repeat(32)}` }, "mismatch"],
  [{ ...allow, expires_at: new Date(now - 1).toISOString() }, "expired"],
  [{ ...allow, expires_at: null }, "expired"],
  [null, "missing"],
] as const) {
  const verdict = evaluateZGuardReceipt(receipt, ZGUARD_SDK_VECTOR, now);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.decision, decision);
}

async function main() {
  // 4. Browser gate with a mocked /api/zguard. Count wallet sends: blocked paths must reach 0.
  type MockReply = { status: number; body: unknown } | Error;
  function mockFetch(reply: MockReply) {
    const calls: Array<{ url: string; body?: string }> = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  async function guardedSend(reply: MockReply) {
    let walletSends = 0;
    const { impl, calls } = mockFetch(reply);
    try {
      const result = await guardPermSwap(tx, impl, () => now);
      walletSends += 1; // TradeApp sends exactly once after guardPermSwap returns.
      return { result, walletSends, calls };
    } catch (error) {
      return { error, walletSends, calls };
    }
  }

  {
    const ok = await guardedSend({ status: 200, body: { mode: "enforce", receipt: allow } });
    assert.equal(ok.walletSends, 1);
    assert.equal(ok.result?.mode, "enforce");
    const sent = JSON.parse(ok.calls[0].body ?? "{}");
    assert.deepEqual(sent, { from: FROM, to: ROUTER, data, value: "100000000000000" }, "only the raw bytes leave the browser");
  }
  for (const reply of [
    { status: 200, body: { mode: "enforce", receipt: { ...allow, decision: "deny", codes: ["T-MINT"] } } },
    { status: 200, body: { mode: "enforce", receipt: { ...allow, decision: "abstain" } } },
    { status: 200, body: { mode: "enforce", receipt: { ...allow, payload_hash: `0x${"00".repeat(32)}` } } },
    { status: 503, body: { error: "ZGuard is required but not ready: PERM_ZGUARD_API_KEY is not set", mode: "enforce" } },
    { status: 503, body: { error: "ZGuard credit for this Perm deployment is exhausted", mode: "enforce" } },
    { status: 429, body: { error: "Too many ZGuard checks" } },
    { status: 500, body: "not json" },
    new TypeError("fetch failed"),
  ] as MockReply[]) {
    const blocked = await guardedSend(reply);
    assert.equal(blocked.walletSends, 0, `blocked path reached the wallet: ${JSON.stringify(reply)}`);
    assert.ok(blocked.error instanceof ZGuardBlockedError);
    assert.match((blocked.error as Error).message, /not sent|blocked|could not confirm/i);
  }
  {
    const off = await guardedSend({ status: 409, body: { mode: "off", error: "switched off" } });
    assert.equal(off.walletSends, 1, "explicit server-side off lets the swap through (UI shows the red banner)");
    assert.equal(off.result?.mode, "off");
    // A 409 that does not say mode=off is not an off switch.
    const fake = await guardedSend({ status: 409, body: { error: "conflict" } });
    assert.equal(fake.walletSends, 0);
  }

  // 5. Status endpoint: unknown/unreachable is enforce, never off (UI hard-fails, button disabled).
  assert.deepEqual(await fetchZGuardStatus(mockFetch(new TypeError("offline")).impl), { mode: "enforce", ready: false, network: "", problem: "ZGuard status is unavailable" });
  assert.equal((await fetchZGuardStatus(mockFetch({ status: 200, body: { mode: "weird", ready: true } }).impl)).mode, "enforce");
  assert.equal((await fetchZGuardStatus(mockFetch({ status: 200, body: { mode: "off", ready: true } }).impl)).ready, false);

  // 6. Server config: default-on; only the exact string "off" disables; missing key = not ready.
  const key = "zg_live_0123456789abcdef";
  assert.equal(zguardServerConfig({}).mode, "enforce");
  assert.equal(zguardServerConfig({}).ready, false);
  assert.match(zguardServerConfig({}).problem ?? "", /PERM_ZGUARD_API_KEY/);
  assert.equal(zguardServerConfig({ PERM_ZGUARD_API_KEY: key }).ready, true);
  assert.equal(zguardServerConfig({ PERM_ZGUARD_API_KEY: key }).apiUrl, "https://zguard-delta.vercel.app");
  for (const value of ["OFF", "false", "0", "disabled", " no "]) assert.equal(zguardServerConfig({ PERM_ZGUARD_MODE: value }).mode, "enforce", value);
  assert.equal(zguardServerConfig({ PERM_ZGUARD_MODE: "off" }).mode, "off");
  assert.match(zguardServerConfig({ PERM_ZGUARD_API_KEY: key, PERM_ZGUARD_API_URL: "http://evil.example" }).problem ?? "", /https/);
  assert.equal(zguardServerConfig({ PERM_ZGUARD_API_KEY: key, PERM_ZGUARD_API_URL: "http://127.0.0.1:8787/" }).ready, true);
  assert.match(zguardServerConfig({ PERM_ZGUARD_API_KEY: "not-a-key" }).problem ?? "", /format/);

  // 7. Upstream call: not ready never calls ZGuard; HTTP errors map to fail-closed errors; key goes in the header only.
  {
    const { impl, calls } = mockFetch({ status: 200, body: allow });
    assert.equal((await callZGuard(zguardServerConfig({}), built, impl)).ok, false);
    assert.equal(calls.length, 0);
  }
  for (const [status, pattern] of [[402, /credit/], [401, /key/], [429, /rate limit/], [500, /HTTP 500/]] as const) {
    const result = await callZGuard(zguardServerConfig({ PERM_ZGUARD_API_KEY: key }), built, mockFetch({ status, body: {} }).impl);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, pattern);
  }
  {
    let seenAuth = "";
    let seenBody = "";
    const impl = (async (_url: string, init?: RequestInit) => {
      seenAuth = new Headers(init?.headers).get("authorization") ?? "";
      seenBody = String(init?.body);
      return new Response(JSON.stringify(allow), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await callZGuard(zguardServerConfig({ PERM_ZGUARD_API_KEY: key }), built, impl);
    assert.equal(result.ok, true);
    assert.equal(seenAuth, `Bearer ${key}`);
    assert.ok(!seenBody.includes(key), "API key is never placed in the request body");
  }

  console.log("zguard gate: all checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
