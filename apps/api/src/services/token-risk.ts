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
  PONS_TESTNET_CONTRACTS,
  PONS_V1_CONTRACTS,
  PONS_V2_CONTRACTS,
  RHC_CANONICAL_ASSETS,
  RHC_MAINNET_CHAIN_ID,
  RHC_TESTNET_CHAIN_ID,
  UNISWAP_V4_RHC,
  getRhcChainProfile,
  scanContent,
  type Decision,
  type ReasonCode,
  type TokenRiskCheckResult,
} from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";
import { fetchHolderMetrics } from "./holders.js";
import type { RhcRegistryService } from "./registry.js";
import { checkSequencerHealth } from "./sequencer.js";
import { scanContentWithRemoteUrl } from "./url-scanner.js";

const ERC20_INSPECT_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function owner() view returns (address)",
  "function getOwner() view returns (address)",
  "function admin() view returns (address)",
  "function paused() view returns (bool)",
  "function minter() view returns (address)",
  "function mintLocked() view returns (bool)",
  "function tokenURI() view returns (string)",
  "function uri() view returns (string)",
  "function curve() view returns (address)",
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
  // Testnet BondingCurve getters
  "function token() view returns (address)",
  "function factory() view returns (address)",
  "function realEthReserve() view returns (uint256)",
  "function virtualTokenReserve() view returns (uint256)",
  "function curveAllocation() view returns (uint256)",
  "function tokensSold() view returns (uint256)",
  "function tradeFeeBps() view returns (uint256)",
  "function launchTaxStartBps() view returns (uint256)",
]);

const PONS_V2_TOKEN_META_ABI = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
]);

const PONS_V2_HOOK_ABI = parseAbi([
  "function pendingFees(bytes32 poolId, address currency) view returns (uint256)",
]);

// Selectors: mint(address,uint256)=0x40c10f19, mint(uint256)=0xa0712d68, faucet()=0xde5f72fd
const MINT_SELECTORS_HEX = ["40c10f19", "a0712d68", "de5f72fd"];

const TESTNET_KNOWN_PONS_FACTORIES = new Set([
  PONS_TESTNET_CONTRACTS.launchRouter.toLowerCase(),
  PONS_TESTNET_CONTRACTS.factoryV2.toLowerCase(),
  PONS_TESTNET_CONTRACTS.factoryV1.toLowerCase(),
  PONS_TESTNET_CONTRACTS.curveDeployer.toLowerCase(),
]);

/**
 * Evaluates Robinhood Chain (Testnet 46630 or Mainnet 4663) token risk strictly by contract address (§6.3 Dev Brief).
 * Distinguishes:
 *   - `usdg`
 *   - `stock_token` (official registry live)
 *   - `pons_curve` (pons pre-graduation curve)
 *   - `pons_graduated_v4` (pons graduated into locked Uniswap v4 pool + meme hook)
 *   - `other` (with mint/owner/pause & ticker-twin impersonation checks)
 */
