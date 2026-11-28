/**
 * I5 crosscheck of packages/sdk/src/signer.ts: every byte the wallet signs must be the byte ZGuard checked.
 * Offline.  tsx --test test/poc-signer.test.ts
 *
 * [SIG-1] fields outside the payload hash (EIP-7702 authorizationList, `input`, blob fields, unknown keys)
 *         must never reach the wallet.
 * [SIG-2] the chain the wallet signs for must be the chain ZGuard evaluated.
 * [SIG-3] the caller mutating the tx/typed data while the verdict is awaited must not change what is signed.
 * [SIG-4] signEip3009Authorization only signs EIP-3009 typed data for the evaluated chain.
 * [SIG-5] integrations fall back to signTransaction when the wallet has no sendTransaction.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GuardBlockedError,
  computePayloadHash,
  createPermRouterGuard,
  guardEvmSigner,
  verifyReceiptForSigning,
  type GuardRequest,
  type GuardResponse,
} from "@zguard/sdk";

const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const HOLDER = "0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79";
const PAYEE = "0x000000000000000000000000000000000000aaaa";
const DATA =
  "0xa9059cbb000000000000000000000000000000000000000000000000000000000000aaaa0000000000000000000000000000000000000000000000000000000000000001";
const intent = {
  chainId: 46630,
  to: USDG,
  function: "transfer(address,uint256)",
  args: [PAYEE, "1"],
  value: "0",
  from: HOLDER,
};
const baseTx = { chainId: 46630, from: HOLDER, to: USDG, value: "0", data: DATA };

function spySigner(opts: { send?: boolean } = {}) {
  const seen: Array<{ method: string; arg: Record<string, unknown> }> = [];
  const signer: Record<string, unknown> = {
    async signTransaction(arg: Record<string, unknown>) {
      seen.push({ method: "signTransaction", arg });
      return "0xsigned" as `0x${string}`;
    },
    async signTypedData(arg: Record<string, unknown>) {
      seen.push({ method: "signTypedData", arg });
      return "0xsig" as `0x${string}`;
    },
  };
  if (opts.send !== false) {
    signer.sendTransaction = async (arg: Record<string, unknown>) => {
      seen.push({ method: "sendTransaction", arg });
      return "0xhash" as `0x${string}`;
    };
  }
  return { seen, signer: signer as never };
}

/** An honest evaluator: allow, bound to exactly the request it was shown. */
function allow(onEvaluate?: (req: GuardRequest) => void) {
  return async (req: GuardRequest): Promise<GuardResponse> => {
    const payload_hash = computePayloadHash(req);
    onEvaluate?.(req);
    return {
      decision: "allow",
      reason: "allow",
      codes: [],
      payload_hash,
      checks: {},
      flags: [],
      charged: null,
      network: req.network,
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    } as GuardResponse;
  };
}

describe("[SIG-1] only hashed fields reach the wallet", () => {
  it("refuses an EIP-7702 authorizationList riding on an allowed tx", async () => {
    const { signer, seen } = spySigner();
    const g = guardEvmSigner(signer, { network: "eip155:46630", evaluate: allow() });
    const tx = {
      ...baseTx,
      authorizationList: [{ chainId: 46630, address: "0x000000000000000000000000000000000000dead", nonce: 0 }],
    };
    await assert.rejects(() => g.sendTransaction(tx as never, { intent }), GuardBlockedError);
    assert.equal(seen.length, 0);
  });

  it("refuses an `input` field that differs from the hashed `data`", async () => {
    const { signer, seen } = spySigner();
    const g = guardEvmSigner(signer, { network: "eip155:46630", evaluate: allow() });
    const tx = { ...baseTx, input: "0x095ea7b3" + "00".repeat(64) };
    await assert.rejects(() => g.signTransaction(tx as never, { intent }), GuardBlockedError);
    assert.equal(seen.length, 0);
  });

  it("refuses EIP-7702 / blob transaction types and unknown keys", async () => {
    const g = guardEvmSigner(spySigner().signer, { network: "eip155:46630", evaluate: allow() });
    for (const extra of [{ type: "eip7702" }, { type: 4 }, { type: "0x3" }, { blobs: ["0x00"] }, { maxFeePerBlobGas: "1" }, { foo: 1 }]) {
      await assert.rejects(() => g.sendTransaction({ ...baseTx, ...extra } as never, { intent }), GuardBlockedError, JSON.stringify(extra));
    }
  });

  it("refuses contract creation (no `to`): there is nothing to compare with the intent", async () => {
    const g = guardEvmSigner(spySigner().signer, { network: "eip155:46630", evaluate: allow() });
    const { to: _to, ...noTo } = baseTx;
    await assert.rejects(() => g.sendTransaction(noTo as never, { intent }), GuardBlockedError);
  });

  it("still signs a normal EIP-1559 tx with gas/fee/nonce fields and viem-style account/chain", async () => {
    const { signer, seen } = spySigner();
    const g = guardEvmSigner(signer, { network: "eip155:46630", evaluate: allow() });
    const tx = {
      ...baseTx,
      gas: "60000",
      maxFeePerGas: "30000000",
      maxPriorityFeePerGas: "0",
      nonce: 7,
      type: "eip1559",
      accessList: [],
      account: HOLDER,
      chain: { id: 46630, name: "Robinhood Testnet" },
    };
    assert.equal(await g.sendTransaction(tx as never, { intent }), "0xhash");
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.arg.data, DATA);
    assert.equal(seen[0]!.arg.nonce, 7);
  });

  it("refuses a viem `account` that is not the hashed `from`", async () => {
    const g = guardEvmSigner(spySigner().signer, { network: "eip155:46630", evaluate: allow() });
    const tx = { ...baseTx, account: "0x000000000000000000000000000000000000bEEF" };
    await assert.rejects(() => g.sendTransaction(tx as never, { intent }), GuardBlockedError);
  });
});

