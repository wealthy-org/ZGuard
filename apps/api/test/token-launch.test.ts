/**
 * §9.9 / §10: $ZGUARD launch on pons and buyback-and-burn from the ZGuard Ops Safe (`@zguard/terminal` token.ts).
 * Nothing is sent: the planners dry-run against the chain and emit a Safe Transaction Builder batch. The
 * buyback batch exists only behind a ZGuard `allow` bound to its exact bytes. Offline (fake chain).
 *   tsx --test test/token-launch.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  computePayloadHash,
  GuardBlockedError,
  GuardDisabledError,
  PONS_TESTNET_CONTRACTS,
  PONS_V2_CONTRACTS,
  type GuardRequest,
  type GuardResponse,
} from "@zguard/sdk";
import {
  BURN_ADDRESS,
  buildLaunchMetadata,
  buildV2BuybackBurn,
  canonicalJson,
  cidV1Raw,
  defaultTokenConfig,
  launchSalt,
  metadataDigest,
  planBuyback,
  planLaunch,
  PONS_V2_CURVE_ABI,
  PONS_V2_FACTORY_ABI,
  TESTNET_LAUNCH_FACTORY_ABI,
  TokenGuardUnavailableError,
  tokenStatus,
  validateTokenConfig,
  ZGUARD_OPS_SAFE,
  type TokenChainReader,
} from "@zguard/terminal";

const FACTORY = getAddress(PONS_V2_CONTRACTS.factory);
const TESTNET_FACTORY = getAddress(PONS_TESTNET_CONTRACTS.factoryV1);
const TOKEN = getAddress("0x7d8b3f1022Ba848a2D7E413191Bf851F73DD017D");
const CURVE = getAddress("0x558027c36D795AA1869DbF82D666E9B9b5f1Fc28");
const ECON = "0xa9fc75d4203a33fe660e8fa32c74c3aa41c1fda4bf23d3a39b6bc22a1f8b1ca7" as Hex;
const FEE = 500_000_000_000_000n;
const NOW = Date.parse("2026-11-27T00:00:00Z");

/** KOIP (testnet launch 0x9269…1f02): metadata bytes, keccak digest onchain, and the ipfs CID it was launched with. */
const KOIP_JSON =
  '{"chainId":46630,"creator":"0x2fd0830144f7d744e867ca9a62d5531a4ed5a2a8","description":"A calm pond full of golden koi. Toss a coin, make a wish, enjoy the ripples.","image":{"bytes":14808,"height":512,"mimeType":"image/webp","uri":"ipfs://bafkreidsva3nbzrtsd6p52xcvywfttkwd52xl5epa5oerp2pmg6swdeao4","width":512},"name":"Koi Pond","schemaVersion":1,"socials":{},"symbol":"KOIP"}';
const KOIP_DIGEST = "0x300e4621b1773608da00b0881f3aeb2b0d42f04e496a0b2aa9266f25c018ac81";
const KOIP_CID = "bafkreidoe57z2hthcue6lvjh76coxycoszn5heuoo2ihjiwglkg5xm53su";

interface ChainState {
  launchEnabled: boolean;
  canLaunch: boolean;
  maxTax: bigint;
  configEnabled: boolean;
  safeBalance: bigint;
  launchReverts: boolean;
  exists: boolean;
  pairToken: Address;
  curveToken: Address;
  curveFactory: Address;
  graduated: boolean;
  native: boolean;
  snipeBps: bigint;
  deployer: Address;
  tokensOut: bigint;
}