export async function evaluateTokenRiskRhc(params: {
  config: ZGuardAppConfig;
  client: PublicClient;
  registry: RhcRegistryService;
  chainId?: number;
  tokenAddress: string | null | undefined;
  recipientForSnipeTax?: string;
}): Promise<TokenRiskCheckResult> {
  const { config, client, registry, tokenAddress } = params;
  const chainId = params.chainId ?? config.activeChainId;
  const profile = getRhcChainProfile(chainId);

  if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress.trim())) {
    return {
      decision: "abstain",
      codes: ["T-UNKNOWN"],
      token: tokenAddress ?? null,
      kind: "other",
      holders: { count: null, top10Bps: null },
      liquidity: {
        venue: "unknown",
        locked: null,
        detail: { note: "Missing or invalid 20-byte token address" },
      },
      tax: { buyBps: null, sellBps: null, snipeTaxBps: null },
      authorities: { owner: null, mintable: null, pausable: null },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
    };
  }

  const addr = tokenAddress.trim() as Hex;
  const addrLower = addr.toLowerCase();

  await registry.ensureFresh();
  const canonicalTickerMap = registry.getCanonicalTickerMap(chainId);
  const seqPromise = checkSequencerHealth(config, client, chainId);
  const holdersPromise = fetchHolderMetrics({
    config,
    client,
    chainId,
    tokenAddress: addr,
  });

  // 1. Canonical USDG on active RHC chain (46630 Testnet or 4663 Mainnet) (§6.3.1)
  if (addrLower === profile.usdgAddress.toLowerCase()) {
    const [holders, oracle, sequencer] = await Promise.all([
      holdersPromise,
      registry.readOracleData(client, "USDG", profile.usdgAddress, chainId),
      seqPromise,
    ]);
    return {
      decision: "allow",
      codes: [],
      token: profile.usdgAddress,
      name: "Global Dollar",
      symbol: "USDG",
      decimals: 6,
      kind: "usdg",
      holders,
      liquidity: {
        venue: "canonical",
        locked: null,
        detail: {
          issuer: "Paxos (Global Dollar)",
          chainId,
          ...(chainId === RHC_MAINNET_CHAIN_ID
            ? { paxosSupplyControl: RHC_CANONICAL_ASSETS.USDG_SUPPLY_CONTROL }
            : { testnetDeployment: true }),
          eip3009Verified: true,
        },
      },
      tax: { buyBps: 0, sellBps: 0, snipeTaxBps: 0 },
      authorities: {
        owner:
          chainId === RHC_MAINNET_CHAIN_ID
            ? RHC_CANONICAL_ASSETS.USDG_SUPPLY_CONTROL
            : null,
        mintable: false,
        pausable: true,
      },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
      oracle,
      sequencer,
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
  const stockHit = registry.getStockTokenByAddress(addrLower, chainId);
  if (stockHit) {
    const [holders, oracle, sequencer] = await Promise.all([
      holdersPromise,
      registry.readOracleData(client, stockHit.symbol, stockHit.address, chainId),
      seqPromise,
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
          registry:
            chainId === RHC_MAINNET_CHAIN_ID
              ? "api.robinhood.com/rhj/assets"
              : "explorer.testnet.chain.robinhood.com (official BeaconProxy)",
          issuer: "Robinhood Assets (Jersey) Limited",
          chainId,
          erc8056ScaledUi: true,
        },
      },
      tax: { buyBps: 0, sellBps: 0, snipeTaxBps: 0 },
      authorities: {
        owner: null,
        mintable: false,
        pausable: null,
      },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
      oracle,
      sequencer,
      metadataScan: { decision: "allow", verdict: "clean_by_rules", codes: [] },
    };
  }

  // Canonical WETH on active RHC chain
  if (addrLower === profile.wethAddress.toLowerCase()) {
    const [holders, oracle, sequencer] = await Promise.all([
      holdersPromise,
      registry.readOracleData(client, "WETH", profile.wethAddress, chainId),
      seqPromise,
    ]);
    return {
      decision: "allow",
      codes: [],
      token: profile.wethAddress,
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: 18,
      kind: "other",
      holders,
      liquidity: {
        venue: "canonical",
        locked: null,
        detail: { canonicalWrappedNative: true, chainId },
      },
      tax: { buyBps: 0, sellBps: 0, snipeTaxBps: 0 },
      authorities: { owner: null, mintable: false, pausable: false },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
      oracle,
      sequencer,
      metadataScan: { decision: "allow", verdict: "clean_by_rules", codes: [] },
    };
  }

  // Verify bytecode exists on RHC chain
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
      liquidity: {
        venue: "unknown",
        locked: null,
        detail: { note: `EOA or undeployed address on RHC (${chainId})` },
      },
      tax: { buyBps: null, sellBps: null, snipeTaxBps: null },
      authorities: { owner: null, mintable: null, pausable: null },
      pons: { factory: null, graduated: null, sellableTokens: null, reserves: null },
    };
  }

  // Read standard ERC-20 metadata & curve/URI pointers concurrently
  const [
    name,
    symbol,
    decimals,
    ownerAddr,
    getOwnerAddr,
    adminAddr,
    pausedState,
    minterAddr,
    mintLockedState,
    tokenUriStr,
    uriStr,
    tokenCurveAddr,
    sequencer,
  ] = await Promise.all([
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "name" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "symbol" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "decimals" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "owner" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "getOwner" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "admin" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "paused" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "minter" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "mintLocked" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "tokenURI" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "uri" }).catch(() => null),
    client.readContract({ address: addr, abi: ERC20_INSPECT_ABI, functionName: "curve" }).catch(() => null),
    seqPromise,
  ]);

  const discoveredUri = tokenUriStr || uriStr || undefined;

  // 3A. Testnet 46630 pons / BondingCurve launches (`token.curve()` -> `curve.factory()` + `curve.graduated()`)
  if (
    chainId === RHC_TESTNET_CHAIN_ID &&
    tokenCurveAddr &&
    tokenCurveAddr !== "0x0000000000000000000000000000000000000000"
  ) {
    const curveHex = tokenCurveAddr as Hex;
    const [curveFactory, curveGraduated, curveTok] = await Promise.all([
      client.readContract({ address: curveHex, abi: PONS_V2_CURVE_ABI, functionName: "factory" }).catch(() => null),
      client.readContract({ address: curveHex, abi: PONS_V2_CURVE_ABI, functionName: "graduated" }).catch(() => null),
      client.readContract({ address: curveHex, abi: PONS_V2_CURVE_ABI, functionName: "token" }).catch(() => null),
    ]);

    const matchesToken = !curveTok || curveTok.toLowerCase() === addrLower;
    if (
      curveFactory &&
      curveGraduated !== null &&
      matchesToken &&
      (TESTNET_KNOWN_PONS_FACTORIES.has(curveFactory.toLowerCase()) || curveTok?.toLowerCase() === addrLower)
    ) {
      const holders = await holdersPromise;
      const { result: metadataScan } = await scanContentWithRemoteUrl(
        config,
        {
          name: name ?? undefined,
          symbol: symbol ?? undefined,
          url: discoveredUri,
          tokenAddress: addr,
        },
        canonicalTickerMap
      );

      const codes: ReasonCode[] = [];
      if (metadataScan.verdict === "findings") codes.push("C-FINDING");
      if (
        config.maxTop10HolderBps !== null &&
        holders.top10Bps !== null &&
        holders.top10Bps > config.maxTop10HolderBps
      ) {
        codes.push("T-HOLDER");
      }

      if (curveGraduated === true) {
        return {
          decision: codes.some((c) => c === "C-FINDING" || c === "T-HOLDER") ? "deny" : "allow",
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
              curve: curveHex,
              factory: curveFactory,
              chainId,
            },
          },
          tax: { buyBps: 100, sellBps: 100, snipeTaxBps: 0, feeBps: 100 },
          authorities: { owner: null, mintable: false, pausable: false },
          pons: {
            factory: curveFactory,
            stack: "v2",
            curve: curveHex,
            graduated: true,
            readyToGraduate: false,
            sellableTokens: "0",
            reserves: null,
          },
          sequencer,
          metadataScan,
        };
      }

      const [ethBal, curveTokBal, tradeFeeRaw] = await Promise.all([
        client.getBalance({ address: curveHex }).catch(() => 0n),
        client
          .readContract({
            address: addr,
            abi: ERC20_INSPECT_ABI,
            functionName: "balanceOf",
            args: [curveHex],
          })
          .catch(() => 0n),
        client
          .readContract({ address: curveHex, abi: PONS_V2_CURVE_ABI, functionName: "tradeFeeBps" })
          .catch(() => 100n),
      ]);

      const feeBps = Number(tradeFeeRaw);
      if (config.maxTaxBps !== null && feeBps > config.maxTaxBps) {
        codes.push("T-TAX");
      }

      return {
        decision: codes.some((c) => c === "C-FINDING" || c === "T-HOLDER" || c === "T-TAX")
          ? "deny"
          : "allow",
        codes,
        token: addr,
        name,
        symbol,
        decimals: decimals !== null ? Number(decimals) : 18,
        kind: "pons_curve",
        holders,
        liquidity: {
          venue: "pons_curve",
          locked: true,
          detail: {
            curve: curveHex,
            factory: curveFactory,
            chainId,
          },
        },
        tax: { buyBps: feeBps, sellBps: feeBps, snipeTaxBps: 0, feeBps },
        authorities: { owner: null, mintable: false, pausable: false },
        pons: {
          factory: curveFactory,
          stack: "v2",
          curve: curveHex,
          graduated: false,
          readyToGraduate: false,
          sellableTokens: curveTokBal.toString(),
          reserves: {
            quoteReserve: ethBal.toString(),
            tokenReserve: curveTokBal.toString(),
          },
        },
        sequencer,
        metadataScan,
      };
    }
  }

  // 3B. Mainnet 4663 pons V2 Factory (`getLaunchedToken(token)`) — §6.3.1, §6.3.4, §6.3.6, §7.3
  if (chainId === RHC_MAINNET_CHAIN_ID) {
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

        const decision: Decision = codes.some(
          (c) => c === "T-TAX" || c === "T-HOLDER" || c === "C-FINDING"
        )
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
            mintable: false,
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
          sequencer,
          metadataScan,
        };
      }

      const snipeRecipient = (
        params.recipientForSnipeTax && /^0x[0-9a-fA-F]{40}$/.test(params.recipientForSnipeTax)
          ? params.recipientForSnipeTax
          : "0x0000000000000000000000000000000000000001"
      ) as Hex;

      const curveAddr = v2Launch.curve as Hex;
      const [
        reserves,
        realQuoteReserve,
        gradThreshold,
        sellable,
        readyToGrad,
        feeBpsRaw,
        snipeBpsRaw,
      ] = await Promise.all([
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

      const progressBps =
        realQuoteReserve !== null && gradThreshold !== null && gradThreshold > 0n
          ? Number((realQuoteReserve * 10_000n) / gradThreshold)
          : 0;

      if (
        v2Launch.phase === 1 ||
        v2Launch.phase === 3 ||
        readyToGrad === true ||
        progressBps >= 9500
      ) {
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
          locked: true,
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
        sequencer,
        metadataScan,
      };
    }

    // 4. Mainnet pons V1 Factory (`TokenLaunched` indexed topic1 = token) (§7.3)
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
          sequencer,
          metadataScan,
        };
      }
    } catch {
      // Continue to generic `other` classification
    }
  }

  // 5. Generic `other` token on RHC (§6.3.1 & §6.3.5)
  const holders = await holdersPromise;
  const effectiveOwner =
    ownerAddr && ownerAddr !== "0x0000000000000000000000000000000000000000"
      ? ownerAddr
      : getOwnerAddr && getOwnerAddr !== "0x0000000000000000000000000000000000000000"
        ? getOwnerAddr
        : adminAddr && adminAddr !== "0x0000000000000000000000000000000000000000"
          ? adminAddr
          : null;

  const bytecodeLower = bytecode.toLowerCase();
  const hasMintOrFaucetSelector = MINT_SELECTORS_HEX.some((sel) => bytecodeLower.includes(sel));
  const hasLiveMinter =
    Boolean(minterAddr && minterAddr !== "0x0000000000000000000000000000000000000000") ||
    mintLockedState === false ||
    (hasMintOrFaucetSelector && (effectiveOwner !== null || bytecodeLower.includes("de5f72fd")));

  const { result: metadataScan } = await scanContentWithRemoteUrl(
    config,
    {
      name: name ?? undefined,
      symbol: symbol ?? undefined,
      url: discoveredUri,
      tokenAddress: addr,
    },
    canonicalTickerMap
  );

  const codes: ReasonCode[] = [];
  if (hasLiveMinter) {
    codes.push("T-MINT");
  }
  if (metadataScan.verdict === "findings") {
    codes.push("C-FINDING");
  }
  if (
    config.maxTop10HolderBps !== null &&
    holders.top10Bps !== null &&
    holders.top10Bps > config.maxTop10HolderBps
  ) {
    codes.push("T-HOLDER");
  }
  codes.push("T-LP");

  let decision: Decision = "allow";
  if (codes.includes("T-MINT") || codes.includes("C-FINDING") || codes.includes("T-HOLDER")) {
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
      detail: { note: `Not a canonical RHC asset or pons launch on chain ${chainId}` },
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
    sequencer,
    metadataScan,
  };
}
