import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiItem,
  type Hex,
  type PublicClient,
} from "viem";
import {
  KNOWN_RHC_CONTRACTS,
  PONS_V1_CONTRACTS,
  PONS_V2_CONTRACTS,
  RHC_CANONICAL_ASSETS,
  RHC_MAINNET_CHAIN_ID,
  UNISWAP_V4_RHC,
  scanContent,
  type Decision,
  type ReasonCode,
  type TokenRiskCheckResult,
} from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";
import type { RhcRegistryService } from "./registry.js";

const ERC20_INSPECT_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function owner() view returns (address)",
  "function getOwner() view returns (address)",
  "function paused() view returns (bool)",
  "function minter() view returns (address)",
]);

const PONS_V2_FACTORY_ABI = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "struct FeePolicy { address protocolFeeRecipient; uint16 protocolFeeShareBps; uint16 buybackBurnBps; uint16 hookFeeBps; uint16 maxInternalPriceImpactBps; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "function getLaunchFeePolicy(address token) view returns (FeePolicy)",
  "function canLaunch(address caller) view returns (bool)",
]);

const PONS_V2_CURVE_ABI = parseAbi([
  "function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)",
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function sellableTokens() view returns (uint256)",
  "function readyToGraduate() view returns (bool)",
  "function graduated() view returns (bool)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function currentSnipeTaxBps(address recipient) view returns (uint256)",
]);

const PONS_V2_TOKEN_META_ABI = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);

const PONS_V2_HOOK_ABI = parseAbi([
  "function pendingFees(bytes32 poolId, address currency) view returns (uint256)",
  "function pendingCreatorTax(bytes32 poolId, address currency) view returns (uint256)",
]);

// Selector for mint(address,uint256): 0x40c10f19, mint(uint256): 0xa0712d68
const MINT_SELECTORS_HEX = ["40c10f19", "a0712d68"];

