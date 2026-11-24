import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_PUBLIC_RPC_MAINNET,
  BASE_PUBLIC_RPC_SEPOLIA,
  DEAD_BURN_ADDRESS,
  DEFAULT_ACTIVE_RHC_CHAIN_ID,
  RHC_MAINNET_CHAIN_ID,
  RHC_PUBLIC_RPC_MAINNET,
  RHC_PUBLIC_RPC_TESTNET,
  RHC_TESTNET_CHAIN_ID,
  SOLANA_PUBLIC_RPC_DEVNET,
  SOLANA_PUBLIC_RPC_MAINNET,
  type CheckMode,
  type CheckName,
  type ZkSystemId,
} from "@zguard/sdk";

let dotenvLoaded = false;

export function loadWorkspaceEnvFiles(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, "../.env.local"),
    path.resolve(currentDir, "../.env"),
    path.resolve(currentDir, "../../../.env.local"),
    path.resolve(currentDir, "../../../.env"),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

export interface ZGuardAppConfig {
  productName: string;
  port: number;
  host: string;
  publicApiUrl: string;
  apiKeyPrefix: string;

  /**
   * Active default Robinhood Chain ID:
   * - `46630` = Robinhood Chain Testnet (default for pre-production / senior demo without real fees)
   * - `4663`  = Robinhood Chain Mainnet (flip ZGUARD_ACTIVE_CHAIN_ID=4663 when ready for production)
   */
  activeChainId: 46630 | 4663;

  databaseUrl: string;
  storageMode: "auto" | "neon";

  rhcRpcUrl: string;
  rhcFallbackRpcUrl: string;
  rhcMainnetRpcUrl: string;
  rhcMainnetFallbackRpcUrl: string;
  rhcTestnetRpcUrl: string;
  rhcTestnetFallbackRpcUrl: string;
  simulationMethod: "auto" | "eth_simulateV1" | "debug_traceCall";

  baseRpcUrl: string;
  baseSepoliaRpcUrl: string;
  solanaRpcUrl: string;
  solanaDevnetRpcUrl: string;

  stockRegistryUrl: string;
  chainlinkFeedsUrl: string;
  registryRefreshSeconds: number;

  sequencerUptimeFeedAddress: string | null;
  sequencerGracePeriodSeconds: number;
  sequencerMaxBlockAgeSeconds: number;

  x402PayTo: string;
  x402SolanaPayTo: string | null;
  x402RelayerPrivateKey: string | null;
  x402SettlementMode: "auto" | "onchain" | "offchain";
  pricesMicroUsdg: {
    verify: bigint;
    simulate: bigint;
    tokenRisk: bigint;
    check: bigint;
    guard: bigint;
  };
  devFreeCreditMicroUsdg: bigint;
  enableUsdcBase: boolean;
  enableUsdcSolana: boolean;

  enableUrlFetch: boolean;
  urlFetchTimeoutMs: number;
  urlFetchMaxBytes: number;

  tokenTicker: string;
  ponsTokenAddress: string | null;
  buybackWallet: string | null;
  burnAddress: string;
  buybackRevenueBps: number;

  checkModes: Record<CheckName, CheckMode>;
  allowTtlSeconds: number;
  allowAbstainOverride: boolean;

  maxTaxBps: number | null;
  maxTop10HolderBps: number | null;
  maxSnipeTaxBps: number | null;
  holderIndexerUrl: string | null;

  zkEnabled: boolean;
  zkSystem: ZkSystemId;
  zkHalo2Enabled: boolean;
  zkSp1ProverUrl: string | null;
  zkVerifierAddress: string | null;
  zkVerifierPrivateKey: string | null;
  zkBatchSize: number;
}