function fakeChain(over: Partial<ChainState> = {}) {
  const s: ChainState = {
    launchEnabled: true,
    canLaunch: true,
    maxTax: 1000n,
    configEnabled: true,
    safeBalance: 0n,
    launchReverts: false,
    exists: true,
    pairToken: zeroAddress,
    curveToken: TOKEN,
    curveFactory: FACTORY,
    graduated: false,
    native: true,
    snipeBps: 0n,
    deployer: ZGUARD_OPS_SAFE,
    tokensOut: 1_000_000n * 10n ** 18n,
    ...over,
  };
  const calls: Array<{ to: Address; data: Hex; value?: bigint; override: boolean }> = [];
  const reader: TokenChainReader = {
    async readContract({ address, functionName }) {
      const a = getAddress(address);
      if (a === FACTORY) {
        switch (functionName) {
          case "launchEnabled": return s.launchEnabled;
          case "canLaunch": return s.canLaunch;
          case "launchFee": return FEE;
          case "maxCreatorTaxBps": return s.maxTax;
          case "getLaunchConfig":
            return { supply: 10n ** 27n, curveFeeBps: 100n, phantomQuote: 168n * 10n ** 16n, graduationThreshold: 42n * 10n ** 17n, poolFee: 0, tickSpacing: 200, enabled: s.configEnabled };
          case "previewLaunchEconomics": return ECON;
          case "getLaunchedToken":
            return { token: TOKEN, curve: CURVE, deployer: s.deployer, creatorFeeRecipient: s.deployer, pairToken: s.pairToken, graduationThreshold: 0n, poolFee: 0, tickSpacing: 200, creatorTaxBps: 0, buybackEnabled: false, phase: 0, sweptQuote: 0n, sweptTokens: 0n, sweptAt: 0n, exists: s.exists };
        }
      }
      if (a === TESTNET_FACTORY) {
        if (functionName === "LAUNCH_FEE") return FEE;
        if (functionName === "METADATA_SCHEMA_VERSION") return 1;
        if (functionName === "MAX_METADATA_URI_LENGTH") return 200n;
      }
      if (a === CURVE) {
        switch (functionName) {
          case "token": return s.curveToken;
          case "factory": return s.curveFactory;
          case "graduated": return s.graduated;
          case "isNativeQuote": return s.native;
          case "currentSnipeTaxBps": return s.snipeBps;
        }
      }
      if (a === TOKEN && functionName === "totalSupply") return 10n ** 27n;
      if (a === TOKEN && functionName === "balanceOf") return 5n * 10n ** 18n;
      throw new Error(`unexpected read ${a}.${functionName}`);
    },
    async call({ account, to, data, value, stateOverride }) {
      assert.equal(getAddress(account), ZGUARD_OPS_SAFE, "dry-runs run from the Safe");
      calls.push({ to: getAddress(to), data, value, override: Boolean(stateOverride?.length) });
      if (getAddress(to) === FACTORY) {
        if (s.launchReverts) throw Object.assign(new Error("execution reverted"), { shortMessage: "execution reverted" });
        return { data: encodeFunctionResult({ abi: PONS_V2_FACTORY_ABI, functionName: "launchToken", result: [TOKEN, CURVE] }) };
      }
      if (getAddress(to) === TESTNET_FACTORY) {
        return { data: `0x${TOKEN.slice(2).toLowerCase().padStart(64, "0")}${CURVE.slice(2).toLowerCase().padStart(64, "0")}` as Hex };
      }
      if (getAddress(to) === CURVE) {
        return { data: encodeFunctionResult({ abi: PONS_V2_CURVE_ABI, functionName: "buy", result: s.tokensOut }) };
      }
      throw new Error(`unexpected call to ${to}`);
    },
    async getBalance() {
      return s.safeBalance;
    },
  };
  return { reader, s, calls };
}

function allowFor(req: GuardRequest, over: Partial<GuardResponse> = {}): GuardResponse {
  return {
    decisionId: "dec_test",
    decision: "allow",
    reason: "ok",
    codes: [],
    payload_hash: computePayloadHash(req),
    expires_at: new Date(NOW + 60_000).toISOString(),
    network: req.network,
    checks: {},
    flags: [],
    charged: null,
    ...over,
  };
}

function spyGuard(make: (req: GuardRequest) => GuardResponse | Promise<GuardResponse> = (r) => allowFor(r)) {
  const seen: GuardRequest[] = [];
  return {
    seen,
    evaluate: async (req: GuardRequest) => {
      seen.push(req);
      return make(req);
    },
  };
}

const buyback = (reader: TokenChainReader, extra: Partial<Parameters<typeof planBuyback>[0]> = {}) =>
  planBuyback({ chainId: 4663, reader, token: TOKEN, quoteIn: 10n ** 16n, nowMs: NOW, createdAt: 1, ...extra });

