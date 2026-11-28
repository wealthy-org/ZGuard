/**
 * `zguard-terminal showcase-testnet` (demo/recording command): read-only, and every row is a real check.
 * Offline: the chain and the API are faked; a drifted deployment must turn rows red, never green.
 *   tsx --test test/showcase.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import { guardOffline, type GuardRequest } from "@zguard/sdk";
import { demoPayment, runTestnetShowcase, TESTNET_DEPLOYMENT as D, type ShowcaseReader } from "@zguard/terminal";

const ZERO = "0x0000000000000000000000000000000000000000";
const ROLE = (s: string) => keccak256(toHex(s));

function fakeChain(over: { routerOwner?: Address; delay?: bigint; failTx?: Hex } = {}) {
  const calls: string[] = [];
  const roles = new Set(
    [
      [ROLE("PROPOSER_ROLE"), D.opsSafe],
      [ROLE("CANCELLER_ROLE"), D.opsSafe],
      [ROLE("CANCELLER_ROLE"), D.guardian],
      [ROLE("EXECUTOR_ROLE"), ZERO],
      [("0x" + "00".repeat(32)) as Hex, D.timelock],
    ].map(([r, a]) => `${r}:${a!.toLowerCase()}`)
  );
  const reader: ShowcaseReader = {
    getChainId: async () => 46630,
    getBlockNumber: async () => 158_000_000n,
    getBlock: async () => ({ timestamp: 1_795_000_000n }),
    getBytecode: async () => "0x6080604052" as Hex,
    readContract: async ({ address, functionName, args }) => {
      calls.push(functionName);
      const a = getAddress(address);
      switch (functionName) {
        case "owner":
          return a === D.permRouter && over.routerOwner ? over.routerOwner : D.timelock;
        case "pendingOwner":
          return ZERO;
        case "paused":
          return false;
        case "getMinDelay":
          return over.delay ?? 600n;
        case "hasRole":
          return roles.has(`${args![0]}:${String(args![1]).toLowerCase()}`);
        case "getThreshold":
          return 2n;
        case "getOwners":
          return [D.guardian, D.deployer, D.payer];
        case "nonce":
          return 1n;
        case "VERSION":
          return "1.5.0";
      }
      throw new Error(`unexpected ${functionName}`);
    },
    getTransactionReceipt: async ({ hash }) => {
      const t = D.txs.find((x) => x.hash === hash)!;
      return {
        status: hash === over.failTx ? "reverted" : "success",
        blockNumber: 1n,
        from: D.deployer,
        to: null,
        contractAddress: "creates" in t ? (D[t.creates] as Address) : null,
        logs: [{}],
      };
    },
  };
  return { reader, calls };
}

function fakeApi(over: { payTo?: string; down?: boolean } = {}) {
  const posts: Array<{ url: string; auth: string | null }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (over.down) return new Response("down", { status: 503 });
    if (url.endsWith("/health")) {
      return Response.json({ status: "ok", chainId: 46630, network: "eip155:46630", storageDriver: "neon-postgres", sequencer: { up: true, latestBlockAgeSeconds: 1 } });
    }
    if (url.endsWith("/v1/config")) {
      return Response.json({
        paymentRails: { payTo: over.payTo ?? D.opsSafe, usdgAddress: D.usdg, effectiveSettlementMode: "deposit" },
        pricesMicroUsdg: { verify: "3000", guard: "15000", tokenRisk: "10000" },
        policy: { checkModes: { quote: "required" } },
      });
    }
    if (url.endsWith("/v1/verify")) {
      posts.push({ url, auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ ...guardOffline(JSON.parse(String(init!.body)) as GuardRequest), decisionId: "dec_test" });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, posts };
}

describe("showcase-testnet", () => {
  it("all rows green when chain and API match the deploy evidence; read-only, no /v1/verify without --live", async () => {
    const { reader, calls } = fakeChain();
    const api = fakeApi();
    const r = await runTestnetShowcase({ reader, fetchImpl: api.fetchImpl });
    assert.equal(r.failed, 0, JSON.stringify(r.sections.flatMap((s) => s.rows.filter((x) => !x.ok))));
    assert.equal(r.passed, 34);
    assert.equal(api.posts.length, 0);
    assert.ok(calls.every((c) => !/^(transfer|approve|schedule|execute)/.test(c)));
    const links = r.sections.flatMap((s) => s.rows.map((x) => x.link).filter(Boolean));
    assert.ok(links.every((l) => l!.startsWith("https://explorer.testnet.chain.robinhood.com")));
  });

  it("demo payments are a real allow and a real deny Q-001 in the guard engine", () => {
    assert.equal(guardOffline(demoPayment("allow")).decision, "allow");
    const deny = guardOffline(demoPayment("deny-q001"));
    assert.equal(deny.decision, "deny");
    assert.deepEqual(deny.codes, ["Q-001"]);
  });

  it("drift turns rows red: wrong owner, changed delay, reverted tx, foreign payTo", async () => {
    const { reader } = fakeChain({ routerOwner: D.deployer, delay: 60n, failTx: D.txs[5].hash });
    const r = await runTestnetShowcase({ reader, fetchImpl: fakeApi({ payTo: D.deployer }).fetchImpl });
    const red = r.sections.flatMap((s) => s.rows.filter((x) => !x.ok).map((x) => x.label));
    assert.deepEqual(red.sort(), ["PermRouter owner", "executeBatch after 600 s", "min delay", "payTo (x402)"].sort());
  });

  it("API down is shown as failures, not hidden", async () => {
    const r = await runTestnetShowcase({ reader: fakeChain().reader, fetchImpl: fakeApi({ down: true }).fetchImpl });
    const api = r.sections.find((s) => s.title.startsWith("ZGuard API"))!;
    assert.ok(api.rows.every((x) => !x.ok && x.value.includes("HTTP 503")));
  });

  it("--live sends the key only to the API and expects allow + deny Q-001", async () => {
    const api = fakeApi();
    const r = await runTestnetShowcase({ reader: fakeChain().reader, fetchImpl: api.fetchImpl, apiKey: "zg_test_key" });
    assert.equal(r.failed, 0);
    assert.equal(api.posts.length, 2);
    assert.ok(api.posts.every((p) => p.auth === "Bearer zg_test_key"));
    const live = r.sections.flatMap((s) => s.rows).filter((x) => x.label.startsWith("live /v1/verify"));
    assert.deepEqual(live.map((x) => x.value.split(" · ")[0]), ["ALLOW", "DENY"]);
    assert.ok(live.every((x) => !x.value.includes("zg_test_key")));
  });
});