describe("[SIG-2] the signed chain is the evaluated chain", () => {
  it("refuses tx.chainId different from the evaluated network", async () => {
    const { signer, seen } = spySigner();
    const g = guardEvmSigner(signer, { network: "eip155:46630", evaluate: allow() });
    await assert.rejects(() => g.sendTransaction({ ...baseTx, chainId: 4663 } as never, { intent }), GuardBlockedError);
    assert.equal(seen.length, 0);
  });

  it("refuses a viem `chain` object for another chain", async () => {
    const g = guardEvmSigner(spySigner().signer, { network: "eip155:46630", evaluate: allow() });
    await assert.rejects(
      () => g.sendTransaction({ ...baseTx, chain: { id: 4663 } } as never, { intent }),
      GuardBlockedError
    );
  });

  it("pins chainId on a tx that omitted it, so the wallet cannot send it on another chain", async () => {
    const { signer, seen } = spySigner();
    const g = guardEvmSigner(signer, { network: "eip155:46630", evaluate: allow() });
    const { chainId: _c, ...noChain } = baseTx;
    await g.sendTransaction(noChain as never, { intent });
    assert.equal(seen[0]!.arg.chainId, 46630);
  });
});

describe("[SIG-3] no time-of-check/time-of-use gap", () => {
  it("signs the bytes that were evaluated even if the caller mutates the tx while awaiting", async () => {
    const { signer, seen } = spySigner();
    const tx: Record<string, unknown> = { ...baseTx };
    const evil = "0x095ea7b3" + "00".repeat(64);
    const g = guardEvmSigner(signer, {
      network: "eip155:46630",
      evaluate: allow(() => {
        tx.data = evil; // e.g. another async task re-using the same object
      }),
    });
    await g.sendTransaction(tx as never, { intent });
    assert.equal(seen[0]!.arg.data, DATA);
  });

  it("signs the typed data that was evaluated even if the caller mutates it while awaiting", async () => {
    const { signer, seen } = spySigner();
    const typed = eip3009Typed();
    const g = guardEvmSigner(signer, {
      evaluate: allow(() => {
        (typed.message as Record<string, unknown>).to = "0x000000000000000000000000000000000000bEEF";
      }),
    });
    await g.signTypedData(typed as never, { quote });
    const signed = seen[0]!.arg.message as Record<string, unknown>;
    assert.equal(signed.to, PAYEE);
  });
});

const quote = { asset: USDG, payTo: PAYEE, amount: "1", chainId: 46630, network: "eip155:46630" };
function eip3009Typed(overrides: { primaryType?: string; chainId?: number } = {}) {
  return {
    domain: { name: "USDG", version: "1", chainId: overrides.chainId ?? 46630, verifyingContract: USDG },
    primaryType: overrides.primaryType ?? "TransferWithAuthorization",
    types: {},
    message: {
      from: HOLDER,
      to: PAYEE,
      value: 1n,
      validAfter: 0n,
      validBefore: 9999999999n,
      nonce: "0x" + "11".repeat(32),
    },
  };
}