describe("launch: pons V2 on 4663", () => {
  it("3-argument launchToken matches the verified selector 0xf35abbcf", () => {
    const fn = PONS_V2_FACTORY_ABI.find((x) => x.type === "function" && x.name === "launchToken");
    assert.ok(fn);
    assert.equal(toFunctionSelector(fn as never), "0xf35abbcf");
    const buy = PONS_V2_CURVE_ABI.find((x) => x.type === "function" && x.name === "buy");
    assert.equal(toFunctionSelector(buy as never), "0x59a87bc1");
  });

  it("builds a Safe batch whose bytes decode back to the Safe-owned ZGuard launch", async () => {
    const { reader, calls } = fakeChain();
    const plan = await planLaunch({ chainId: 4663, reader, createdAt: 1 });
    assert.equal(plan.call.to, FACTORY);
    assert.equal(plan.call.value, FEE);
    const { functionName, args } = decodeFunctionData({ abi: PONS_V2_FACTORY_ABI, data: plan.call.data });
    assert.equal(functionName, "launchToken");
    const [params, configId, pair] = args as unknown as [Record<string, unknown>, bigint, Address];
    assert.equal(params.name, "ZGuard");
    assert.equal(params.symbol, "ZGUARD");
    assert.equal(getAddress(params.creatorFeeRecipient as string), ZGUARD_OPS_SAFE);
    assert.equal(params.creatorTaxBps, 0);
    assert.equal(params.buybackEnabled, false, "pons-native buyback vault is not used (brief §10)");
    assert.equal(params.expectedEconomics, ECON);
    assert.equal(params.salt, launchSalt(4663, ZGUARD_OPS_SAFE));
    assert.equal(configId, 0n);
    assert.equal(pair, zeroAddress);
    assert.equal(plan.dryRunToken, TOKEN);
    assert.equal(plan.fundingNeeded, FEE, "empty Safe: the plan says how much ETH to send");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.override, true);
    assert.deepEqual(plan.safeFile.transactions, [
      { to: FACTORY, value: FEE.toString(), data: plan.call.data, contractMethod: null, contractInputsValues: null },
    ]);
    assert.equal(plan.safeFile.chainId, "4663");
    assert.equal(plan.safeFile.meta.createdFromSafeAddress, ZGUARD_OPS_SAFE);
  });

  it("refuses when the factory says no, the config is off, the tax is too high or the dry-run reverts", async () => {
    await assert.rejects(planLaunch({ chainId: 4663, reader: fakeChain({ launchEnabled: false }).reader }), /disabled/);
    await assert.rejects(planLaunch({ chainId: 4663, reader: fakeChain({ canLaunch: false }).reader }), /canLaunch/);
    await assert.rejects(planLaunch({ chainId: 4663, reader: fakeChain({ configEnabled: false }).reader }), /config 0 is disabled/);
    await assert.rejects(
      planLaunch({ chainId: 4663, reader: fakeChain({ maxTax: 100n }).reader, cfg: defaultTokenConfig({ creatorTaxBps: 500 }) }),
      /above the factory maximum/
    );
    await assert.rejects(planLaunch({ chainId: 4663, reader: fakeChain({ launchReverts: true }).reader }), /Dry-run reverted.*No batch file/);
    await assert.rejects(planLaunch({ chainId: 1, reader: fakeChain().reader }), /not supported/);
  });

  it("no balance top-up in the dry-run when the Safe is funded", async () => {
    const { reader, calls } = fakeChain({ safeBalance: 10n ** 18n });
    const plan = await planLaunch({ chainId: 4663, reader });
    assert.equal(plan.fundingNeeded, 0n);
    assert.equal(calls[0]!.override, false);
  });

  it("salt is deterministic per chain, launcher and retry nonce", () => {
    assert.equal(launchSalt(4663, ZGUARD_OPS_SAFE), launchSalt(4663, ZGUARD_OPS_SAFE.toLowerCase()));
    assert.notEqual(launchSalt(4663, ZGUARD_OPS_SAFE), launchSalt(46630, ZGUARD_OPS_SAFE));
    assert.notEqual(launchSalt(4663, ZGUARD_OPS_SAFE), launchSalt(4663, ZGUARD_OPS_SAFE, 1));
  });

  it("token config validation", () => {
    validateTokenConfig(defaultTokenConfig());
    assert.throws(() => validateTokenConfig(defaultTokenConfig({ symbol: "$ZGUARD" })), /symbol/);
    assert.throws(() => validateTokenConfig(defaultTokenConfig({ logo: "http://x/logo.jpg" })), /logo/);
    assert.throws(() => validateTokenConfig(defaultTokenConfig({ creatorTaxBps: -1 })), /creatorTaxBps/);
    assert.throws(
      () => validateTokenConfig(defaultTokenConfig({ socials: { twitter: "javascript:alert(1)", telegram: "", discord: "", website: "", farcaster: "" } })),
      /socials.twitter/
    );
  });
});

