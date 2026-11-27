import { NextResponse, type NextRequest } from "next/server";
import {
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  isAddress,
  keccak256,
  parseAbiParameters,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { MANIFEST as deployment } from "@/lib/web3/network";
import {
  ALLOWLISTED_STAGING_BUILD,
  IS_MAINNET,
  RELEASE_DEPLOYMENT_READY,
  STAGING_DEPLOYMENT_CONFIGURED,
  PERM_ROUTER_ADDRESS,
  PERM_V2_ADAPTER_ADDRESS,
  PERM_V3_ADAPTER_ADDRESS,
  PERM_V4_ADAPTER_ADDRESS,
  PERM_WETH_ADAPTER_ADDRESS,
  MAINNET_AGGREGATOR_HOOKS_ENABLED,
  REVIEWED_V2,
  REVIEWED_V2_STAGING_ENABLED,
  PERM_CHAIN_ID,
  ROUTER_VERSION,
  V3_VENUE,
  V4_QUOTER_ADDRESS,
  ZERO_ADDRESS,
  createRobinhoodPublicClient,
} from "@/lib/web3/config";
import {
  erc20Abi,
  permRouterAbi,
  permV4AdapterAbi,
  v2FactoryAbi,
  v2PairAbi,
  v3FactoryAbi,
  v3QuoterAbi,
  v4QuoterAbi,
} from "@/lib/web3/abis";
import { tokenPairPools, type V4PoolFixture } from "@/lib/server/pools";
import { discoverTwoStepRoutes, isExplicitV4V3Route } from "@/lib/server/route-planner";
import { HUB_TOKEN_MAP, LIVE_TOKEN_MAP, LIVE_TOKENS, ROUTE_HUB_TOKENS, type LiveToken, type LiveTokenSymbol } from "@/lib/web3/tokens";
import type { LiveQuote, LiveQuoteCandidate, QuoteRouteStep } from "@/lib/web3/quote";
import { RequestBodyTooLargeError, consumeRateLimit, readJsonBody, requestIdentity, safeServerError, ttlCached } from "@/lib/server/runtime";
import { PERM_QUOTE_TYPES, quoteSignerConfiguration, quoteSignerExecutionReady, signPermQuote } from "@/lib/server/quote-signer";
import { allowlistedStagingConfiguration, isAllowlistedStagingWallet } from "@/lib/server/staging-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BPS = 10_000n;
const MAX_INT128 = (1n << 127n) - 1n;
const MAX_QUOTED_GAS = 30_000_000n;
const V3_FEES = [100, 500, 3_000, 10_000] as const;
const ROUTE_STEP_PARAMETERS = parseAbiParameters("(address adapter,address tokenIn,address tokenOut,bytes data)[]");
type RoutingMode = "best" | "v4" | "v3" | "v2" | "mixed" | "hooks";
type QuoteBody = {
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  slippageBps?: number;
  account?: string;
  recipient?: string;
  referrer?: string;
  routingMode?: RoutingMode;
};
type RawQuote = { amountOut: bigint; gasEstimate: bigint };
type InternalStep = QuoteRouteStep & { requote: (amount: bigint) => Promise<RawQuote> };
type InternalCandidate = LiveQuoteCandidate & { requote: (amount: bigint) => Promise<bigint>; conversionStep?: InternalStep };

async function runLimited<T>(jobs: Array<() => Promise<T>>, concurrency = 8): Promise<T[]> {
  const results = new Array<T>(jobs.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= jobs.length) return;
      results[index] = await jobs[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

function error(message: string, status = 400, extraHeaders?: Record<string, string>) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "cache-control": "no-store", ...extraHeaders },
  });
}

function routeDataFor(steps: InternalStep[]): Hex {
  return encodeAbiParameters(ROUTE_STEP_PARAMETERS, [steps.map((step) => ({
    adapter: step.adapter,
    tokenIn: step.tokenIn,
    tokenOut: step.tokenOut,
    data: step.data,
  }))]);
}

function configuredHookPools(): V4PoolFixture[] {
  let parsed: unknown;
  if (IS_MAINNET) {
    // Mainnet: only the manifest list (written by deploy-mainnet.cjs from deployments/mainnet/aggregator-hooks.json),
    // only behind PERM_MAINNET_ENABLE_AGGREGATOR_HOOKS=1, never from an env override. Each hook is additionally
    // re-checked against the codehash pinned on PermV4Adapter for every quote (v4Step).
    if (!MAINNET_AGGREGATOR_HOOKS_ENABLED) return [];
    parsed = deployment.aggregatorHooks || [];
  } else {
    if (ALLOWLISTED_STAGING_BUILD || allowlistedStagingConfiguration().requested) return [];
    const override = process.env.PERM_AGGREGATOR_HOOKS_JSON;
    if (override && override.length > 65_536) throw new Error("PERM_AGGREGATOR_HOOKS_JSON is too large");
    parsed = override ? JSON.parse(override) : deployment.aggregatorHooks || [];
  }
  if (!Array.isArray(parsed) || parsed.length > 32) throw new Error("Aggregator Hook configuration is invalid");
  const entries = parsed as Array<Partial<V4PoolFixture>>;
  return entries.filter((entry): entry is V4PoolFixture => Boolean(
    entry.id && entry.currency0 && entry.currency1 && entry.hooks && entry.hookData !== undefined
      && entry.fee !== undefined && entry.tickSpacing !== undefined && entry.initializationBlock !== undefined
      && entry.sourceType === "aggregator-hook",
  ));
}