describe("[SIG-4] signEip3009Authorization", () => {
  it("refuses a non-EIP-3009 primaryType at runtime (JS callers bypass the TS type)", async () => {
    const { signer, seen } = spySigner();
    const g = guardEvmSigner(signer, { evaluate: allow() });
    await assert.rejects(
      () => g.signEip3009Authorization(eip3009Typed({ primaryType: "Permit" }) as never, { quote }),
      GuardBlockedError
    );
    assert.equal(seen.length, 0);
  });

  it("refuses a domain chainId different from the evaluated network", async () => {
    const { signer, seen } = spySigner();
    const g = guardEvmSigner(signer, { network: "eip155:46630", evaluate: allow() });
    await assert.rejects(
      () => g.signEip3009Authorization(eip3009Typed({ chainId: 4663 }) as never, { quote }),
      GuardBlockedError
    );
    await assert.rejects(() => g.signTypedData(eip3009Typed({ chainId: 4663 }) as never, { quote }), GuardBlockedError);
    assert.equal(seen.length, 0);
  });

  it("still signs a matching EIP-3009 authorization", async () => {
    const { signer, seen } = spySigner();
    const g = guardEvmSigner(signer, { evaluate: allow() });
    const out = await g.signEip3009Authorization(eip3009Typed() as never, { quote });
    assert.equal(out.signature, "0xsig");
    assert.equal(seen.length, 1);
  });
});

describe("[SIG-5] integrations", () => {
  it("createPermRouterGuard falls back to signTransaction when the wallet has no sendTransaction", async () => {
    const { signer, seen } = spySigner({ send: false });
    const perm = createPermRouterGuard({ chainId: 46630, evaluate: allow() });
    const out = await perm.guardAndSignRoute({ intent, tx: baseTx as never, tokenAddress: USDG, signer });
    assert.equal(out.txHashOrSig, "0xsigned");
    assert.deepEqual(seen.map((s) => s.method), ["signTransaction"]);
  });
});

describe("[SIG-6] receipt network and abstain override are bounded (gap signer c/d)", () => {
  const req = { network: "eip155:46630", payload: { type: "intent" as const, intent } };
  const receiptFor = (over: Partial<GuardResponse>): GuardResponse =>
    ({
      decisionId: "d",
      decision: "allow",
      reason: "ok",
      codes: [],
      payload_hash: computePayloadHash(req),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      network: "eip155:46630",
      checks: {},
      flags: [],
      charged: null,
      ...over,
    }) as GuardResponse;

  it("(c) refuses a receipt whose network differs from the signing network", () => {
    assert.throws(
      () => verifyReceiptForSigning(req, receiptFor({ network: "eip155:4663" })),
      (e: unknown) => e instanceof GuardBlockedError && /receipt is for eip155:4663/.test(e.message)
    );
    assert.deepEqual(verifyReceiptForSigning(req, receiptFor({})), { allowed: true, abstainOverrideUsed: false });
  });

  it("(d) a stored abstain receipt without expiry cannot be replayed with the override", () => {
    const abstain = receiptFor({ decision: "abstain", expires_at: null });
    assert.throws(
      () => verifyReceiptForSigning(req, abstain, { allowAbstainOverride: true }),
      (e: unknown) => e instanceof GuardBlockedError && /fresh verdict/.test(e.message)
    );
    assert.equal(verifyReceiptForSigning(req, abstain, { allowAbstainOverride: true, freshlyEvaluated: true }).abstainOverrideUsed, true);
    const expired = receiptFor({ decision: "abstain", expires_at: new Date(Date.now() - 1000).toISOString() });
    assert.throws(() => verifyReceiptForSigning(req, expired, { allowAbstainOverride: true, freshlyEvaluated: true }), /expired verdict/);
  });

  it("(d) guardEvmSigner: override works on a fresh evaluate(), not on a supplied stored receipt", async () => {
    const abstainEval = (r: GuardRequest) =>
      receiptFor({ decision: "abstain", expires_at: null, payload_hash: computePayloadHash(r) });
    const fresh = spySigner();
    const g1 = guardEvmSigner(fresh.signer, { evaluate: abstainEval, allowAbstainOverride: true, contextIntent: intent });
    await g1.sendTransaction(baseTx);
    assert.equal(fresh.seen.length, 1);

    const stored = spySigner();
    const g2 = guardEvmSigner(stored.signer, { allowAbstainOverride: true, contextIntent: intent });
    const probe = guardEvmSigner(spySigner().signer, { evaluate: (r) => { captured = r; return abstainEval(r); }, allowAbstainOverride: true, contextIntent: intent });
    let captured: GuardRequest | undefined;
    await probe.sendTransaction(baseTx);
    await assert.rejects(g2.sendTransaction(baseTx, { receipt: abstainEval(captured!) }), /fresh verdict/);
    assert.equal(stored.seen.length, 0);
  });
});