describe("launch: testnet 46630 rehearsal", () => {
  it("metadata format reproduces a real testnet launch byte for byte (KOIP digest + CID)", () => {
    assert.equal(metadataDigest(KOIP_JSON), KOIP_DIGEST);
    assert.equal(cidV1Raw(KOIP_JSON), KOIP_CID);
    const built = buildLaunchMetadata({
      chainId: 46630,
      creator: "0x2FD0830144f7D744E867Ca9A62d5531A4ED5A2A8",
      cfg: defaultTokenConfig({
        name: "Koi Pond",
        symbol: "KOIP",
        description: "A calm pond full of golden koi. Toss a coin, make a wish, enjoy the ripples.",
        socials: { twitter: "", telegram: "", discord: "", website: "", farcaster: "" },
      }),
      image: { bytes: 14808, height: 512, width: 512, mimeType: "image/webp", uri: "ipfs://bafkreidsva3nbzrtsd6p52xcvywfttkwd52xl5epa5oerp2pmg6swdeao4" },
    });
    assert.equal(built.json, KOIP_JSON);
    assert.equal(built.digest, KOIP_DIGEST);
    assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } }), '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}');
  });

  it("createToken from the Safe with an ipfs:// URI of the built metadata, no initial buy", async () => {
    const { reader } = fakeChain();
    const plan = await planLaunch({ chainId: 46630, reader, createdAt: 1 });
    assert.equal(plan.call.to, TESTNET_FACTORY);
    assert.equal(plan.call.value, FEE);
    assert.equal(plan.call.data.slice(0, 10), "0xbaf2b1ea");
    const { args } = decodeFunctionData({ abi: TESTNET_LAUNCH_FACTORY_ABI, data: plan.call.data });
    const [name, symbol, uri, digest, recipient, minOut] = args as unknown as [string, string, string, Hex, Address, bigint];
    assert.equal(name, "ZGuard");
    assert.equal(symbol, "ZGUARD");
    assert.equal(uri, `ipfs://${cidV1Raw(plan.details.metadataJson!)}`);
    assert.equal(digest, metadataDigest(plan.details.metadataJson!));
    assert.equal(getAddress(recipient), ZGUARD_OPS_SAFE);
    assert.equal(minOut, 0n);
    assert.equal(plan.dryRunToken, TOKEN);
    assert.equal(plan.dryRunCurve, CURVE);
    assert.match(plan.details.metadataJson!, /"creator":"0xad5501954a52792280d868f7e613efcc4f80fa6c"/);
  });

  it("refuses a non-ipfs metadata URI (the testnet launchpad reverts on https://)", async () => {
    await assert.rejects(
      planLaunch({ chainId: 46630, reader: fakeChain().reader, metadataUri: "https://zguard-delta.vercel.app/m.json" }),
      /must be ipfs/
    );
  });
});

