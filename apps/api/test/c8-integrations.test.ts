/**
 * Gap C8: Perm DEX router / RHC-pons terminal are helper integrations (the real apps live in external
 * repos). What this repo CAN guarantee: turning the guard off never results in a silent signature, and
 * a non-allow verdict never reaches the wallet. Offline.
 *   tsx --test test/c8-integrations.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GuardDisabledError,
  GuardBlockedError,
  computePayloadHash,
  createPermRouterGuard,
  createTerminalSwapGuard,
  guardEvmSigner,
  guardPermRoute,
  ZGuardClient,
  type GuardRequest,
  type GuardResponse,
} from "@zguard/sdk";

const USDG = "0x7E955252E15c84f5768B83c41a71F9eba181802F";
const HOLDER = "0x54b83d1e6Ee818FFB96D260Fc3E4dfc3Aaf03f79";
const DATA =
  "0xa9059cbb000000000000000000000000000000000000000000000000000000000000aaaa0000000000000000000000000000000000000000000000000000000000000001";
const intent = {
  chainId: 46630,
  to: USDG,
  function: "transfer(address,uint256)",
  args: ["0x000000000000000000000000000000000000aaaa", "1"],
  value: "0",
  from: HOLDER,
};
const tx = { chainId: 46630, from: HOLDER, to: USDG, value: "0", data: DATA };

function spySigner() {
  const calls: string[] = [];
  return {
    calls,
    signer: {
      async signTransaction() {
        calls.push("signTransaction");
        return "0xsigned" as `0x${string}`;
      },
      async sendTransaction() {
        calls.push("sendTransaction");
        return "0xhash" as `0x${string}`;
      },
      async signTypedData() {
        calls.push("signTypedData");
        return "0xsig" as `0x${string}`;
      },
    },
  };
}

function verdict(decision: GuardResponse["decision"]) {
  // Receipt bound to whatever request the integration evaluates.
  return async (req: GuardRequest): Promise<GuardResponse> =>
    ({
      decision,
      reason: decision,
      codes: decision === "allow" ? [] : ["Q-001"],
      payload_hash: computePayloadHash(req),
      checks: {},
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    }) as unknown as GuardResponse;
}

describe("[C8] guard disabled => signer refuses (Perm / Terminal helpers)", () => {
  it("guardEvmSigner({enabled:false}) throws GuardDisabledError and never touches the wallet", async () => {
    const { signer, calls } = spySigner();
    const g = guardEvmSigner(signer, { enabled: false, evaluate: verdict("allow") });
    await assert.rejects(() => g.sendTransaction!(tx as never, { intent }), GuardDisabledError);
    await assert.rejects(() => g.signTransaction!(tx as never, { intent }), GuardDisabledError);
    assert.deepEqual(calls, []);
  });

  it("createPermRouterGuard({enabled:false}) refuses before evaluating or signing", async () => {
    const { signer, calls } = spySigner();
    let evaluated = 0;
    const perm = createPermRouterGuard({
      enabled: false,
      evaluate: async (r) => {
        evaluated++;
        return verdict("allow")(r);
      },
    });
    await assert.rejects(
      () => perm.guardAndSignRoute({ intent, tx: tx as never, tokenAddress: USDG, signer }),
      GuardDisabledError
    );
    assert.equal(evaluated, 0);
    assert.deepEqual(calls, []);
  });

  it("createTerminalSwapGuard({enabled:false}) refuses", async () => {
    const { signer, calls } = spySigner();
    const term = createTerminalSwapGuard({ enabled: false, evaluate: verdict("allow") });
    await assert.rejects(
      () => term.guardAndExecuteSwap({ intent, tx: tx as never, tokenAddress: USDG, signer }),
      GuardDisabledError
    );
    assert.deepEqual(calls, []);
  });

  it("guardPermRoute({enabled:false}) and missing tx (QM-2) both refuse", async () => {
    const client = new ZGuardClient({ baseUrl: "http://127.0.0.1:9", apiKey: "zg_x" });
    await assert.rejects(() => guardPermRoute({ client, intent, tx, enabled: false }), /Guard disabled/);
    await assert.rejects(() => guardPermRoute({ client, intent }), /exact transaction/);
  });

  it("deny / abstain verdicts never reach the wallet; allow signs exactly once", async () => {
    for (const d of ["deny", "abstain"] as const) {
      const { signer, calls } = spySigner();
      const perm = createPermRouterGuard({ evaluate: verdict(d) });
      await assert.rejects(
        () => perm.guardAndSignRoute({ intent, tx: tx as never, tokenAddress: USDG, signer }),
        GuardBlockedError
      );
      assert.deepEqual(calls, [], d);
    }
    const { signer, calls } = spySigner();
    const perm = createPermRouterGuard({ evaluate: verdict("allow") });
    const out = await perm.guardAndSignRoute({ intent, tx: tx as never, tokenAddress: USDG, signer });
    assert.equal(out.txHashOrSig, "0xhash");
    assert.deepEqual(calls, ["sendTransaction"]);
  });
});
