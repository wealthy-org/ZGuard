// Mainnet (Robinhood Chain 4663) build-mode tests. Run: tsx scripts/test-mainnet-mode.ts
// Imports are dynamic because lib/web3/network.ts resolves the chain at module load.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { recoverTypedDataAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

process.env.NEXT_PUBLIC_PERM_CHAIN_ID = "4663";
const root = path.resolve(__dirname, "..");

async function main() {
  const network = await import("../lib/web3/network");
  const { LIVE_TOKENS, TOKEN_LISTS, ROUTE_HUB_TOKENS } = await import("../lib/web3/tokens");
  const { ACTIVE_V4_POOLS } = await import("../lib/server/pools");
  const policy = await import("../lib/server/staging-policy");
  const signer = await import("../lib/server/quote-signer");
  const { isExplicitV4V3Route } = await import("../lib/server/route-planner");

  // 1. Network selection
  assert.equal(network.IS_MAINNET, true);
  assert.equal(network.PERM_CHAIN_ID, 4663);
  assert.equal(network.MANIFEST.chainId, 4663);
  assert.equal(network.V3_VENUE.providerId, "UNISWAP_V3");
  assert.equal(network.V3_VENUE.factory, "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA");
  assert.equal(network.V3_VENUE.swapRouter02, "0xCaf681a66D020601342297493863E78C959E5cb2");
  assert.equal(network.V3_VENUE.weth, "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
  assert.equal(network.NETWORK_COPY.testnet, false);
  assert.doesNotMatch(Object.values(network.NETWORK_COPY).filter((value) => typeof value === "string").join(" "), /testnet|46630|synthra/i);

  // 2. Token list: only liquidity-admitted Stock Tokens, every one with a token≠share warning
  const report = JSON.parse(fs.readFileSync(path.join(root, "deployments/mainnet/liquidity-report.json"), "utf8"));
  const reportBySymbol = new Map<string, { address: string; decimals: number }>(report.tokens.map((token: { symbol: string; address: string; decimals: number }) => [token.symbol, token]));
  assert.equal(LIVE_TOKENS, TOKEN_LISTS.mainnet);
  for (const forbidden of ["OPENAI", "ANTHROPIC", "HOOD", "USDG", "WETH"]) {
    assert.ok(!LIVE_TOKENS.some((token) => token.symbol === forbidden), `${forbidden} must not be listed on mainnet`);
  }
  // AMZN / NFLX / MSFT are listed only through the USDG hub, and only while that hub route passes the 1% round-trip bar.
  const hubReport = JSON.parse(fs.readFileSync(path.join(root, "deployments/mainnet/hub-routes.json"), "utf8"));
  const hubBySymbol = new Map<string, { hubRoute?: { admitted: boolean; roundTripLossBps: number; leg1Fee: number; leg2Fee: number } }>(
    hubReport.tokens.map((token: { symbol: string }) => [token.symbol, token]),
  );
  assert.equal(hubReport.chainId, 4663);
  assert.equal(hubReport.hub.address.toLowerCase(), ROUTE_HUB_TOKENS.find((token) => token.symbol === "USDG")?.address.toLowerCase());
  for (const symbol of ["AMZN", "NFLX", "MSFT"]) {
    const token = LIVE_TOKENS.find((item) => item.symbol === symbol);
    assert.ok(token, `${symbol} must be listed on mainnet (USDG hub)`);
    assert.equal(token.viaHub, "USDG");
    const route = hubBySymbol.get(symbol)?.hubRoute;
    assert.ok(route?.admitted && route.roundTripLossBps <= 100, `${symbol} USDG hub route must be admitted (≤ 100 bps)`);
  }
  for (const token of LIVE_TOKENS.filter((item) => item.viaHub)) {
    assert.ok(hubBySymbol.get(token.symbol)?.hubRoute?.admitted, `${token.symbol} is viaHub but has no admitted hub route`);
  }
  assert.deepEqual(ROUTE_HUB_TOKENS.map((token) => token.symbol).sort(), ["USDG", "WETH"]);
  for (const token of LIVE_TOKENS) {
    assert.doesNotMatch(token.displaySymbol, /·T/);
    if (token.symbol === "ETH") continue;
    const audited = reportBySymbol.get(token.symbol);
    assert.ok(audited, `${token.symbol} missing from the liquidity report`);
    assert.equal(token.address.toLowerCase(), audited.address.toLowerCase(), `${token.symbol} address differs from the audited registry address`);
    assert.equal(token.decimals, audited.decimals);
    assert.match(token.warning || "", /not .*shares/i, `${token.symbol} needs a token≠share warning`);
  }

  // 3. v4 pool registry: hookless, native ETH, every pool belongs to a listed token, venue flags consistent
  assert.ok(ACTIVE_V4_POOLS.length > 0);
  const listed = new Map(LIVE_TOKENS.map((token) => [token.address.toLowerCase(), token]));
  for (const pool of ACTIVE_V4_POOLS) {
    assert.equal(pool.hooks, "0x0000000000000000000000000000000000000000");
    assert.equal(pool.currency0, "0x0000000000000000000000000000000000000000");
    assert.equal(pool.sourceType, "direct");
    const token = listed.get(pool.currency1.toLowerCase());
    assert.ok(token, `pool ${pool.id} uses an unlisted token`);
    assert.ok(token.venue === "uniswap-v4" || token.venue === "both", `${token.symbol} has a v4 pool but venue=${token.venue}`);
  }
  for (const token of LIVE_TOKENS.filter((item) => item.symbol !== "ETH")) {
    const hasV4 = ACTIVE_V4_POOLS.some((pool) => pool.currency1.toLowerCase() === token.address.toLowerCase());
    if (token.venue === "uniswap-v4" || token.venue === "both") assert.ok(hasV4, `${token.symbol} claims v4 but has no admitted pool`);
    if (token.venue === "uniswap-v3") assert.ok(!hasV4, `${token.symbol} claims v3-only but has a v4 pool`);
  }

  // 4. Route planner recognises Uniswap v3 as the v3 leg of a cross-venue route
  assert.equal(isExplicitV4V3Route({ routeKind: "cross-venue", steps: [{ providerId: "UNISWAP_V4_DIRECT" }, { providerId: "UNISWAP_V3" }] }), true);
  assert.equal(isExplicitV4V3Route({ routeKind: "cross-venue", steps: [{ providerId: "UNISWAP_V3" }, { providerId: "UNISWAP_V3" }] }), false);

  // 5. Allowlisted mainnet policy
  const walletA = `0x${"11".repeat(20)}`;
  const base = {
    NEXT_PUBLIC_PERM_CHAIN_ID: "4663",
    PERM_EXECUTION_MODE: policy.ALLOWLISTED_MAINNET_MODE,
    NEXT_PUBLIC_PERM_EXECUTION_MODE: policy.ALLOWLISTED_MAINNET_MODE,
    PERM_STAGING_CHAIN_ID: "4663",
    PERM_STAGING_WALLET_ALLOWLIST: walletA,
  };
  const configured = policy.allowlistedStagingConfiguration(base);
  assert.equal(configured.configured, true);
  assert.equal(configured.mainnet, true);
  assert.equal(configured.localBurnerSignerAllowed, false);
  assert.equal(policy.isAllowlistedStagingWallet(walletA, configured), true);
  assert.equal(policy.isAllowlistedStagingWallet(`0x${"22".repeat(20)}`, configured), false);
  for (const [environment, expected] of [
    [{ ...base, PERM_STAGING_CHAIN_ID: "46630" }, /4663/],
    [{ ...base, PERM_EXECUTION_MODE: policy.ALLOWLISTED_STAGING_MODE }, /allowlisted-mainnet/],
    [{ ...base, NEXT_PUBLIC_PERM_EXECUTION_MODE: policy.ALLOWLISTED_STAGING_MODE }, /allowlisted-mainnet/],
    [{ ...base, PERM_STAGING_ALLOW_BURNER_SIGNER: "1" }, /forbidden on mainnet/],
  ] as const) {
    const value = policy.allowlistedStagingConfiguration(environment);
    assert.equal(value.requested, true, "a wrong-chain mode string must still gate execution");
    assert.equal(value.configured, false);
    assert.match(value.reason || "", expected);
  }
  // A testnet build must not accept the mainnet mode either.
  const testnetWithMainnetMode = policy.allowlistedStagingConfiguration({ ...base, NEXT_PUBLIC_PERM_CHAIN_ID: undefined, PERM_STAGING_CHAIN_ID: "46630" });
  assert.equal(testnetWithMainnetMode.requested, true);
  assert.equal(testnetWithMainnetMode.configured, false);

  // 6. Quote signer on mainnet: remote only, allowlist + chain pinned
  const keys = ["PERM_QUOTE_SIGNER_MODE", "PERM_QUOTE_SIGNER_URL", "PERM_QUOTE_SIGNER_TOKEN", "PERM_QUOTE_SIGNER_PRIVATE_KEY", "QUOTE_SIGNER_ADDRESS",
    "PERM_EXECUTION_MODE", "NEXT_PUBLIC_PERM_EXECUTION_MODE", "PERM_STAGING_CHAIN_ID", "PERM_STAGING_WALLET_ALLOWLIST", "NEXT_PUBLIC_PERM_ROUTER_ADDRESS"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.PERM_QUOTE_SIGNER_MODE = "local";
    process.env.PERM_QUOTE_SIGNER_PRIVATE_KEY = `0x${"31".repeat(32)}`;
    let configuration = signer.quoteSignerConfiguration();
    assert.equal(configuration.configured, false);
    assert.match(configuration.reason || "", /remote/);
    process.env.PERM_QUOTE_SIGNER_MODE = "staging-local";
    assert.equal(signer.quoteSignerConfiguration().configured, false);

    const remote = privateKeyToAccount(`0x${"32".repeat(32)}`);
    const router = `0x${"10".repeat(20)}` as Address;
    delete process.env.PERM_QUOTE_SIGNER_PRIVATE_KEY;
    Object.assign(process.env, {
      PERM_QUOTE_SIGNER_MODE: "remote",
      QUOTE_SIGNER_ADDRESS: remote.address,
      PERM_QUOTE_SIGNER_URL: "https://signer.example/v1/sign",
      PERM_QUOTE_SIGNER_TOKEN: "test-token-at-least-sixteen",
      PERM_EXECUTION_MODE: policy.ALLOWLISTED_MAINNET_MODE,
      NEXT_PUBLIC_PERM_EXECUTION_MODE: policy.ALLOWLISTED_MAINNET_MODE,
      PERM_STAGING_CHAIN_ID: "4663",
      PERM_STAGING_WALLET_ALLOWLIST: walletA,
      NEXT_PUBLIC_PERM_ROUTER_ADDRESS: router,
    });
    configuration = signer.quoteSignerConfiguration();
    assert.equal(configuration.configured, true);
    assert.equal(configuration.custodyReady, true);
    const domain = { name: "Perm", version: "2", chainId: 4663, verifyingContract: router } as const;
    const message = {
      account: walletA as Address, tokenIn: "0x0000000000000000000000000000000000000000" as Address, tokenOut: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as Address,
      amountIn: 1_000_000_000_000_000n, minAmountOut: 1n, gasEstimate: 330_000n, recipient: walletA as Address,
      deadline: 2_000_000_000n, quotedAt: 1_999_999_900n, policyVersion: 1, chainId: 4663n,
      referrer: "0x0000000000000000000000000000000000000000" as Address, routeHash: `0x${"15".repeat(32)}` as `0x${string}`,
    };
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      const signed = await remote.signTypedData({ domain: { ...body.domain }, types: signer.PERM_QUOTE_TYPES, primaryType: "PermQuote", message: { ...message, ...body.message } });
      return new Response(JSON.stringify({ address: remote.address, signature: signed }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await signer.signPermQuote(domain, message);
    assert.equal(await recoverTypedDataAddress({ domain, types: signer.PERM_QUOTE_TYPES, primaryType: "PermQuote", message, signature: result.signature }), remote.address);
    await assert.rejects(() => signer.signPermQuote(domain, { ...message, account: `0x${"22".repeat(20)}` as Address }), /allowlist/i);
    await assert.rejects(() => signer.signPermQuote({ ...domain, chainId: 46630 }, { ...message, chainId: 46630n }), /pinned to chain 4663/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }

  console.log(`Mainnet mode: chain 4663 manifest + Uniswap v3 venue, ${LIVE_TOKENS.length - 1} liquidity-checked Stock Tokens, ${ACTIVE_V4_POOLS.length} hookless v4 pools, allowlisted-mainnet policy and remote-only signer fail closed`);
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