describe("buyback-and-burn (4663, fail-closed)", () => {
  it("one Safe call: curve.buy(quoteIn, minOut, 0x…dEaD), behind an allow bound to these bytes", async () => {
    const { reader } = fakeChain();
    const g = spyGuard();
    const plan = await buyback(reader, { evaluate: g.evaluate, slippageBps: 300 });
    assert.equal(g.seen.length, 1);
    assert.deepEqual(g.seen[0]!.checks, ["quote", "simulation", "token_risk"]);
    assert.equal(g.seen[0]!.token, TOKEN);
    assert.equal(plan.minTokensOut, (plan.tokensOut * 9700n) / 10_000n);
    const { functionName, args } = decodeFunctionData({ abi: PONS_V2_CURVE_ABI, data: plan.call.tx.data as Hex });
    assert.equal(functionName, "buy");
    assert.deepEqual(args, [10n ** 16n, plan.minTokensOut, BURN_ADDRESS]);
    assert.equal(plan.call.intent.expectedOut?.recipient, BURN_ADDRESS);
    assert.deepEqual(plan.safeFile.transactions, [
      { to: CURVE, value: (10n ** 16n).toString(), data: plan.call.tx.data, contractMethod: null, contractInputsValues: null },
    ]);
    assert.match(plan.safeFile.meta.description, /dec_test/);
  });

  it("guard off, no API key, unreachable API: no batch and no guard call", async () => {
    const { reader } = fakeChain();
    const g = spyGuard();
    await assert.rejects(buyback(reader, { evaluate: g.evaluate, mode: "off" }), GuardDisabledError);
    await assert.rejects(buyback(reader, {}), TokenGuardUnavailableError);
    await assert.rejects(
      buyback(reader, { evaluate: async () => { throw new Error("fetch failed"); } }),
      (e: unknown) => e instanceof TokenGuardUnavailableError && /could not be reached/.test((e as Error).message)
    );
    assert.equal(g.seen.length, 0);
  });

  it("deny, abstain, an allow for other bytes and an expired allow are all refused", async () => {
    const { reader } = fakeChain();
    for (const bad of [
      (r: GuardRequest) => allowFor(r, { decision: "deny", codes: ["S-REVERT"] }),
      (r: GuardRequest) => allowFor(r, { decision: "abstain", codes: ["P-UNAVAIL"] }),
      (r: GuardRequest) => allowFor(r, { payload_hash: `0x${"11".repeat(32)}` }),
      (r: GuardRequest) => allowFor(r, { expires_at: new Date(NOW - 1).toISOString() }),
    ]) {
      await assert.rejects(buyback(reader, { evaluate: spyGuard(bad).evaluate }), GuardBlockedError);
    }
  });

  it("chain checks run before the paid guard call", async () => {
    const cases: Array<[Partial<ChainState>, RegExp]> = [
      [{ exists: false }, /not a pons V2 launch/],
      [{ pairToken: getAddress("0x7E955252E15c84f5768B83c41a71F9eba181802F") }, /native ETH/],
      [{ curveToken: getAddress("0x9118BD806cB3906Dc6d50a4409a9e9dF48172365") }, /belongs to/],
      [{ curveFactory: getAddress("0x40f1be6faf8DAB9C143cce1a0A04c2075Fb2DF59") }, /not created by the pons V2 factory/],
      [{ graduated: true }, /Phase 2/],
      [{ native: false }, /native ETH/],
      [{ snipeBps: 9900n }, /snipe tax/],
      [{ tokensOut: 0n }, /0 tokens/],
    ];
    for (const [over, msg] of cases) {
      const g = spyGuard();
      await assert.rejects(buyback(fakeChain(over).reader, { evaluate: g.evaluate }), msg);
      assert.equal(g.seen.length, 0, `guard must not be called for ${msg}`);
    }
    await assert.rejects(buyback(fakeChain().reader, { evaluate: spyGuard().evaluate, chainId: 46630 }), /only on pons V2/);
  });

  it("builder rejects zero amounts", () => {
    assert.throws(() => buildV2BuybackBurn({ chainId: 4663, curve: CURVE, token: TOKEN, safe: ZGUARD_OPS_SAFE, quoteIn: 0n, minTokensOut: 1n }), /greater than zero/);
    assert.throws(() => buildV2BuybackBurn({ chainId: 4663, curve: CURVE, token: TOKEN, safe: ZGUARD_OPS_SAFE, quoteIn: 1n, minTokensOut: 0n }), /greater than zero/);
  });
});

describe("token-status", () => {
  it("reports Safe ownership and burned supply", async () => {
    const st = await tokenStatus({ reader: fakeChain().reader, token: TOKEN });
    assert.equal(st.ownedBySafe, true);
    assert.equal(st.burned, 5n * 10n ** 18n);
    const other = await tokenStatus({ reader: fakeChain({ deployer: getAddress("0x1FBaDaFb2056Af662aa11732e86B28aF550af0d9") }).reader, token: TOKEN });
    assert.equal(other.ownedBySafe, false);
  });
});