async function fetchHolderMetricsIfConfigured(
  config: ZGuardAppConfig,
  tokenAddress: string
): Promise<{ count: number | null; top10Bps: number | null; source?: string }> {
  if (!config.holderIndexerUrl) {
    // §6.3.2: Never invent holder counts if no indexer is configured!
    return { count: null, top10Bps: null, source: "unconfigured [PERLU CEK]" };
  }
  try {
    const url = `${config.holderIndexerUrl.replace(/\/+$/, "")}/${tokenAddress}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!resp.ok) return { count: null, top10Bps: null, source: "indexer_error" };
    const data = (await resp.json()) as { count?: number; top10Bps?: number };
    return {
      count: typeof data.count === "number" ? data.count : null,
      top10Bps: typeof data.top10Bps === "number" ? data.top10Bps : null,
      source: "configured_indexer",
    };
  } catch {
    return { count: null, top10Bps: null, source: "indexer_unreachable" };
  }
}

/**
 * Evaluates Robinhood Chain (4663) token risk strictly by contract address (§6.3 Dev Brief).
 * Distinguishes:
 *   - `usdg`
 *   - `stock_token` (official registry live)
 *   - `pons_curve` (pons V2 pre-graduation curve or V1 launch)
 *   - `pons_graduated_v4` (pons V2 graduated into permanently locked Uniswap v4 pool + meme hook)
 *   - `other` (with mint/owner/pause & ticker-twin impersonation checks)
 */
export async function evaluateTokenRiskRhc(params: {
  config: ZGuardAppConfig;
  client: PublicClient;
  registry: RhcRegistryService;
  tokenAddress: string | null | undefined;
  recipientForSnipeTax?: string;
}): Promise<TokenRiskCheckResult> {
  const { config, client, registry, tokenAddress } = params;

  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress.trim())) {
    return {
      decision: "abstain",
      codes: ["T-UNKNOWN"],
      token: tokenAddress ?? null,
      kind: "other",
      holders: { count: null, top10Bps: null },
      liquidity: { venue: "unknown", locked: null, detail: { note: "Missing or invalid 20-byte token address" } },
      tax: { buyBps: null, sellBps: null, snipeTaxBps: null },
      authorities: { owner: null, mintable: null, pausable: null },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
    };
  }

  const addr = tokenAddress.trim() as Hex;
  const addrLower = addr.toLowerCase();

  await registry.ensureFresh();
  const canonicalTickerMap = registry.getCanonicalTickerMap();
  const holdersPromise = fetchHolderMetricsIfConfigured(config, addr);

  // 1. Canonical USDG (§6.3.1)
  if (addrLower === RHC_CANONICAL_ASSETS.USDG.address.toLowerCase()) {
    const [holders, oracle] = await Promise.all([
      holdersPromise,
      registry.readOracleData(client, "USDG"),
    ]);
    return {
      decision: "allow",
      codes: [],
      token: RHC_CANONICAL_ASSETS.USDG.address,
      name: RHC_CANONICAL_ASSETS.USDG.name,
      symbol: RHC_CANONICAL_ASSETS.USDG.symbol,
      decimals: RHC_CANONICAL_ASSETS.USDG.decimals,
      kind: "usdg",
      holders,
      liquidity: {
        venue: "canonical",
        locked: null,
        detail: {
          issuer: "Paxos (Global Dollar)",
          paxosSupplyControl: RHC_CANONICAL_ASSETS.USDG_SUPPLY_CONTROL,
          eip3009Verified: true,
        },
      },
      tax: { buyBps: 0, sellBps: 0, snipeTaxBps: 0 },
      authorities: {
        owner: RHC_CANONICAL_ASSETS.USDG_SUPPLY_CONTROL,
        mintable: false,
        pausable: true,
      },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
      oracle,
      metadataScan: { decision: "allow", verdict: "clean_by_rules", codes: [] },
    };
  }

  // Protocol singleton contracts (PoolManager, factories, hooks) are not ERC-20 tokens -> abstain T-UNKNOWN
  const knownProto = KNOWN_RHC_CONTRACTS[addrLower];
  if (knownProto && knownProto.category !== "canonical_asset") {
    return {
      decision: "abstain",
      codes: ["T-UNKNOWN"],
      token: addr,
      name: knownProto.label,
      symbol: null,
      decimals: null,
      kind: "other",
      holders: { count: null, top10Bps: null },
      liquidity: {
        venue: "unknown",
        locked: null,
        detail: { protocolContract: knownProto.label, category: knownProto.category },
      },
      tax: { buyBps: null, sellBps: null, snipeTaxBps: null },
      authorities: { owner: null, mintable: null, pausable: null },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
    };
  }

  // 2. Official Robinhood Stock Token Registry (§6.3.1 & §7.2)
  const stockHit = registry.getStockTokenByAddress(addrLower);
  if (stockHit) {
    const [holders, oracle] = await Promise.all([
      holdersPromise,
      registry.readOracleData(client, stockHit.symbol, stockHit.address),
    ]);
    return {
      decision: "allow",
      codes: [],
      token: stockHit.address,
      name: stockHit.name,
      symbol: stockHit.symbol,
      decimals: 18,
      kind: "stock_token",
      holders,
      liquidity: {
        venue: "canonical",
        locked: null,
        detail: {
          registry: "docs.robinhood.com/chain/contracts",
          issuer: "Robinhood Assets (Jersey) Limited",
          erc8056ScaledUi: true,
        },
      },
      tax: { buyBps: 0, sellBps: 0, snipeTaxBps: 0 },
      authorities: {
        owner: null,
        mintable: false, // Official allowlist per §6.3.5
        pausable: null,
      },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
      oracle,
      metadataScan: { decision: "allow", verdict: "clean_by_rules", codes: [] },
    };
  }

  // Canonical WETH on RHC 4663
  if (addrLower === RHC_CANONICAL_ASSETS.WETH.address.toLowerCase()) {
    const [holders, oracle] = await Promise.all([
      holdersPromise,
      registry.readOracleData(client, "WETH"),
    ]);
    return {
      decision: "allow",
      codes: [],
      token: RHC_CANONICAL_ASSETS.WETH.address,
      name: RHC_CANONICAL_ASSETS.WETH.name,
      symbol: RHC_CANONICAL_ASSETS.WETH.symbol,
      decimals: 18,
      kind: "other",
      holders,
      liquidity: {
        venue: "canonical",
        locked: null,
        detail: { canonicalWrappedNative: true, chainId: RHC_MAINNET_CHAIN_ID },
      },
      tax: { buyBps: 0, sellBps: 0, snipeTaxBps: 0 },
      authorities: { owner: null, mintable: false, pausable: false },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
      oracle,
      metadataScan: { decision: "allow", verdict: "clean_by_rules", codes: [] },
    };
  }

  // Verify bytecode exists on RHC 4663
  let bytecode: Hex | undefined;
  try {
    bytecode = await client.getCode({ address: addr });
  } catch {
    return {
      decision: "abstain",
      codes: ["T-UNKNOWN"],
      token: addr,
      kind: "other",
      holders: { count: null, top10Bps: null },
      liquidity: { venue: "unknown", locked: null, detail: { error: "RPC getCode failed" } },
      tax: { buyBps: null, sellBps: null, snipeTaxBps: null },
      authorities: { owner: null, mintable: null, pausable: null },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
    };
  }

  if (!bytecode || bytecode === "0x") {
    return {
      decision: "abstain",
      codes: ["T-UNKNOWN"],
      token: addr,
      kind: "other",
      holders: { count: null, top10Bps: null },
      liquidity: { venue: "unknown", locked: null, detail: { note: "EOA or undeployed address on RHC 4663" } },
      tax: { buyBps: null, sellBps: null, snipeTaxBps: null },
      authorities: { owner: null, mintable: null, pausable: null },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
    };
  }

  // Read standard ERC-20 metadata
  const [name, symbol, decimals, ownerAddr, getOwnerAddr, pausedState, minterAddr] =
    await Promise.all([
      client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "name" }).catch(() => null),
      client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "symbol" }).catch(() => null),
      client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "decimals" }).catch(() => null),
      client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "owner" }).catch(() => null),
      client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "getOwner" }).catch(() => null),
      client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "paused" }).catch(() => null),
      client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "minter" }).catch(() => null),
    ]);

  // 3. Check pons V2 Factory (`getLaunchedToken(token)`) — §6.3.1, §6.3.4, §6.3.6, §7.3
  const v2Launch = await client
    .readContract({
      address: PONS_V2_CONTRACTS.factory,
      abi: PONS_V2_FACTORY_ABI,
      functionName: "getLaunchedToken",
      args: [addr],
    })
    .catch(() => null);

  if (v2Launch && v2Launch.exists) {
    const holders = await holdersPromise;
    const codes: ReasonCode[] = [];

    // Read pons V2 creator metadata (description + socials) for content scanner (§6.3.7)
    const tokenInfo = await client
      .readContract({
        address: addr,
        abi: PONS_V2_TOKEN_META_ABI,
        functionName: "getTokenInfo",
      })
      .catch(() => null);

    const descriptionText = tokenInfo
      ? [
          tokenInfo[2],
          tokenInfo[3]?.website,
          tokenInfo[3]?.twitter,
          tokenInfo[3]?.telegram,
        ]
          .filter(Boolean)
          .join(" ")
      : undefined;

    const metadataScan = scanContent(
      {
        name: name ?? undefined,
        symbol: symbol ?? undefined,
        text: descriptionText,
        tokenAddress: addr,
      },
      canonicalTickerMap
    );

    if (metadataScan.verdict === "findings") {
      codes.push("C-FINDING");
    }

    const policy = await client
      .readContract({
        address: PONS_V2_CONTRACTS.factory,
        abi: PONS_V2_FACTORY_ABI,
        functionName: "getLaunchFeePolicy",
        args: [addr],
      })
      .catch(() => null);

    // Phase 2 = PoolCreated -> `pons_graduated_v4` (Uniswap v4 pool + pons V2 meme hook, LP permanently locked)
    if (v2Launch.phase === 2) {
      const [currency0, currency1] =
        v2Launch.pairToken.toLowerCase() < addrLower
          ? [v2Launch.pairToken as Hex, addr]
          : [addr, v2Launch.pairToken as Hex];

      const poolId = keccak256(
        encodeAbiParameters(
          [
            { type: "address" },
            { type: "address" },
            { type: "uint24" },
            { type: "int24" },
            { type: "address" },
          ],
          [
            currency0,
            currency1,
            v2Launch.poolFee,
            v2Launch.tickSpacing,
            PONS_V2_CONTRACTS.memeHook,
          ]
        )
      );

      const pendingQuoteFees = await client
        .readContract({
          address: PONS_V2_CONTRACTS.memeHook,
          abi: PONS_V2_HOOK_ABI,
          functionName: "pendingFees",
          args: [poolId, v2Launch.pairToken as Hex],
        })
        .catch(() => null);

      const hookFeeBps = policy ? Number(policy.hookFeeBps) : 100;
      const creatorTaxBps = Number(v2Launch.creatorTaxBps);
      const totalSwapTaxBps = hookFeeBps + creatorTaxBps;

      if (config.maxTaxBps !== null && totalSwapTaxBps > config.maxTaxBps) {
        codes.push("T-TAX");
      }
      if (
        config.maxTop10HolderBps !== null &&
        holders.top10Bps !== null &&
        holders.top10Bps > config.maxTop10HolderBps
      ) {
        codes.push("T-HOLDER");
      }

      const decision: Decision = codes.some((c) => c === "T-TAX" || c === "T-HOLDER" || c === "C-FINDING")
        ? "deny"
        : "allow";

      return {
        decision,
        codes,
        token: addr,
        name,
        symbol,
        decimals: decimals !== null ? Number(decimals) : 18,
        kind: "pons_graduated_v4",
        holders,
        liquidity: {
          venue: "uniswap_v4",
          locked: true,
          detail: {
            poolManager: UNISWAP_V4_RHC.poolManager,
            poolId,
            hook: PONS_V2_CONTRACTS.memeHook,
            locker: PONS_V2_CONTRACTS.launchLocker,
            pairToken: v2Launch.pairToken,
            poolFee: v2Launch.poolFee,
            tickSpacing: v2Launch.tickSpacing,
            pendingQuoteFees: pendingQuoteFees?.toString() ?? null,
          },
        },
        tax: {
          buyBps: totalSwapTaxBps,
          sellBps: totalSwapTaxBps,
          snipeTaxBps: 0,
          feeBps: hookFeeBps,
          creatorTaxBps,
        },
        authorities: {
          owner: null,
          mintable: false, // Fixed supply minted 100% at launch on pons V2
          pausable: false,
        },
        pons: {
          factory: PONS_V2_CONTRACTS.factory,
          stack: "v2",
          curve: v2Launch.curve,
          pairToken: v2Launch.pairToken,
          phase: v2Launch.phase,
          graduated: true,
          readyToGraduate: false,
          sellableTokens: "0",
          reserves: null,
        },
        metadataScan,
      };
    }

    // Phase 0 (NotGraduated), Phase 1 (Swept), Phase 3 (Rescued) -> `pons_curve`
    const snipeRecipient = (
      params.recipientForSnipeTax && /^0x[0-9a-fA-F]{40}$/.test(params.recipientForSnipeTax)
        ? params.recipientForSnipeTax
        : "0x0000000000000000000000000000000000000001"
    ) as Hex;

    const curveAddr = v2Launch.curve as Hex;
    const [reserves, realQuoteReserve, gradThreshold, sellable, readyToGrad, feeBpsRaw, snipeBpsRaw] =
      await Promise.all([
        client.readContract({ address: curveAddr, abi: PONS_V2_CURVE_ABI, functionName: "getReserves" }).catch(() => null),
        client.readContract({ address: curveAddr, abi: PONS_V2_CURVE_ABI, functionName: "realQuoteReserve" }).catch(() => null),
        client.readContract({ address: curveAddr, abi: PONS_V2_CURVE_ABI, functionName: "graduationThreshold" }).catch(() => null),
        client.readContract({ address: curveAddr, abi: PONS_V2_CURVE_ABI, functionName: "sellableTokens" }).catch(() => null),
        client.readContract({ address: curveAddr, abi: PONS_V2_CURVE_ABI, functionName: "readyToGraduate" }).catch(() => null),
        client.readContract({ address: curveAddr, abi: PONS_V2_CURVE_ABI, functionName: "feeBps" }).catch(() => 100n),
        client
          .readContract({
            address: curveAddr,
            abi: PONS_V2_CURVE_ABI,
            functionName: "currentSnipeTaxBps",
            args: [snipeRecipient],
          })
          .catch(() => 0n),
      ]);

    const feeBps = Number(feeBpsRaw);
    const creatorTaxBps = Number(v2Launch.creatorTaxBps);
    const snipeTaxBps = Number(snipeBpsRaw);
    const totalBuyBps = feeBps + creatorTaxBps + snipeTaxBps;
    const totalSellBps = feeBps + creatorTaxBps;

    // Near graduation / swept / rescued check -> T-PONS (§5.3 & §6.3.6)
    const progressBps =
      realQuoteReserve !== null && gradThreshold !== null && gradThreshold > 0n
        ? Number((realQuoteReserve * 10_000n) / gradThreshold)
        : 0;

    if (v2Launch.phase === 1 || v2Launch.phase === 3 || readyToGrad === true || progressBps >= 9500) {
      codes.push("T-PONS");
    }
    if (config.maxTaxBps !== null && totalBuyBps > config.maxTaxBps) {
      codes.push("T-TAX");
    }
    if (config.maxSnipeTaxBps !== null && snipeTaxBps > config.maxSnipeTaxBps) {
      codes.push("T-TAX");
    }
    if (
      config.maxTop10HolderBps !== null &&
      holders.top10Bps !== null &&
      holders.top10Bps > config.maxTop10HolderBps
    ) {
      codes.push("T-HOLDER");
    }

    const shouldDeny =
      v2Launch.phase === 3 ||
      codes.includes("T-TAX") ||
      codes.includes("T-HOLDER") ||
      codes.includes("C-FINDING");

    return {
      decision: shouldDeny ? "deny" : "allow",
      codes: Array.from(new Set(codes)),
      token: addr,
      name,
      symbol,
      decimals: decimals !== null ? Number(decimals) : 18,
      kind: "pons_curve",
      holders,
      liquidity: {
        venue: "pons_curve",
        locked: true, // Curve holds 100% of unsold & pool-reserved supply until permanent graduation lock
        detail: {
          curve: curveAddr,
          pairToken: v2Launch.pairToken,
          graduationProgressBps: progressBps,
          buybackEnabled: v2Launch.buybackEnabled,
        },
      },
      tax: {
        buyBps: totalBuyBps,
        sellBps: totalSellBps,
        snipeTaxBps,
        feeBps,
        creatorTaxBps,
      },
      authorities: {
        owner: null,
        mintable: false,
        pausable: false,
      },
      pons: {
        factory: PONS_V2_CONTRACTS.factory,
        stack: "v2",
        curve: curveAddr,
        pairToken: v2Launch.pairToken,
        phase: v2Launch.phase,
        graduated: false,
        readyToGraduate: Boolean(readyToGrad),
        sellableTokens: sellable?.toString() ?? null,
        reserves: reserves
          ? {
              quoteReserve: reserves[0].toString(),
              tokenReserve: reserves[1].toString(),
              realQuoteReserve: realQuoteReserve?.toString(),
              graduationThreshold: gradThreshold?.toString(),
            }
          : null,
      },
      metadataScan,
    };
  }

  // 4. Check pons V1 Factory (`TokenLaunched` indexed topic1 = token) for legacy pons launches (§7.3)
  try {
    const v1Logs = await client.getLogs({
      address: PONS_V1_CONTRACTS.factory,
      event: parseAbiItem(
        "event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchCounter)"
      ),
      args: { token: addr },
      fromBlock: 8_991_118n,
      toBlock: "latest",
    });
    if (v1Logs.length > 0) {
      const holders = await holdersPromise;
      const launchLog = v1Logs[0];
      const metadataScan = scanContent(
        { name: name ?? undefined, symbol: symbol ?? undefined, tokenAddress: addr },
        canonicalTickerMap
      );
      const codes: ReasonCode[] = metadataScan.verdict === "findings" ? ["C-FINDING"] : [];
      return {
        decision: codes.length > 0 ? "deny" : "allow",
        codes,
        token: addr,
        name,
        symbol,
        decimals: decimals !== null ? Number(decimals) : 18,
        kind: "pons_curve",
        holders,
        liquidity: {
          venue: "pons_v1_v3",
          locked: true,
          detail: {
            pool: launchLog.args.pool,
            pairToken: launchLog.args.pairToken,
            locker: PONS_V1_CONTRACTS.liquidityLocker,
          },
        },
        tax: { buyBps: 100, sellBps: 100, snipeTaxBps: 0 },
        authorities: { owner: null, mintable: false, pausable: false },
        pons: {
          factory: PONS_V1_CONTRACTS.factory,
          stack: "v1",
          pairToken: launchLog.args.pairToken ?? null,
          graduated: null,
          sellableTokens: null,
          reserves: null,
        },
        metadataScan,
      };
    }
  } catch {
    // Continue to generic `other` classification if log range query is throttled
  }

  // 5. Generic `other` token on RHC 4663 (§6.3.1 & §6.3.5)
  const holders = await holdersPromise;
  const effectiveOwner =
    ownerAddr && ownerAddr !== "0x0000000000000000000000000000000000000000"
      ? ownerAddr
      : getOwnerAddr && getOwnerAddr !== "0x0000000000000000000000000000000000000000"
        ? getOwnerAddr
        : null;

  const bytecodeLower = bytecode.toLowerCase();
  const hasMintSelector = MINT_SELECTORS_HEX.some((sel) => bytecodeLower.includes(sel));
  const hasLiveMinter =
    Boolean(minterAddr && minterAddr !== "0x0000000000000000000000000000000000000000") ||
    (hasMintSelector && effectiveOwner !== null);

  const metadataScan = scanContent(
    {
      name: name ?? undefined,
      symbol: symbol ?? undefined,
      tokenAddress: addr,
    },
    canonicalTickerMap
  );

  const codes: ReasonCode[] = [];
  if (hasLiveMinter) {
    // §6.3.5 & §10: Open mint authority on kind=other -> T-MINT deny!
    codes.push("T-MINT");
  }
  if (metadataScan.verdict === "findings") {
    // Catches ticker-twin fake Stock Tokens (e.g. symbol="AAPL" at non-registry address)!
    codes.push("C-FINDING");
  }
  codes.push("T-LP");

  let decision: Decision = "allow";
  if (codes.includes("T-MINT") || codes.includes("C-FINDING")) {
    decision = "deny";
  } else if (name === null && symbol === null) {
    codes.push("T-UNKNOWN");
    decision = "abstain";
  }

  return {
    decision,
    codes: Array.from(new Set(codes)),
    token: addr,
    name,
    symbol,
    decimals: decimals !== null ? Number(decimals) : null,
    kind: "other",
    holders,
    liquidity: {
      venue: "unknown",
      locked: null,
      detail: { note: "Not a canonical RHC asset or pons V1/V2 launch" },
    },
    tax: { buyBps: null, sellBps: null, snipeTaxBps: null },
    authorities: {
      owner: effectiveOwner,
      mintable: hasLiveMinter,
      pausable: pausedState !== null ? true : null,
    },
    pons: {
      factory: null,
      stack: null,
      graduated: null,
      sellableTokens: null,
      reserves: null,
    },
    metadataScan,
  };
}