export async function POST(request: NextRequest) {
  const identity = requestIdentity(request);
  try {
    const limit = await consumeRateLimit(`quote:${identity}`, 12, 0.5);
    if (!limit.allowed) return error("Too many quote requests. Retry shortly.", 429, { "retry-after": String(limit.retryAfter) });
  } catch (cause) {
    return error(safeServerError("quote-rate-limit", cause, "Request protection is temporarily unavailable"), 503);
  }

  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return error("Content-Type must be application/json", 415);
  }
  let body: QuoteBody;
  try {
    const parsed = await readJsonBody(request, 16_384);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return error("Quote body must be a JSON object");
    body = parsed as QuoteBody;
  } catch (cause) {
    if (cause instanceof RequestBodyTooLargeError) return error("Quote request body is too large", 413);
    return error("Invalid JSON body");
  }

  const allowedFields = new Set(["tokenIn", "tokenOut", "amountIn", "slippageBps", "account", "recipient", "referrer", "routingMode"]);
  if (Object.keys(body).some((field) => !allowedFields.has(field))) return error("Quote body contains an unsupported field");
  if (typeof body.tokenIn !== "string" || typeof body.tokenOut !== "string" || typeof body.amountIn !== "string") {
    return error("tokenIn, tokenOut and amountIn must be strings");
  }
  if (body.slippageBps !== undefined && typeof body.slippageBps !== "number") return error("slippageBps must be a number");
  for (const [field, value] of [["account", body.account], ["recipient", body.recipient], ["referrer", body.referrer]] as const) {
    if (value !== undefined && typeof value !== "string") return error(`${field} must be an address string`);
  }
  if (body.routingMode !== undefined && typeof body.routingMode !== "string") return error("routingMode must be a string");

  const tokenIn = LIVE_TOKEN_MAP[body.tokenIn as LiveTokenSymbol];
  const tokenOut = LIVE_TOKEN_MAP[body.tokenOut as LiveTokenSymbol];
  if (!tokenIn || !tokenOut || tokenIn.symbol === tokenOut.symbol) return error("Unsupported token pair");
  if (body.routingMode && !["best", "v4", "v3", "v2", "mixed", "hooks"].includes(body.routingMode)) return error("Unsupported routing mode");
  const routingMode: RoutingMode = body.routingMode === "v4" || body.routingMode === "v3" || body.routingMode === "v2" || body.routingMode === "mixed" || body.routingMode === "hooks" ? body.routingMode : "best";

  const requestedAddresses = [body.account, body.recipient, body.referrer].filter((value): value is string => value !== undefined);
  if (requestedAddresses.some((address) => !isAddress(address))) return error("Quote binding contains an invalid address");
  const account = getAddress(body.account || ZERO_ADDRESS) as Address;
  const recipient = getAddress(body.recipient || ZERO_ADDRESS) as Address;
  const referrer = getAddress(body.referrer || ZERO_ADDRESS) as Address;
  if (account !== ZERO_ADDRESS && referrer.toLowerCase() === account.toLowerCase()) return error("Self-referral is not permitted");

  const staging = allowlistedStagingConfiguration();
  const stagingRequested = ALLOWLISTED_STAGING_BUILD || staging.requested;
  // Testnet staging keeps hooks off; mainnet allows only the codehash-pinned manifest hooks behind an explicit flag.
  const hooksAllowed = IS_MAINNET ? MAINNET_AGGREGATOR_HOOKS_ENABLED : !stagingRequested;
  if (routingMode === "hooks" && !hooksAllowed) {
    return error(`Aggregator Hook routing is disabled on this deployment; use a direct Uniswap v4 or ${V3_VENUE.shortLabel} route`, 422);
  }
  if (routingMode === "v2" && (!stagingRequested || !REVIEWED_V2_STAGING_ENABLED || !PERM_V2_ADAPTER_ADDRESS)) {
    return error(IS_MAINNET
      ? "Uniswap v2 routing is not enabled on this deployment"
      : "Third-party V2 routing is withheld pending provenance, activity and liquidity admission gates", 422);
  }
  if (stagingRequested && account !== ZERO_ADDRESS) {
    if (!staging.configured) return error(staging.reason || "Allowlisted staging is not configured", 503);
    if (!isAllowlistedStagingWallet(account, staging)) return error("This wallet is not authorized for allowlisted staging execution", 403);
  }

  let amountIn: bigint;
  try {
    if (!body.amountIn || !/^[0-9]{1,78}$/.test(body.amountIn)) throw new Error("invalid amount");
    amountIn = BigInt(body.amountIn);
  } catch {
    return error("amountIn must be a decimal integer in token base units");
  }
  if (amountIn <= 0n || amountIn > MAX_INT128) return error("amountIn is outside the exact-input range");

  const slippageBps = Number(body.slippageBps ?? 50);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 2_000) {
    return error("slippageBps must be between 1 and 2000");
  }

  const client = createRobinhoodPublicClient();
  try {
    await Promise.all([tokenIn, tokenOut].map(async (token) => {
      if (token.address === ZERO_ADDRESS) return;
      const decimals = await ttlCached(`decimals:${token.address}`, 60 * 60_000, () => client.readContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "decimals",
      }));
      if (decimals !== token.decimals) throw new Error(`Token metadata mismatch for ${token.symbol}`);
    }));

    const policy = await ttlCached(`policy:${PERM_ROUTER_ADDRESS}:${ROUTER_VERSION}`, 10_000, async () => {
      if (!PERM_ROUTER_ADDRESS) throw new Error("PermRouter deployment is not configured");
      if (ROUTER_VERSION >= 2) {
        const version = await client.readContract({ address: PERM_ROUTER_ADDRESS, abi: permRouterAbi, functionName: "activePolicyVersion" });
        const values = await client.readContract({ address: PERM_ROUTER_ADDRESS, abi: permRouterAbi, functionName: "feePolicies", args: [version] });
        return { version: Number(version), platformFeeBps: Number(values[0]), rebateShareBps: Number(values[1]), enabled: values[2] };
      }
      const version = deployment.policy.version;
      const values = await client.readContract({ address: PERM_ROUTER_ADDRESS, abi: permRouterAbi, functionName: "feePolicies", args: [version] });
      return { version, platformFeeBps: Number(values[0]), rebateShareBps: Number(values[1]), enabled: values[2] };
    });
    if (!policy.enabled) return error("The active Perm fee policy is disabled", 503);

    const grossFee = amountIn * BigInt(policy.platformFeeBps) / BPS;
    const rebate = grossFee * BigInt(policy.rebateShareBps) / BPS;
    const netFee = grossFee - rebate;
    const routedInput = amountIn - netFee;
    if (routedInput <= 0n || routedInput > MAX_INT128) return error("Routed input is outside the quote range");

    const [block, gasPrice] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.getGasPrice(),
    ]);

    const quoteV4Raw = async (pool: V4PoolFixture, input: LiveToken, output: LiveToken, amount: bigint): Promise<RawQuote> => {
      const key = `v4:${pool.id}:${input.address}:${amount}:${keccak256(pool.hookData)}`;
      return ttlCached(key, 2_000, async () => {
        const zeroForOne = input.address.toLowerCase() === pool.currency0.toLowerCase();
        const { result } = await client.simulateContract({
          account: ZERO_ADDRESS,
          address: V4_QUOTER_ADDRESS,
          abi: v4QuoterAbi,
          functionName: "quoteExactInputSingle",
          args: [{
            poolKey: {
              currency0: pool.currency0,
              currency1: pool.currency1,
              fee: pool.fee,
              tickSpacing: pool.tickSpacing,
              hooks: pool.hooks,
            },
            zeroForOne,
            exactAmount: amount,
            hookData: pool.hookData,
          }],
        });
        if (result[0] <= 0n) throw new Error("Empty v4 quote");
        return { amountOut: result[0], gasEstimate: result[1] };
      });
    };

    const v4Step = async (input: LiveToken, output: LiveToken, amount: bigint, pool: V4PoolFixture): Promise<InternalStep | null> => {
      if (!PERM_V4_ADAPTER_ADDRESS) return null;
      let verifiedHook = false;
      let hookCodehash: Hex | undefined;
      if (pool.hooks !== ZERO_ADDRESS) {
        if (ROUTER_VERSION < 2) return null;
        const [expected, code] = await Promise.all([
          client.readContract({ address: PERM_V4_ADAPTER_ADDRESS, abi: permV4AdapterAbi, functionName: "verifiedHookCodehashes", args: [pool.hooks] }),
          client.getCode({ address: pool.hooks }),
        ]);
        if (!code || expected === `0x${"0".repeat(64)}` || keccak256(code).toLowerCase() !== expected.toLowerCase()) return null;
        verifiedHook = true;
        hookCodehash = expected;
      }
      const raw = await quoteV4Raw(pool, input, output, amount);
      const data = encodeAbiParameters([
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
        { type: "bytes" },
      ], [{
        currency0: pool.currency0,
        currency1: pool.currency1,
        fee: pool.fee,
        tickSpacing: pool.tickSpacing,
        hooks: pool.hooks,
      }, pool.hookData]);
      const aggregator = pool.sourceType === "aggregator-hook";
      return {
        providerId: aggregator ? "UNISWAP_V4_AGGREGATOR_HOOK" : "UNISWAP_V4_DIRECT",
        providerLabel: aggregator ? (IS_MAINNET ? "v4 Aggregator Hook (codehash-pinned)" : "Verified v4 Aggregator Hook") : "Uniswap v4 direct pool",
        adapter: PERM_V4_ADAPTER_ADDRESS,
        tokenIn: input.address,
        tokenOut: output.address,
        amountIn: amount.toString(),
        amountOut: raw.amountOut.toString(),
        gasEstimate: raw.gasEstimate.toString(),
        poolId: pool.id,
        poolFee: pool.fee,
        hook: pool.hooks,
        verifiedHook,
        hookCodehash,
        data: data as Hex,
        requote: (nextAmount) => quoteV4Raw(pool, input, output, nextAmount),
      };
    };

    const v3Pool = async (input: LiveToken, output: LiveToken, fee: number) => {
      const actualIn = input.address === ZERO_ADDRESS ? V3_VENUE.weth : input.address;
      const actualOut = output.address === ZERO_ADDRESS ? V3_VENUE.weth : output.address;
      if (actualIn.toLowerCase() === actualOut.toLowerCase()) return ZERO_ADDRESS;
      // A v3 pool address is CREATE2-derived and permanent once created, so a hit is cached for a day and a miss
      // for five minutes. Two-step discovery probes ~140 (pair, fee) combinations; re-reading them on every quote
      // would trip the public RPC rate limit (HTTP 429) and silently drop candidates.
      const key = `v3pool:${actualIn}:${actualOut}:${fee}`;
      const hit = await ttlCached(`${key}:hit`, 86_400_000, async () => {
        const pool = await ttlCached(`${key}:miss`, 300_000, () => client.readContract({
          address: V3_VENUE.factory,
          abi: v3FactoryAbi,
          functionName: "getPool",
          args: [actualIn, actualOut, fee],
        }));
        if (pool === ZERO_ADDRESS) throw new Error("v3 pool not created");
        return pool;
      }).catch(() => ZERO_ADDRESS);
      return hit as Address;
    };

    const quoteV3Raw = async (input: LiveToken, output: LiveToken, fee: number, amount: bigint): Promise<RawQuote> => {
      const actualIn = input.address === ZERO_ADDRESS ? V3_VENUE.weth : input.address;
      const actualOut = output.address === ZERO_ADDRESS ? V3_VENUE.weth : output.address;
      return ttlCached(`v3quote:${actualIn}:${actualOut}:${fee}:${amount}`, 2_000, async () => {
        const { result } = await client.simulateContract({
          account: ZERO_ADDRESS,
          address: V3_VENUE.quoterV2,
          abi: v3QuoterAbi,
          functionName: "quoteExactInputSingle",
          args: [{ tokenIn: actualIn, tokenOut: actualOut, amountIn: amount, fee, sqrtPriceLimitX96: 0n }],
        });
        if (result[0] <= 0n) throw new Error("Empty v3 quote");
        return { amountOut: result[0], gasEstimate: result[3] };
      });
    };

    const v3Step = async (input: LiveToken, output: LiveToken, amount: bigint, fee: number): Promise<InternalStep | null> => {
      if (!PERM_V3_ADAPTER_ADDRESS || await v3Pool(input, output, fee) === ZERO_ADDRESS) return null;
      const raw = await quoteV3Raw(input, output, fee, amount);
      const data = encodeAbiParameters(parseAbiParameters("uint24,uint160"), [fee, 0n]);
      const actualIn = input.address === ZERO_ADDRESS ? V3_VENUE.weth : input.address;
      const actualOut = output.address === ZERO_ADDRESS ? V3_VENUE.weth : output.address;
      const pool = await v3Pool(input, output, fee);
      return {
        providerId: V3_VENUE.providerId,
        providerLabel: V3_VENUE.label,
        adapter: PERM_V3_ADAPTER_ADDRESS,
        tokenIn: input.address,
        tokenOut: output.address,
        amountIn: amount.toString(),
        amountOut: raw.amountOut.toString(),
        gasEstimate: raw.gasEstimate.toString(),
        poolId: keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,address"), [actualIn, actualOut, fee, pool])),
        poolFee: fee,
        hook: ZERO_ADDRESS,
        verifiedHook: false,
        data,
        requote: (nextAmount) => quoteV3Raw(input, output, fee, nextAmount),
      };
    };

    const quoteV2Raw = async (input: LiveToken, output: LiveToken, amount: bigint): Promise<RawQuote & { pair: Address }> => {
      const actualIn = input.address === ZERO_ADDRESS ? REVIEWED_V2.weth : input.address;
      const actualOut = output.address === ZERO_ADDRESS ? REVIEWED_V2.weth : output.address;
      if (actualIn.toLowerCase() === actualOut.toLowerCase()) throw new Error("Invalid V2 pair");
      return ttlCached(`v2quote:${actualIn}:${actualOut}:${amount}`, 2_000, async () => {
        await ttlCached("v2dependencies", 10_000, async () => {
          const [factoryCode, wethCode] = await Promise.all([
            client.getCode({ address: REVIEWED_V2.factory }),
            client.getCode({ address: REVIEWED_V2.weth }),
          ]);
          if (!factoryCode || keccak256(factoryCode).toLowerCase() !== REVIEWED_V2.factoryCodehash.toLowerCase()) throw new Error("V2 factory codehash mismatch");
          if (!wethCode || keccak256(wethCode).toLowerCase() !== REVIEWED_V2.wethCodehash.toLowerCase()) throw new Error("V2 WETH codehash mismatch");
          return true;
        });
        const pair = await client.readContract({
          address: REVIEWED_V2.factory,
          abi: v2FactoryAbi,
          functionName: "getPair",
          args: [actualIn, actualOut],
        });
        if (pair === ZERO_ADDRESS) throw new Error("No reviewed V2 pair");
        const [code, venueFactory, token0, token1, reserves] = await Promise.all([
          client.getCode({ address: pair }),
          client.readContract({ address: pair, abi: v2PairAbi, functionName: "factory" }),
          client.readContract({ address: pair, abi: v2PairAbi, functionName: "token0" }),
          client.readContract({ address: pair, abi: v2PairAbi, functionName: "token1" }),
          client.readContract({ address: pair, abi: v2PairAbi, functionName: "getReserves" }),
        ]);
        if (!code || keccak256(code).toLowerCase() !== REVIEWED_V2.pairCodehash.toLowerCase()) throw new Error("V2 pair codehash mismatch");
        if (venueFactory.toLowerCase() !== REVIEWED_V2.factory.toLowerCase()) throw new Error("V2 pair factory mismatch");
        const forward = token0.toLowerCase() === actualIn.toLowerCase() && token1.toLowerCase() === actualOut.toLowerCase();
        const reverse = token1.toLowerCase() === actualIn.toLowerCase() && token0.toLowerCase() === actualOut.toLowerCase();
        if (!forward && !reverse) throw new Error("V2 pair token mismatch");
        const [balance0, balance1] = await Promise.all([
          client.readContract({ address: token0, abi: erc20Abi, functionName: "balanceOf", args: [pair] }),
          client.readContract({ address: token1, abi: erc20Abi, functionName: "balanceOf", args: [pair] }),
        ]);
        if (balance0 !== reserves[0] || balance1 !== reserves[1]) throw new Error("V2 pair balances differ from reserves");
        const reserveIn = forward ? reserves[0] : reserves[1];
        const reserveOut = forward ? reserves[1] : reserves[0];
        if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("Empty V2 reserves");
        // Mainnet: most Uniswap V2 stock pairs hold dust. Refuse any hop that would move more than 3% of the
        // input-side reserve instead of presenting a near-empty pair as a route candidate.
        if (IS_MAINNET && amount * 100n > reserveIn * 3n) throw new Error("V2 pair too shallow for this amount");
        const amountInWithFee = amount * REVIEWED_V2.feeNumerator;
        const amountOut = amountInWithFee * reserveOut
          / (reserveIn * REVIEWED_V2.feeDenominator + amountInWithFee);
        if (amountOut <= 0n || amountOut >= reserveOut) throw new Error("Empty V2 quote");
        return { amountOut, gasEstimate: REVIEWED_V2.stepGasEstimate, pair };
      });
    };

    const v2Step = async (input: LiveToken, output: LiveToken, amount: bigint): Promise<InternalStep | null> => {
      if (!stagingRequested || !REVIEWED_V2_STAGING_ENABLED || !PERM_V2_ADAPTER_ADDRESS) return null;
      const raw = await quoteV2Raw(input, output, amount);
      const data = encodeAbiParameters(parseAbiParameters("address"), [raw.pair]);
      const actualIn = input.address === ZERO_ADDRESS ? REVIEWED_V2.weth : input.address;
      const actualOut = output.address === ZERO_ADDRESS ? REVIEWED_V2.weth : output.address;
      return {
        providerId: REVIEWED_V2.providerId,
        providerLabel: REVIEWED_V2.label,
        adapter: PERM_V2_ADAPTER_ADDRESS,
        tokenIn: input.address,
        tokenOut: output.address,
        amountIn: amount.toString(),
        amountOut: raw.amountOut.toString(),
        gasEstimate: raw.gasEstimate.toString(),
        poolId: keccak256(encodeAbiParameters(parseAbiParameters("address,address,address,address"), [
          REVIEWED_V2.factory, raw.pair, actualIn, actualOut,
        ])),
        poolFee: 3_000,
        hook: ZERO_ADDRESS,
        verifiedHook: false,
        data,
        requote: async (nextAmount) => quoteV2Raw(input, output, nextAmount),
      };
    };

    // 1:1 ETH <-> WETH step (PermWethAdapter). Only used to reach WETH-denominated Aggregator Hook pools.
    const wethHub = HUB_TOKEN_MAP.WETH;
    const wrapStep = (input: LiveToken, output: LiveToken, amount: bigint): InternalStep | null => {
      if (!PERM_WETH_ADAPTER_ADDRESS || !wethHub || !hooksAllowed) return null;
      const wrapping = input.address === ZERO_ADDRESS && output.address.toLowerCase() === wethHub.address.toLowerCase();
      const unwrapping = output.address === ZERO_ADDRESS && input.address.toLowerCase() === wethHub.address.toLowerCase();
      if (!wrapping && !unwrapping) return null;
      const exact = async (nextAmount: bigint): Promise<RawQuote> => ({ amountOut: nextAmount, gasEstimate: 45_000n });
      return {
        providerId: "WETH_WRAP",
        providerLabel: wrapping ? "Wrap ETH → WETH (1:1)" : "Unwrap WETH → ETH (1:1)",
        adapter: PERM_WETH_ADAPTER_ADDRESS,
        tokenIn: input.address,
        tokenOut: output.address,
        amountIn: amount.toString(),
        amountOut: amount.toString(),
        gasEstimate: "45000",
        poolId: keccak256(toHex(wrapping ? "PERM_WETH_WRAP_V1" : "PERM_WETH_UNWRAP_V1")),
        poolFee: 0,
        hook: ZERO_ADDRESS,
        verifiedHook: false,
        data: "0x",
        requote: exact,
      };
    };

    const bestGasConversionStep = async (output: LiveToken, amount: bigint): Promise<InternalStep | undefined> => {
      if (output.address === ZERO_ADDRESS) return undefined;
      const tasks: Array<() => Promise<InternalStep | null>> = [];
      for (const pool of tokenPairPools(ZERO_ADDRESS, output.address).filter((item) => item.sourceType === "direct").slice(0, 64)) {
        tasks.push(() => v4Step(LIVE_TOKEN_MAP.ETH, output, amount, pool).catch(() => null));
      }
      for (const fee of V3_FEES) tasks.push(() => v3Step(LIVE_TOKEN_MAP.ETH, output, amount, fee).catch(() => null));
      tasks.push(() => v2Step(LIVE_TOKEN_MAP.ETH, output, amount).catch(() => null));
      return (await runLimited(tasks)).filter((step): step is InternalStep => step !== null)
        .sort((a, b) => BigInt(b.amountOut) > BigInt(a.amountOut) ? 1 : BigInt(b.amountOut) < BigInt(a.amountOut) ? -1 : 0)[0];
    };

    // Mainnet: the "v4" mode means direct (hookless) Uniswap v4 only, so a clip narrated as "Uniswap v4" can never
    // settle through an Aggregator Hook; hook routes appear in "hooks" and "best". Testnet keeps hooks under "v4".
    const hookModeActive = routingMode === "best" || routingMode === "hooks" || (routingMode === "v4" && !IS_MAINNET);
    const edges = async (input: LiveToken, output: LiveToken, amount: bigint): Promise<InternalStep[]> => {
      // WETH is a hook-only hub: it is reached by the 1:1 wrap step and left through Aggregator Hook pools.
      // Every other venue already wraps ETH internally, so quoting them again with WETH would only duplicate routes.
      const isWethHub = (token: LiveToken) => Boolean(wethHub && token.address.toLowerCase() === wethHub.address.toLowerCase());
      if (isWethHub(input) || isWethHub(output)) {
        const wrap = wrapStep(input, output, amount);
        if (wrap) return hookModeActive ? [wrap] : [];
        if (!hooksAllowed || !hookModeActive) return [];
        const hookPools = configuredHookPools().filter((pool) => {
          const a = pool.currency0.toLowerCase();
          const b = pool.currency1.toLowerCase();
          return (a === input.address.toLowerCase() && b === output.address.toLowerCase())
            || (b === input.address.toLowerCase() && a === output.address.toLowerCase());
        });
        const hookTasks = hookPools.slice(0, 16).map((pool) => () => v4Step(input, output, amount, pool).catch(() => null));
        return (await runLimited(hookTasks)).filter((step): step is InternalStep => step !== null);
      }
      const pools = [...tokenPairPools(input.address, output.address), ...configuredHookPools().filter((pool) => {
        const a = pool.currency0.toLowerCase();
        const b = pool.currency1.toLowerCase();
        return (a === input.address.toLowerCase() && b === output.address.toLowerCase())
          || (b === input.address.toLowerCase() && a === output.address.toLowerCase());
      })];
      const tasks: Array<() => Promise<InternalStep | null>> = [];
      if (routingMode === "best" || routingMode === "v4" || routingMode === "mixed") {
        for (const pool of pools.filter((item) => item.sourceType === "direct").slice(0, 64)) tasks.push(() => v4Step(input, output, amount, pool).catch(() => null));
      }
      if (routingMode === "best" || routingMode === "v3" || routingMode === "mixed") {
        for (const fee of V3_FEES) tasks.push(() => v3Step(input, output, amount, fee).catch(() => null));
      }
      if (routingMode === "best" || routingMode === "v2") {
        tasks.push(() => v2Step(input, output, amount).catch(() => null));
      }
      if (hooksAllowed && hookModeActive) {
        for (const pool of pools.filter((item) => item.sourceType === "aggregator-hook").slice(0, 16)) tasks.push(() => v4Step(input, output, amount, pool).catch(() => null));
      }
      return (await runLimited(tasks)).filter((step): step is InternalStep => step !== null);
    };

    const gasConversionReference = 1_000_000_000_000_000n; // 0.001 ETH; used only as a spot-rate probe.
    let fallbackGasConversion: Promise<InternalStep | undefined> | undefined;
    const fallbackConversion = () => {
      fallbackGasConversion ??= bestGasConversionStep(tokenOut, gasConversionReference);
      return fallbackGasConversion;
    };

    const buildCandidate = async (steps: InternalStep[]): Promise<InternalCandidate> => {
      const routeData = routeDataFor(steps);
      const amountOut = BigInt(steps[steps.length - 1].amountOut);
      const executionGas = 150_000n + steps.reduce((sum, step) => sum + BigInt(step.gasEstimate) + 75_000n, 0n);
      const networkFee = executionGas * gasPrice;
      const providers = [...new Set(steps.map((step) => step.providerId))];
      const hasAggregator = steps.some((step) => step.providerId === "UNISWAP_V4_AGGREGATOR_HOOK");
      const routeKind = hasAggregator ? "aggregator-hook" : steps.length === 1 ? "direct" : providers.length > 1 ? "cross-venue" : "multi-hop";
      const providerLabel = steps.map((step) => step.providerLabel).join(" → ");
      const minAmountOut = amountOut * (BPS - BigInt(slippageBps)) / BPS;
      let conversionStep = steps.findLast((step) => step.tokenIn === ZERO_ADDRESS && step.tokenOut === tokenOut.address);
      if (tokenOut.address !== ZERO_ADDRESS && !conversionStep) conversionStep = await fallbackConversion();
      const candidate: InternalCandidate = {
        providerId: providers.join("+"),
        providerLabel,
        routeKind,
        routeId: keccak256(routeData),
        routeData,
        steps: steps.map(({ requote: _requote, ...step }) => step),
        amountOut: amountOut.toString(),
        minAmountOut: minAmountOut.toString(),
        gasEstimate: executionGas.toString(),
        estimatedNetworkFeeWei: networkFee.toString(),
        gasNormalized: tokenOut.address === ZERO_ADDRESS || Boolean(conversionStep),
        hook: steps.find((step) => step.hook !== ZERO_ADDRESS)?.hook || ZERO_ADDRESS,
        verifiedHook: steps.some((step) => step.verifiedHook),
        conversionStep,
        requote: async (nextAmount: bigint) => {
          let current = nextAmount;
          for (const step of steps) current = (await step.requote(current)).amountOut;
          return current;
        },
      };
      try {
        const conversionInput = conversionStep ? BigInt(conversionStep.amountIn) : 0n;
        const gasInOutput = tokenOut.address === ZERO_ADDRESS
          ? networkFee
          : conversionStep && conversionInput > 0n
            ? BigInt(conversionStep.amountOut) * networkFee / conversionInput
            : undefined;
        if (gasInOutput !== undefined) {
          candidate.estimatedGasInOutput = gasInOutput.toString();
          candidate.gasAdjustedOutput = (amountOut > gasInOutput ? amountOut - gasInOutput : 0n).toString();
        }
      } catch {
        candidate.gasNormalized = false;
      }
      return candidate;
    };

    const directSteps = await edges(tokenIn, tokenOut, routedInput);
    const candidatePromises: Array<Promise<InternalCandidate>> = directSteps.map((step) => buildCandidate([step]));

    const twoStepCandidates = await discoverTwoStepRoutes({
      // Mainnet: only real hubs (ETH, USDG, WETH) as the middle hop – fast, and it is where the liquidity is.
      tokens: IS_MAINNET ? [LIVE_TOKEN_MAP.ETH, ...ROUTE_HUB_TOKENS] : LIVE_TOKENS,
      input: tokenIn,
      output: tokenOut,
      amountIn: routedInput,
      edges,
      buildCandidate,
      maxIntermediates: 16,
      maxFirstLegs: 2,
      maxSecondLegs: 3,
      concurrency: 3,
    });

    const internalCandidates = [...await Promise.all(candidatePromises), ...twoStepCandidates];
    const modeCandidates = routingMode === "mixed"
      ? internalCandidates.filter(isExplicitV4V3Route)
      : internalCandidates;
    const deduped = [...new Map(modeCandidates
      .filter((candidate) => BigInt(candidate.gasEstimate) > 0n && BigInt(candidate.gasEstimate) <= MAX_QUOTED_GAS)
      .map((candidate) => [candidate.routeId, candidate])).values()]
      .sort((a, b) => {
        if (a.gasNormalized !== b.gasNormalized) return a.gasNormalized ? -1 : 1;
        const left = BigInt(a.gasAdjustedOutput ?? a.amountOut);
        const right = BigInt(b.gasAdjustedOutput ?? b.amountOut);
        return right > left ? 1 : right < left ? -1 : 0;
      })
      .slice(0, 12);
    if (IS_MAINNET && deduped.length > 1) {
      // Mainnet: hide near-empty pools (e.g. a 1% v3 pool or a thin hop holding a few dollars). A candidate more
      // than 10% below the best raw output cannot be explained by gas at these sizes and would only mislead.
      const bestRaw = deduped.reduce((best, candidate) => BigInt(candidate.amountOut) > best ? BigInt(candidate.amountOut) : best, 0n);
      for (let index = deduped.length - 1; index >= 0; index -= 1) {
        if (BigInt(deduped[index].amountOut) * 10n < bestRaw * 9n) deduped.splice(index, 1);
      }
    }
    if (!deduped.length) {
      return error(routingMode === "hooks"
        ? "No verified Aggregator Hook candidate is configured and executable on this deployment"
        : routingMode === "mixed"
          ? "No executable v4-to-v3 or v3-to-v4 route is available for this pair"
          : "No executable route is available for this pair", 422);
    }

    const selectedInternal = deduped[0];
    try {
      const smallInput = routedInput / 1_000n;
      if (smallInput > 0n) {
        const smallOutput = await selectedInternal.requote(smallInput);
        const referenceOutput = smallOutput * routedInput / smallInput;
        selectedInternal.priceImpactBps = referenceOutput > BigInt(selectedInternal.amountOut) && referenceOutput > 0n
          ? Number((referenceOutput - BigInt(selectedInternal.amountOut)) * BPS / referenceOutput)
          : 0;
      }
    } catch {
      // Price impact remains unavailable rather than being fabricated.
    }

    const quotedAt = Number(block.timestamp);
    const deadline = quotedAt + 90;
    const signer = quoteSignerConfiguration();
    const domain = { name: "Perm", version: "2", chainId: PERM_CHAIN_ID, verifyingContract: PERM_ROUTER_ADDRESS || ZERO_ADDRESS } as const;
    const message = {
      account,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn,
      minAmountOut: BigInt(selectedInternal.minAmountOut),
      gasEstimate: BigInt(selectedInternal.gasEstimate),
      recipient,
      deadline: BigInt(deadline),
      quotedAt: BigInt(quotedAt),
      policyVersion: policy.version,
      chainId: BigInt(PERM_CHAIN_ID),
      referrer,
      routeHash: keccak256(selectedInternal.routeData),
    };
    const quoteId = hashTypedData({ domain, types: PERM_QUOTE_TYPES, primaryType: "PermQuote", message });

    const signerRuntimeAllowed = quoteSignerExecutionReady(signer);
    const releaseSignerAllowed = signer.configured && signer.custodyReady;
    const stagingSignerAllowed = signer.configured && signer.stagingReady && signerRuntimeAllowed;
    const releaseExecutable = RELEASE_DEPLOYMENT_READY && releaseSignerAllowed;
    const stagingExecutable = Boolean(
      stagingRequested
        && STAGING_DEPLOYMENT_CONFIGURED
        && staging.configured
        && isAllowlistedStagingWallet(account, staging)
        && stagingSignerAllowed,
    );
    const executionMode = releaseExecutable
      ? "release" as const
      : stagingExecutable
        ? "allowlisted-staging" as const
        : "read-only" as const;
    let executable = Boolean(
      (releaseExecutable || stagingExecutable)
        && account !== ZERO_ADDRESS
        && recipient !== ZERO_ADDRESS,
    );
    let deploymentReason: string | undefined;
    if (ROUTER_VERSION < 2) deploymentReason = "Router v2 is required for signed multi-venue execution; the shared manifest still points to v1.";
    else if (stagingRequested && !STAGING_DEPLOYMENT_CONFIGURED) deploymentReason = "The explicit Router v2 staging deployment is incomplete or invalid.";
    else if (stagingRequested && !staging.configured) deploymentReason = staging.reason || "Allowlisted staging is not configured.";
    else if (stagingRequested && account !== ZERO_ADDRESS && !isAllowlistedStagingWallet(account, staging)) deploymentReason = "This wallet is not authorized for allowlisted staging execution.";
    else if (!RELEASE_DEPLOYMENT_READY && !stagingRequested) deploymentReason = "The Router v2 candidate has not passed and been promoted through the release gate.";
    else if (!signer.configured) deploymentReason = signer.reason || "The quote signer is not configured.";
    else if (stagingRequested && !stagingSignerAllowed) deploymentReason = signer.reason || (IS_MAINNET ? "Allowlisted mainnet execution requires the remote quote signer." : "The testnet-only staging signer is not explicitly enabled.");
    else if (!stagingRequested && !releaseSignerAllowed) deploymentReason = "Production execution requires authenticated remote signer custody.";
    else if (account === ZERO_ADDRESS || recipient === ZERO_ADDRESS) deploymentReason = "Connect a wallet and provide a recipient to request an executable signed quote.";

    const configuredRouter = PERM_ROUTER_ADDRESS;
    if (executable && configuredRouter && signer.address) {
      const onchainSigner = await ttlCached(`signer:${configuredRouter}`, 10_000, () => client.readContract({
        address: configuredRouter,
        abi: permRouterAbi,
        functionName: "quoteSigner",
      }));
      if (onchainSigner.toLowerCase() !== signer.address.toLowerCase()) {
        executable = false;
        deploymentReason = "The quote service key does not match the onchain authorized signer.";
      }
    }

    const quoteSignature = executable
      ? (await signPermQuote(domain, message)).signature
      : "0x";
    const requestFingerprint = keccak256(toHex(JSON.stringify({
      tokenIn: tokenIn.symbol,
      tokenOut: tokenOut.symbol,
      amountIn: amountIn.toString(),
      slippageBps,
      account,
      recipient,
      referrer,
      routingMode,
    })));

    const candidates = deduped.map(({ requote: _requote, conversionStep: _conversion, ...candidate }) => candidate);
    const selected = candidates.find((candidate) => candidate.routeId === selectedInternal.routeId) || candidates[0];
    const result: LiveQuote = {
      contractVersion: ROUTER_VERSION,
      chainId: PERM_CHAIN_ID,
      quoteId,
      quoteSignature,
      quotedAt,
      deadline,
      policyVersion: policy.version,
      platformFeeBps: policy.platformFeeBps,
      rebateShareBps: policy.rebateShareBps,
      account,
      recipient,
      referrer,
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn: amountIn.toString(),
      grossFee: grossFee.toString(),
      rebate: rebate.toString(),
      netFee: netFee.toString(),
      routedInput: routedInput.toString(),
      slippageBps,
      routingMode,
      blockNumber: block.number.toString(),
      requestFingerprint,
      executable,
      executionMode,
      nonRelease: executionMode === "allowlisted-staging",
      deploymentReason,
      selected,
      candidates,
    };
    return NextResponse.json(result, { headers: { "cache-control": "private, max-age=0, no-store" } });
  } catch (cause) {
    return error(safeServerError("quote", cause, "Quote service could not validate an executable route"), 503);
  }
}
