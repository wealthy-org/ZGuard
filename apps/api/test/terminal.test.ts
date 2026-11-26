/**
 * Gap C8 / §9.5 (terminal): the local RHC/pons trading terminal (`@zguard/terminal`, `zguard-terminal`).
 * Every approve / buy / sell must pass ZGuard before the wallet signs, and turning the guard off, a
 * missing key, an unreachable API, deny, abstain or an expired allow must never reach the wallet. Offline.
 *   tsx --test test/terminal.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionResult, getAddress, type Hex } from "viem";
import {
  computePayloadHash,
  GuardBlockedError,
  GuardDisabledError,
  guardOffline,
  type GuardRequest,
  type GuardResponse,
} from "@zguard/sdk";
import {
  buildCurveBuy,
  buildCurveSell,
  buildExactApprove,
  createPonsTerminal,
  minOutWithSlippage,
  PONS_CURVE_TRADE_ABI,
  PONS_TOKEN_ABI,
  TerminalGuardUnavailableError,
  type ChainReader,
} from "@zguard/terminal";

const CHAIN = 46630;
const NETWORK = `eip155:${CHAIN}`;
const TOKEN = getAddress("0x9118BD806cB3906Dc6d50a4409a9e9dF48172365"); // KOIP (testnet pons)
const CURVE = getAddress("0x7206856a27B19c17e7b185D33430E0359AfEF3A5");
const WALLET = getAddress("0x3d2faC269954487a63f51bF059701fbD9647e3Bf");
const OTHER = getAddress("0x000000000000000000000000000000000000dEaD");
const NOW = 1_800_000_000;

function fakeChain(over: Partial<{ curveToken: string; graduated: boolean; balance: bigint; allowance: bigint }> = {}) {
  const state = { curveToken: TOKEN as string, graduated: false, balance: 10n ** 24n, allowance: 0n, ...over };
  const mined: Hex[] = [];
  const reader: ChainReader = {
    async readContract({ address, functionName, args }) {
      const a = getAddress(address);
      if (a === TOKEN && functionName === "curve") return CURVE;
      if (a === CURVE && functionName === "token") return state.curveToken;
      if (a === CURVE && functionName === "graduated") return state.graduated;
      if (a === TOKEN && functionName === "balanceOf") return state.balance;
      if (a === TOKEN && functionName === "allowance") {
        assert.equal(getAddress(String(args?.[1])), CURVE);
        return state.allowance;
      }
      throw new Error(`unexpected read ${a}.${functionName}`);
    },
    async call({ to, data }) {
      assert.equal(getAddress(to), CURVE);
      const { functionName } = decodeFunctionData({ abi: PONS_CURVE_TRADE_ABI, data });
      const out = functionName === "buy" ? 40_000n * 10n ** 18n : 250_000_000_000n;
      return { data: encodeFunctionResult({ abi: PONS_CURVE_TRADE_ABI, functionName, result: out }) };
    },
    async waitForTransactionReceipt({ hash }) {
      mined.push(hash);
      return { status: "success" };
    },
  };
  return { reader, state, mined };
}

function spyWallet(onSend?: (tx: Record<string, unknown>) => void) {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    signer: {
      async signTypedData(): Promise<Hex> {
        throw new Error("not used");
      },
      async sendTransaction(tx: Record<string, unknown>): Promise<Hex> {
        sent.push(tx);
        onSend?.(tx);
        return `0x${String(sent.length).padStart(64, "0")}` as Hex;
      },
    },
  };
}

function evaluator(decision: GuardResponse["decision"], opts: { expiresInMs?: number } = {}) {
  const seen: GuardRequest[] = [];
  const evaluate = async (req: GuardRequest): Promise<GuardResponse> => {
    seen.push(req);
    return {
      decision,
      reason: decision,
      codes: decision === "allow" ? [] : ["Q-001"],
      payload_hash: computePayloadHash(req),
      checks: {},
      flags: [],
      charged: null,
      network: req.network,
      expires_at: new Date(Date.now() + (opts.expiresInMs ?? 30_000)).toISOString(),
    } as GuardResponse;
  };
  return { evaluate, seen };
}

function terminal(over: Record<string, unknown> = {}) {
  const chain = fakeChain();
  const wallet = spyWallet();
  const ev = evaluator("allow");
  const t = createPonsTerminal({
    chainId: CHAIN,
    account: WALLET,
    reader: chain.reader,
    signer: wallet.signer,
    evaluate: ev.evaluate,
    nowSeconds: () => NOW,
    ...over,
  });
  return { t, chain, wallet, ev };
}

describe("[terminal] intents are built from the same values as the signed bytes", () => {
  it("buy / sell / exact approve pass offline quote parity; tampered bytes are denied", () => {
    const buy = buildCurveBuy({ chainId: CHAIN, curve: CURVE, token: TOKEN, from: WALLET, ethIn: 10n ** 14n, minTokensOut: 5n, deadline: 99n });
    const sell = buildCurveSell({ chainId: CHAIN, curve: CURVE, from: WALLET, tokensIn: 7n, minEthOut: 3n, deadline: 99n });
    const approve = buildExactApprove({ chainId: CHAIN, token: TOKEN, spender: CURVE, from: WALLET, amount: 7n });
    for (const c of [buy, sell, approve]) {
      const r = guardOffline({ network: NETWORK, payload: { type: "intent", tx: c.tx, intent: c.intent }, checks: ["quote"] });
      assert.equal(r.checks.quote?.decision, "allow", JSON.stringify(r.checks.quote));
    }
    // Same intent, but the tx asks for a lower minimum (a sandwich-friendly change) → denied.
    const tampered = buildCurveBuy({ chainId: CHAIN, curve: CURVE, token: TOKEN, from: WALLET, ethIn: 10n ** 14n, minTokensOut: 1n, deadline: 99n });
    const bad = guardOffline({ network: NETWORK, payload: { type: "intent", tx: tampered.tx, intent: buy.intent }, checks: ["quote"] });
    assert.equal(bad.checks.quote?.decision, "deny");
    // Approval to another spender than the one the intent allows → denied.
    const wide = buildExactApprove({ chainId: CHAIN, token: TOKEN, spender: OTHER, from: WALLET, amount: 7n });
    const spender = guardOffline({ network: NETWORK, payload: { type: "intent", tx: wide.tx, intent: approve.intent }, checks: ["quote"] });
    assert.equal(spender.checks.quote?.decision, "deny");
  });

  it("slippage is bounded (1..2000 bps) and rounds down", () => {
    assert.equal(minOutWithSlippage(10_000n, 300), 9_700n);
    assert.equal(minOutWithSlippage(999n, 1), 998n);
    assert.throws(() => minOutWithSlippage(1n, 0));
    assert.throws(() => minOutWithSlippage(1n, 2001));
  });
});

describe("[terminal] only an allow bound to the exact bytes reaches the wallet", () => {
  it("allow: buy sends exactly the guarded tx once and waits for it", async () => {
    const { t, wallet, ev, chain } = terminal();
    const res = await t.buy(TOKEN, 10n ** 14n);
    assert.equal(ev.seen.length, 1);
    assert.deepEqual(ev.seen[0]!.checks, ["quote", "simulation", "token_risk"]);
    assert.equal(ev.seen[0]!.token, TOKEN);
    assert.equal(wallet.sent.length, 1);
    const sent = wallet.sent[0]!;
    assert.equal(sent.to, CURVE);
    assert.equal(sent.from, WALLET);
    assert.equal(sent.value, (10n ** 14n).toString());
    assert.equal(sent.data, res.call.tx.data);
    const { args } = decodeFunctionData({ abi: PONS_CURVE_TRADE_ABI, data: sent.data as Hex });
    assert.equal(args[0], minOutWithSlippage(40_000n * 10n ** 18n, 300));
    assert.equal(args[1], BigInt(NOW + 600));
    assert.deepEqual(chain.mined, [res.hash]);
  });

  for (const decision of ["deny", "abstain"] as const) {
    it(`${decision}: nothing is signed`, async () => {
      const ev = evaluator(decision);
      const { t, wallet } = terminal({ evaluate: ev.evaluate });
      await assert.rejects(() => t.buy(TOKEN, 10n ** 14n), GuardBlockedError);
      assert.equal(wallet.sent.length, 0);
    });
  }

  it("expired allow: nothing is signed", async () => {
    const ev = evaluator("allow", { expiresInMs: -1_000 });
    const { t, wallet } = terminal({ evaluate: ev.evaluate });
    await assert.rejects(() => t.buy(TOKEN, 10n ** 14n), GuardBlockedError);
    assert.equal(wallet.sent.length, 0);
  });

  it("ZGuard unreachable: TerminalGuardUnavailableError, nothing is signed", async () => {
    const { t, wallet } = terminal({
      evaluate: async () => {
        throw new Error("fetch failed");
      },
    });
    await assert.rejects(() => t.buy(TOKEN, 10n ** 14n), TerminalGuardUnavailableError);
    assert.equal(wallet.sent.length, 0);
  });

  it("missing ZGUARD_API_KEY: the terminal refuses to start a guarded session", () => {
    const chain = fakeChain();
    const wallet = spyWallet();
    assert.throws(
      () => createPonsTerminal({ chainId: CHAIN, account: WALLET, reader: chain.reader, signer: wallet.signer, zguard: { apiKey: " " } }),
      TerminalGuardUnavailableError
    );
  });

  it("mode off: GuardDisabledError before any evaluation or signature (no unguarded path)", async () => {
    const ev = evaluator("allow");
    const { t, wallet } = terminal({ mode: "off", evaluate: ev.evaluate });
    await assert.rejects(() => t.buy(TOKEN, 10n ** 14n), GuardDisabledError);
    await assert.rejects(() => t.sell(TOKEN, 1n), GuardDisabledError);
    assert.equal(ev.seen.length, 0);
    assert.equal(wallet.sent.length, 0);
  });

  it("a wallet that swaps the bytes after the verdict cannot make the guard sign something else", async () => {
    // guardEvmSigner snapshots the tx; the wallet receives exactly the checked fields.
    const { t, wallet } = terminal();
    const res = await t.buy(TOKEN, 10n ** 14n);
    assert.equal(wallet.sent[0]!.data, res.call.tx.data);
    assert.deepEqual(Object.keys(wallet.sent[0]!).sort(), ["chainId", "data", "from", "to", "value"]);
  });
});

describe("[terminal] sell: exact approval to the resolved curve, then sell, each guarded", () => {
  it("allowance 0 → approve exactly tokensIn to the curve (allowApprovals), then sell", async () => {
    const { t, wallet, ev } = terminal();
    const amount = 123n * 10n ** 18n;
    const res = await t.sell(TOKEN, amount);
    assert.equal(ev.seen.length, 2);
    assert.equal(wallet.sent.length, 2);
    const approve = decodeFunctionData({ abi: PONS_TOKEN_ABI, data: wallet.sent[0]!.data as Hex });
    assert.equal(approve.functionName, "approve");
    assert.deepEqual(approve.args, [CURVE, amount]);
    assert.equal(wallet.sent[0]!.to, TOKEN);
    assert.deepEqual(res.approval?.call.intent.allowApprovals, [{ token: TOKEN, spender: CURVE, maxAmount: amount.toString() }]);
    const sell = decodeFunctionData({ abi: PONS_CURVE_TRADE_ABI, data: wallet.sent[1]!.data as Hex });
    assert.equal(sell.functionName, "sell");
    assert.equal(sell.args[0], amount);
    assert.equal(sell.args[1], minOutWithSlippage(250_000_000_000n, 300));
  });

  it("enough allowance → no approval transaction", async () => {
    const chain = fakeChain({ allowance: 10n ** 30n });
    const wallet = spyWallet();
    const ev = evaluator("allow");
    const t = createPonsTerminal({ chainId: CHAIN, account: WALLET, reader: chain.reader, signer: wallet.signer, evaluate: ev.evaluate });
    const res = await t.sell(TOKEN, 5n);
    assert.equal(res.approval, undefined);
    assert.equal(wallet.sent.length, 1);
  });

  it("balance too low → refused before ZGuard or the wallet", async () => {
    const chain = fakeChain({ balance: 1n });
    const wallet = spyWallet();
    const ev = evaluator("allow");
    const t = createPonsTerminal({ chainId: CHAIN, account: WALLET, reader: chain.reader, signer: wallet.signer, evaluate: ev.evaluate });
    await assert.rejects(() => t.sell(TOKEN, 5n), /Balance/);
    assert.equal(ev.seen.length + wallet.sent.length, 0);
  });
});

describe("[terminal] curve resolution", () => {
  it("a curve that does not point back to the token is refused", async () => {
    const chain = fakeChain({ curveToken: OTHER });
    const wallet = spyWallet();
    const ev = evaluator("allow");
    const t = createPonsTerminal({ chainId: CHAIN, account: WALLET, reader: chain.reader, signer: wallet.signer, evaluate: ev.evaluate });
    await assert.rejects(() => t.buy(TOKEN, 1n), /does not belong/);
    assert.equal(ev.seen.length + wallet.sent.length, 0);
  });

  it("a graduated token is sent to the DEX, not traded on the curve", async () => {
    const chain = fakeChain({ graduated: true });
    const wallet = spyWallet();
    const ev = evaluator("allow");
    const t = createPonsTerminal({ chainId: CHAIN, account: WALLET, reader: chain.reader, signer: wallet.signer, evaluate: ev.evaluate });
    await assert.rejects(() => t.buy(TOKEN, 1n), /graduated/);
    assert.equal(wallet.sent.length, 0);
  });
});
