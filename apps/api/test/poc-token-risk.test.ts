/**
 * I5 crosscheck of apps/api/src/services/token-risk.ts, offline (fake RHC client).
 *
 * [TR-1] Testnet pons classification trusted the curve's own getters: any token whose `curve()` returns a
 *        contract with `token()` = the token (or `factory()` = a known factory) became pons_curve /
 *        pons_graduated_v4 with mintable:false, skipping T-MINT. Now the known factory's registry must confirm.
 * [TR-2] Proxies: mint selectors were only searched in the proxy forwarder, and a live upgrade authority
 *        (EIP-1967 admin, beacon owner, UUPS owner/roles) was ignored.
 * [TR-3] mint() with no owner()/getOwner()/admin() getter (AccessControl or permissionless) counted as dead.
 * [TR-6] generic `other` tokens: T-LP (liquidity never observed) was a flag on an allow → abstain unless
 *        ZGUARD_ALLOW_UNDETECTED_LP=true; pausable heuristic (paused → deny, live pause authority → abstain T-PAUSE);
 *        mainnet pons V1 launches are confirmed by factory.getLaunchedToken instead of an out-of-range getLogs.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Hex, PublicClient } from "viem";
import { PONS_TESTNET_CONTRACTS } from "@zguard/sdk";
import { loadConfig } from "../src/config.js";
import { evaluateTokenRiskRhc } from "../src/services/token-risk.js";
import type { RhcRegistryService } from "../src/services/registry.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const TOKEN = "0x1111111111111111111111111111111111111111";
const CURVE = "0x2222222222222222222222222222222222222222";
const IMPL = "0x3333333333333333333333333333333333333333";
const BEACON = "0x4444444444444444444444444444444444444444";
const OWNER = "0x5555555555555555555555555555555555555555";
const FACTORY = PONS_TESTNET_CONTRACTS.factoryV1.toLowerCase();
const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const word = (a: string) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
// Plain bytecode with a PUSH4 per selector so the scanner sees them.
const codeWith = (...sels: string[]) => `0x6080${sels.map((s) => `63${s}`).join("")}00` as Hex;

type Account = {
  code?: Hex;
  storage?: Record<string, Hex>;
  reads?: Record<string, unknown>;
  calls?: Record<string, Hex>;
};

function fakeClient(state: Record<string, Account>): PublicClient {
  const acct = (a: string) => state[a.toLowerCase()] ?? {};
  return {
    getCode: async ({ address }: { address: string }) => acct(address).code ?? "0x",
    getStorageAt: async ({ address, slot }: { address: string; slot: string }) => acct(address).storage?.[slot] ?? word(ZERO),
    readContract: async ({ address, functionName }: { address: string; functionName: string }) => {
      const reads = acct(address).reads ?? {};
      if (!(functionName in reads)) throw new Error(`no ${functionName}`);
      return reads[functionName];
    },
    call: async ({ to, data }: { to: string; data: string }) => {
      const r = acct(to).calls?.[data.toLowerCase()];
      if (!r) throw new Error("revert");
      return { data: r };
    },
    getBalance: async () => 0n,
    getBlock: async () => ({ number: 1n, timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
    getBlockNumber: async () => 1n,
    getLogs: async () => [],
  } as unknown as PublicClient;
}

const registry = {
  ensureFresh: async () => {},
  getCanonicalTickerMap: () => ({}),
  getStockTokenByAddress: () => undefined,
  readOracleData: async () => null,
} as unknown as RhcRegistryService;

const config = loadConfig({ ...process.env, DATABASE_URL: "", ZGUARD_ENABLE_URL_FETCH: "false" });
const evaluate = (state: Record<string, Account>, chainId = 46630, cfg = config) =>
  evaluateTokenRiskRhc({ config: cfg, client: fakeClient(state), registry, chainId, tokenAddress: TOKEN });
const lpOptIn = loadConfig({ ...process.env, DATABASE_URL: "", ZGUARD_ENABLE_URL_FETCH: "false", ZGUARD_ALLOW_UNDETECTED_LP: "true" });

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});

const meta = { name: "Fake", symbol: "FAKE", decimals: 18 };
const isTokenCall = `0x4d0b43f0${word(TOKEN).slice(2)}`;
const isCurveCall = `0x30343c74${word(CURVE).slice(2)}`;
const TRUE = word("0x1");

describe("[TR-1] testnet pons curve must be confirmed by the factory registry", () => {
  const mintableToken: Account = { code: codeWith("40c10f19"), reads: { ...meta, owner: OWNER, curve: CURVE } };
  const fakeCurve: Account = { code: codeWith("aaaaaaaa"), reads: { factory: FACTORY, graduated: true, token: TOKEN } };

  it("a self-made curve claiming a known factory is NOT pons (falls to generic → T-MINT deny)", async () => {
    const r = await evaluate({ [TOKEN]: mintableToken, [CURVE]: fakeCurve, [FACTORY]: { code: codeWith("4d0b43f0") } });
    assert.equal(r.kind, "other");
    assert.equal(r.decision, "deny");
    assert.ok(r.codes.includes("T-MINT"));
  });

  it("a curve whose token() is the token but with an unknown factory is NOT pons", async () => {
    const r = await evaluate({ [TOKEN]: mintableToken, [CURVE]: { ...fakeCurve, reads: { ...fakeCurve.reads, factory: OWNER } } });
    assert.equal(r.kind, "other");
    assert.ok(r.codes.includes("T-MINT"));
  });

  it("a curve confirmed by the factory registry stays pons", async () => {
    const r = await evaluate({
      [TOKEN]: { code: codeWith("aaaaaaaa"), reads: { ...meta, curve: CURVE } },
      [CURVE]: fakeCurve,
      [FACTORY]: { code: codeWith("4d0b43f0", "30343c74"), calls: { [isTokenCall]: TRUE, [isCurveCall]: TRUE } },
    });
    assert.equal(r.kind, "pons_graduated_v4");
    assert.equal(r.decision, "allow");
  });
});

describe("[TR-2] proxies", () => {
  const implMintable: Account = { code: codeWith("40c10f19") };

  it("EIP-1967 proxy with a live admin is mint-capable even if the forwarder has no mint selector", async () => {
    const r = await evaluate({
      [TOKEN]: { code: codeWith("aaaaaaaa"), storage: { [IMPL_SLOT]: word(IMPL), [ADMIN_SLOT]: word(OWNER) }, reads: meta },
      [IMPL]: { code: codeWith("bbbbbbbb") },
    }, 4663);
    assert.equal(r.decision, "deny");
    assert.ok(r.codes.includes("T-MINT"));
    assert.equal((r.liquidity.detail as Record<string, unknown>).proxy, "eip1967");
    assert.equal(r.authorities.owner, OWNER.toLowerCase());
  });

  it("mint selector living only in the implementation is found", async () => {
    const r = await evaluate({
      [TOKEN]: { code: codeWith("aaaaaaaa"), storage: { [IMPL_SLOT]: word(IMPL) }, reads: { ...meta, owner: OWNER } },
      [IMPL]: implMintable,
    }, 4663);
    assert.ok(r.codes.includes("T-MINT"));
  });

  it("beacon proxy with a live beacon owner is mint-capable", async () => {
    const r = await evaluate({
      [TOKEN]: { code: codeWith("aaaaaaaa"), storage: { [BEACON_SLOT]: word(BEACON) }, reads: meta },
      [BEACON]: { code: codeWith("5c60da1b"), reads: { implementation: IMPL, owner: OWNER } },
      [IMPL]: { code: codeWith("bbbbbbbb") },
    }, 4663);
    assert.ok(r.codes.includes("T-MINT"));
    assert.equal((r.liquidity.detail as Record<string, unknown>).proxy, "beacon");
  });

  it("UUPS implementation with an owner is upgradeable", async () => {
    const r = await evaluate({
      [TOKEN]: { code: codeWith("aaaaaaaa"), storage: { [IMPL_SLOT]: word(IMPL) }, reads: { ...meta, owner: OWNER } },
      [IMPL]: { code: codeWith("4f1ef286") },
    }, 4663);
    assert.ok(r.codes.includes("T-MINT"));
  });

  it("EIP-1167 clone of a fixed-supply implementation is not flagged", async () => {
    const clone = `0x363d3d373d3d3d363d73${IMPL.slice(2)}5af43d82803e903d91602b57fd5bf3` as Hex;
    const r = await evaluate({ [TOKEN]: { code: clone, reads: meta }, [IMPL]: { code: codeWith("a9059cbb") } }, 4663, lpOptIn);
    assert.equal(r.decision, "allow");
    assert.ok(!r.codes.includes("T-MINT"));
    assert.equal((r.liquidity.detail as Record<string, unknown>).proxy, "eip1167");
  });
});

describe("[TR-3] mint authority without an owner getter", () => {
  it("AccessControl token with mint() is mint-capable", async () => {
    const r = await evaluate({ [TOKEN]: { code: codeWith("40c10f19", "91d14854"), reads: meta } }, 4663);
    assert.ok(r.codes.includes("T-MINT"));
  });
  it("mint() with no ownership model at all is mint-capable", async () => {
    const r = await evaluate({ [TOKEN]: { code: codeWith("40c10f19"), reads: meta } }, 4663);
    assert.ok(r.codes.includes("T-MINT"));
  });
  it("mint() behind a provably renounced owner (owner() = 0x0) is not flagged", async () => {
    const r = await evaluate({ [TOKEN]: { code: codeWith("40c10f19"), reads: { ...meta, owner: ZERO } } }, 4663, lpOptIn);
    assert.ok(!r.codes.includes("T-MINT"));
    assert.equal(r.decision, "allow");
  });
  it("plain fixed-supply token: abstain T-LP by default, allow (flagged) only with the operator opt-in", async () => {
    const plain = { [TOKEN]: { code: codeWith("a9059cbb"), reads: meta } };
    const r = await evaluate(plain, 4663);
    assert.equal(r.decision, "abstain");
    assert.deepEqual(r.codes, ["T-LP"]);
    const opt = await evaluate(plain, 4663, lpOptIn);
    assert.equal(opt.decision, "allow");
    assert.deepEqual(opt.codes, ["T-LP"]);
  });
});


describe("[TR-6] pausable heuristic and pons V1 registry", () => {
  it("currently paused token is deny T-PAUSE (even with the LP opt-in)", async () => {
    const r = await evaluate({ [TOKEN]: { code: codeWith("a9059cbb", "5c975abb"), reads: { ...meta, paused: true, owner: ZERO } } }, 4663, lpOptIn);
    assert.equal(r.decision, "deny");
    assert.ok(r.codes.includes("T-PAUSE"));
    assert.equal(r.authorities.pausable, true);
  });
  it("pause()/unpause() with a live owner is abstain T-PAUSE; renounced owner is not flagged", async () => {
    const live = await evaluate({ [TOKEN]: { code: codeWith("a9059cbb", "8456cb59", "3f4ba83a"), reads: { ...meta, owner: OWNER } } }, 4663, lpOptIn);
    assert.equal(live.decision, "abstain");
    assert.ok(live.codes.includes("T-PAUSE"));
    const dead = await evaluate({ [TOKEN]: { code: codeWith("a9059cbb", "8456cb59"), reads: { ...meta, owner: ZERO } } }, 4663, lpOptIn);
    assert.ok(!dead.codes.includes("T-PAUSE"));
    assert.equal(dead.decision, "allow");
  });
  it("mainnet token registered in the pons V1 factory is pons_curve (getLaunchedToken.exists)", async () => {
    const V1 = "0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb";
    const launched = {
      token: TOKEN, deployer: OWNER, pairedToken: OWNER, positionManager: OWNER, positionId: 7n, dexId: 0n, launchConfigId: 1n,
      restrictionsEndBlock: 0n, supply: 10n ** 27n, isToken0: true, poolFee: 10000, exists: true, initialBuyAmount: 0n,
    };
    const r = await evaluate(
      { [TOKEN]: { code: codeWith("a9059cbb"), reads: meta }, [V1]: { code: codeWith("aaaaaaaa"), reads: { getLaunchedToken: launched, graduationStatus: [1n, 2n, false] } } },
      4663
    );
    assert.equal(r.kind, "pons_curve");
    assert.equal(r.decision, "allow");
    assert.equal(r.pons?.stack, "v1");
    assert.equal(r.pons?.graduated, false);
  });
});
