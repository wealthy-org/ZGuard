import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEAD_BURN_ADDRESS,
  RHC_PUBLIC_RPC_MAINNET,
  RHC_PUBLIC_RPC_TESTNET,
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

  databaseUrl: string;
  storageMode: "auto" | "neon";

  rhcRpcUrl: string;
  rhcFallbackRpcUrl: string;
  rhcTestnetRpcUrl: string;
  simulationMethod: "auto" | "eth_simulateV1" | "debug_traceCall";

  stockRegistryUrl: string;
  chainlinkFeedsUrl: string;
  registryRefreshSeconds: number;

  x402PayTo: string;
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

    databaseUrl: env.DATABASE_URL || "",
    storageMode: env.ZGUARD_STORAGE_MODE === "neon" ? "neon" : "auto",

    rhcRpcUrl: env.ZGUARD_RHC_RPC_URL || RHC_PUBLIC_RPC_MAINNET,
    rhcFallbackRpcUrl: env.ZGUARD_RHC_FALLBACK_RPC_URL || RHC_PUBLIC_RPC_MAINNET,
    rhcTestnetRpcUrl: env.ZGUARD_RHC_TESTNET_RPC_URL || RHC_PUBLIC_RPC_TESTNET,
    simulationMethod:
      env.ZGUARD_SIMULATION_METHOD === "eth_simulateV1" ||
      env.ZGUARD_SIMULATION_METHOD === "debug_traceCall"
        ? env.ZGUARD_SIMULATION_METHOD
        : "auto",

    stockRegistryUrl:
      env.ZGUARD_STOCK_REGISTRY_URL || "https://api.robinhood.com/rhj/assets",
    chainlinkFeedsUrl:
      env.ZGUARD_CHAINLINK_FEEDS_URL ||
      "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json",
    registryRefreshSeconds: Number(env.ZGUARD_REGISTRY_REFRESH_SECONDS || 900),

    // Default payTo falls back to configured buyback wallet or zero-placeholder marked in open config
    x402PayTo:
      env.ZGUARD_X402_PAY_TO ||
      env.ZGUARD_BUYBACK_WALLET ||
      "0x0000000000000000000000000000000000004663",
    pricesMicroUsdg: {
      verify: BigInt(env.ZGUARD_PRICE_VERIFY_MICRO_USDG ?? "3000"),
      simulate: BigInt(env.ZGUARD_PRICE_SIMULATE_MICRO_USDG ?? "5000"),
      tokenRisk: BigInt(env.ZGUARD_PRICE_TOKEN_RISK_MICRO_USDG ?? "10000"),
      check: BigInt(env.ZGUARD_PRICE_CHECK_MICRO_USDG ?? "5000"),
      guard: BigInt(env.ZGUARD_PRICE_GUARD_MICRO_USDG ?? "15000"),
    },
    devFreeCreditMicroUsdg: BigInt(
      env.ZGUARD_DEV_FREE_CREDIT_MICRO_USDG ??
        (env.NODE_ENV === "production" ? "0" : "60000")
    ),
    enableUsdcBase: env.ZGUARD_ENABLE_USDC_BASE === "true",
    enableUsdcSolana: env.ZGUARD_ENABLE_USDC_SOLANA === "true",

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
    zkBatchSize: Number(env.ZGUARD_ZK_BATCH_SIZE ?? 10),
  };
}