function parseOptionalInt(raw?: string): number | null {
  if (!raw || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ZGuardAppConfig {
  if (env === process.env) {
    loadWorkspaceEnvFiles();
  }

  const parsedChain = Number(env.ZGUARD_ACTIVE_CHAIN_ID ?? DEFAULT_ACTIVE_RHC_CHAIN_ID);
  const activeChainId: 46630 | 4663 =
    parsedChain === RHC_MAINNET_CHAIN_ID ? RHC_MAINNET_CHAIN_ID : RHC_TESTNET_CHAIN_ID;

  const rhcTestnetRpcUrl = env.ZGUARD_RHC_TESTNET_RPC_URL || RHC_PUBLIC_RPC_TESTNET;
  const rhcTestnetFallbackRpcUrl =
    env.ZGUARD_RHC_TESTNET_FALLBACK_RPC_URL || RHC_PUBLIC_RPC_TESTNET;
  const rhcMainnetRpcUrl = env.ZGUARD_RHC_MAINNET_RPC_URL || RHC_PUBLIC_RPC_MAINNET;
  const rhcMainnetFallbackRpcUrl =
    env.ZGUARD_RHC_MAINNET_FALLBACK_RPC_URL || RHC_PUBLIC_RPC_MAINNET;

  // `rhcRpcUrl` points to whichever chain is currently active, unless explicitly overridden by ZGUARD_RHC_RPC_URL
  const defaultActiveRpc =
    activeChainId === RHC_MAINNET_CHAIN_ID ? rhcMainnetRpcUrl : rhcTestnetRpcUrl;
  const defaultActiveFallback =
    activeChainId === RHC_MAINNET_CHAIN_ID
      ? rhcMainnetFallbackRpcUrl
      : rhcTestnetFallbackRpcUrl;

  const requiredList = (env.ZGUARD_REQUIRED_CHECKS ?? "quote,simulation,token_risk")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const checkModes: Record<CheckName, CheckMode> = {
    quote: requiredList.includes("quote") ? "required" : "advisory",
    simulation: requiredList.includes("simulation") ? "required" : "advisory",
    token_risk: requiredList.includes("token_risk") ? "required" : "advisory",
    content: requiredList.includes("content") ? "required" : "advisory",
  };

  return {
    productName: env.ZGUARD_PRODUCT_NAME || "ZGuard",
    port: Number(env.ZGUARD_API_PORT || env.PORT || 8787),
    host: env.ZGUARD_API_HOST || "0.0.0.0",
    publicApiUrl: env.ZGUARD_PUBLIC_API_URL || "http://localhost:8787",
    apiKeyPrefix: env.ZGUARD_API_KEY_PREFIX || "zg_",

    activeChainId,

    databaseUrl: env.DATABASE_URL || "",
    storageMode: env.ZGUARD_STORAGE_MODE === "neon" ? "neon" : "auto",

    rhcRpcUrl: env.ZGUARD_RHC_RPC_URL || defaultActiveRpc,
    rhcFallbackRpcUrl: env.ZGUARD_RHC_FALLBACK_RPC_URL || defaultActiveFallback,
    rhcMainnetRpcUrl,
    rhcMainnetFallbackRpcUrl,
    rhcTestnetRpcUrl,
    rhcTestnetFallbackRpcUrl,
    simulationMethod:
      env.ZGUARD_SIMULATION_METHOD === "eth_simulateV1" ||
      env.ZGUARD_SIMULATION_METHOD === "debug_traceCall"
        ? env.ZGUARD_SIMULATION_METHOD
        : "auto",

    baseRpcUrl: env.ZGUARD_BASE_RPC_URL || BASE_PUBLIC_RPC_MAINNET,
    baseSepoliaRpcUrl: env.ZGUARD_BASE_SEPOLIA_RPC_URL || BASE_PUBLIC_RPC_SEPOLIA,
    solanaRpcUrl: env.ZGUARD_SOLANA_RPC_URL || SOLANA_PUBLIC_RPC_MAINNET,
    solanaDevnetRpcUrl: env.ZGUARD_SOLANA_DEVNET_RPC_URL || SOLANA_PUBLIC_RPC_DEVNET,

    stockRegistryUrl:
      env.ZGUARD_STOCK_REGISTRY_URL || "https://api.robinhood.com/rhj/assets",
    chainlinkFeedsUrl:
      env.ZGUARD_CHAINLINK_FEEDS_URL ||
      "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json",
    registryRefreshSeconds: Number(env.ZGUARD_REGISTRY_REFRESH_SECONDS || 900),

    sequencerUptimeFeedAddress: env.ZGUARD_SEQUENCER_UPTIME_FEED || null,
    sequencerGracePeriodSeconds: Number(env.ZGUARD_SEQUENCER_GRACE_PERIOD_SECONDS || 3600),
    sequencerMaxBlockAgeSeconds: Number(env.ZGUARD_SEQUENCER_MAX_BLOCK_AGE_SECONDS || 900),

    x402PayTo:
      env.ZGUARD_X402_PAY_TO ||
      env.ZGUARD_BUYBACK_WALLET ||
      "0x0000000000000000000000000000000000004663",
    x402SolanaPayTo: env.ZGUARD_X402_SOLANA_PAY_TO || null,
    x402RelayerPrivateKey: env.ZGUARD_X402_RELAYER_PRIVATE_KEY || null,
    x402SettlementMode:
      env.ZGUARD_X402_SETTLEMENT_MODE === "onchain" ||
      env.ZGUARD_X402_SETTLEMENT_MODE === "offchain"
        ? env.ZGUARD_X402_SETTLEMENT_MODE
        : "auto",
    pricesMicroUsdg: {
      verify: BigInt(env.ZGUARD_PRICE_VERIFY_MICRO_USDG ?? "3000"),
      simulate: BigInt(env.ZGUARD_PRICE_SIMULATE_MICRO_USDG ?? "5000"),
      tokenRisk: BigInt(env.ZGUARD_PRICE_TOKEN_RISK_MICRO_USDG ?? "10000"),
      check: BigInt(env.ZGUARD_PRICE_CHECK_MICRO_USDG ?? "5000"),
      guard: BigInt(env.ZGUARD_PRICE_GUARD_MICRO_USDG ?? "15000"),
    },
    devFreeCreditMicroUsdg: BigInt(
      env.ZGUARD_DEV_FREE_CREDIT_MICRO_USDG ??
        (env.NODE_ENV === "production" ? "0" : "90000")
    ),
    enableUsdcBase: env.ZGUARD_ENABLE_USDC_BASE === "true",
    enableUsdcSolana: env.ZGUARD_ENABLE_USDC_SOLANA === "true",

    enableUrlFetch: env.ZGUARD_ENABLE_URL_FETCH !== "false",
    urlFetchTimeoutMs: Number(env.ZGUARD_URL_FETCH_TIMEOUT_MS ?? 4000),
    urlFetchMaxBytes: Number(env.ZGUARD_URL_FETCH_MAX_BYTES ?? 131_072),

    tokenTicker: env.ZGUARD_TOKEN_TICKER || "$ZGUARD",
    ponsTokenAddress: env.ZGUARD_PONS_TOKEN_ADDRESS || null,
    buybackWallet: env.ZGUARD_BUYBACK_WALLET || null,
    burnAddress: env.ZGUARD_BURN_ADDRESS || DEAD_BURN_ADDRESS,
    buybackRevenueBps: Number(env.ZGUARD_BUYBACK_REVENUE_BPS ?? 10000),

    checkModes,
    allowTtlSeconds: Number(env.ZGUARD_ALLOW_TTL_SECONDS ?? 120),
    allowAbstainOverride: env.ZGUARD_ALLOW_ABSTAIN_OVERRIDE === "true",

    maxTaxBps: parseOptionalInt(env.ZGUARD_MAX_TAX_BPS),
    maxTop10HolderBps: parseOptionalInt(env.ZGUARD_MAX_TOP10_HOLDER_BPS),
    maxSnipeTaxBps: parseOptionalInt(env.ZGUARD_MAX_SNIPE_TAX_BPS),
    holderIndexerUrl: env.ZGUARD_HOLDER_INDEXER_URL || null,

    zkEnabled: env.ZGUARD_ZK_ENABLED !== "false",
    zkSystem:
      env.ZGUARD_ZK_SYSTEM === "groth16-risc0" || env.ZGUARD_ZK_SYSTEM === "halo2-kzg"
        ? env.ZGUARD_ZK_SYSTEM
        : "groth16-sp1",
    zkHalo2Enabled: env.ZGUARD_ZK_HALO2_ENABLED !== "false",
    zkSp1ProverUrl: env.ZGUARD_ZK_SP1_PROVER_URL || null,
    zkVerifierAddress: env.ZGUARD_ZK_VERIFIER_ADDRESS || null,
    zkVerifierPrivateKey:
      env.ZGUARD_ZK_VERIFIER_PRIVATE_KEY || env.ZGUARD_DEPLOYER_PRIVATE_KEY || null,
    zkBatchSize: Number(env.ZGUARD_ZK_BATCH_SIZE ?? 10),
  };
}
