import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_PUBLIC_RPC_MAINNET,
  BASE_PUBLIC_RPC_SEPOLIA,
  DEAD_BURN_ADDRESS,
  DEFAULT_ACTIVE_RHC_CHAIN_ID,
  KNOWN_RHC_CONTRACTS,
  PONS_TESTNET_CONTRACTS,
  PONS_V1_CONTRACTS,
  PONS_V2_CONTRACTS,
  RHC_CANONICAL_ASSETS,
  RHC_MAINNET_CHAIN_ID,
  RHC_PUBLIC_RPC_MAINNET,
  RHC_PUBLIC_RPC_TESTNET,
  RHC_TESTNET_ASSETS,
  RHC_TESTNET_CHAIN_ID,
  SOLANA_PUBLIC_RPC_DEVNET,
  UNISWAP_V4_RHC,
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
  /** True when NODE_ENV=production (Vercel). Enables strict production guards. */
  isProduction: boolean;
  /** Explicit escape hatch to run the local JSON store in production (NOT recommended). */
  allowLocalStoreInProduction: boolean;

  /** Admin key for global revenue/ledger views (`x-admin-key` header). Null = admin views disabled. */
  adminApiKey: string | null;
  /** Browser origins allowed to call keyed endpoints cross-origin. Empty = same-origin/server-side only. */
  corsOrigins: string[];
  /** Global per-IP request budget per minute (0 disables). */
  rateLimitPerMinute: number;
  /** `/v1/register` budget per IP per hour (0 disables). */
  registerLimitPerIpPerHour: number;
  /** `/v1/register` (with X-PAYMENT) budget per payer address per hour (0 disables). */
  registerLimitPerPayerPerHour: number;

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
  /**
   * Set when ZGUARD_X402_PAY_TO is missing (production) or not a valid 0x EVM address. The raw value is
   * never echoed (operators sometimes paste a secret into the wrong variable). Payments are refused.
   */
  x402PayToError: string | null;
  x402SolanaPayTo: string | null;
  x402RelayerPrivateKey: string | null;
  /**
   * How an X-PAYMENT turns into credit (gap X402-1/X402-2/X402-4):
   * - `onchain`  : EIP-3009 authorizations are settled by the relayer; credit ONLY after a successful receipt.
   * - `deposit`  : no relayer. Client transfers USDG to `x402PayTo` itself, then claims with `txHash` +
   *                `claimSignature` from the SAME wallet. EIP-3009 authorizations are rejected.
   * - `auto`     : `onchain` when a relayer key is configured, otherwise `deposit`. Never "credit without money".
   * - `offchain` : DEV/TEST ONLY (signature check without settlement). Refused when NODE_ENV=production.
   */
  x402SettlementMode: "auto" | "onchain" | "offchain" | "deposit";
  /** Blocks a payment tx must be buried under before it can be credited (reorg safety). */
  x402MinConfirmations: number;
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
  /** §9.9: invalid buyback settings (values hidden); the offending field is null / the default. */
  buybackConfigErrors: string[];

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
  /** Real SP1 program vkey from `cargo prove vkey`; until set, attestations carry a placeholder vkey. */
  zkProgramVKey: string | null;
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

  const isProduction = env.NODE_ENV === "production";
  const rawMode = env.ZGUARD_X402_SETTLEMENT_MODE;
  const x402SettlementMode: ZGuardAppConfig["x402SettlementMode"] =
    rawMode === "onchain" || rawMode === "offchain" || rawMode === "deposit" ? rawMode : "auto";

  return {
    productName: env.ZGUARD_PRODUCT_NAME || "ZGuard",
    port: Number(env.ZGUARD_API_PORT || env.PORT || 8787),
    host: env.ZGUARD_API_HOST || "0.0.0.0",
    publicApiUrl: env.ZGUARD_PUBLIC_API_URL || "http://localhost:8787",
    apiKeyPrefix: env.ZGUARD_API_KEY_PREFIX || "zg_",

    activeChainId,

    databaseUrl: env.DATABASE_URL || "",
    storageMode: env.ZGUARD_STORAGE_MODE === "neon" ? "neon" : "auto",
    isProduction,
    allowLocalStoreInProduction: env.ZGUARD_ALLOW_LOCAL_STORE_IN_PRODUCTION === "true",

    adminApiKey:
      env.ZGUARD_ADMIN_API_KEY && env.ZGUARD_ADMIN_API_KEY.trim().length >= 16
        ? env.ZGUARD_ADMIN_API_KEY.trim()
        : null,
    corsOrigins: (env.ZGUARD_CORS_ORIGINS ?? "")
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    rateLimitPerMinute: Number(env.ZGUARD_RATE_LIMIT_PER_MINUTE ?? 120),
    registerLimitPerIpPerHour: Number(env.ZGUARD_REGISTER_LIMIT_PER_IP_PER_HOUR ?? 5),
    registerLimitPerPayerPerHour: Number(env.ZGUARD_REGISTER_LIMIT_PER_PAYER_PER_HOUR ?? 10),

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

    ...resolvePayTo(env, isProduction),
    x402SolanaPayTo: env.ZGUARD_X402_SOLANA_PAY_TO || null,
    x402RelayerPrivateKey: env.ZGUARD_X402_RELAYER_PRIVATE_KEY || null,
    x402SettlementMode,
    x402MinConfirmations: Math.max(0, Number(env.ZGUARD_X402_MIN_CONFIRMATIONS ?? 3)),
    pricesMicroUsdg: {
      verify: BigInt(env.ZGUARD_PRICE_VERIFY_MICRO_USDG ?? "3000"),
      simulate: BigInt(env.ZGUARD_PRICE_SIMULATE_MICRO_USDG ?? "5000"),
      tokenRisk: BigInt(env.ZGUARD_PRICE_TOKEN_RISK_MICRO_USDG ?? "10000"),
      check: BigInt(env.ZGUARD_PRICE_CHECK_MICRO_USDG ?? "5000"),
      guard: BigInt(env.ZGUARD_PRICE_GUARD_MICRO_USDG ?? "15000"),
    },
    // C5: free credit is a testnet/dev convenience only ("hanya testnet").
    // - Mainnet 4663 in production: always 0.
    // - Testnet 46630 in production: only what the operator sets explicitly (default 0), rate-limited per IP.
    // - Local dev: defaults to 90000 micro-USDG.
    devFreeCreditMicroUsdg:
      isProduction && activeChainId === RHC_MAINNET_CHAIN_ID
        ? 0n
        : BigInt(env.ZGUARD_DEV_FREE_CREDIT_MICRO_USDG ?? (isProduction ? "0" : "90000")),
    enableUsdcBase: env.ZGUARD_ENABLE_USDC_BASE === "true",
    enableUsdcSolana: env.ZGUARD_ENABLE_USDC_SOLANA === "true",

    enableUrlFetch: env.ZGUARD_ENABLE_URL_FETCH !== "false",
    urlFetchTimeoutMs: Number(env.ZGUARD_URL_FETCH_TIMEOUT_MS ?? 4000),
    urlFetchMaxBytes: Number(env.ZGUARD_URL_FETCH_MAX_BYTES ?? 131_072),

    tokenTicker: env.ZGUARD_TOKEN_TICKER || "$ZGUARD",
    ...resolveBuybackConfig(env),

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
    // Halo2 circuit + prover CLI + generated verifier exist (CI), but the API runs no prover and no verifier is
    // deployed: opt-in only, and still yields `pending` (gap C2/C9/H7).
    zkHalo2Enabled: env.ZGUARD_ZK_HALO2_ENABLED === "true",
    zkSp1ProverUrl: env.ZGUARD_ZK_SP1_PROVER_URL || null,
    zkVerifierAddress: env.ZGUARD_ZK_VERIFIER_ADDRESS || null,
    zkProgramVKey: env.ZGUARD_ZK_SP1_PROGRAM_VKEY || null,
    zkVerifierPrivateKey:
      env.ZGUARD_ZK_VERIFIER_PRIVATE_KEY || env.ZGUARD_DEPLOYER_PRIVATE_KEY || null,
    zkBatchSize: Number(env.ZGUARD_ZK_BATCH_SIZE ?? 10),
  };
}

function collectAddresses(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) out.add(value.toLowerCase());
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectAddresses(v, out);
  }
}

/**
 * Third-party protocol / asset contracts on RHC. A ZGuard treasury, buyback wallet or product token must
 * never be one of these (brief §10: do not reuse pons/Wormhole/Paxos buyback, burn or multisig addresses).
 */
export const FOREIGN_PROTOCOL_ADDRESSES: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  collectAddresses([PONS_V2_CONTRACTS, PONS_V1_CONTRACTS, PONS_TESTNET_CONTRACTS, UNISWAP_V4_RHC, RHC_CANONICAL_ASSETS, RHC_TESTNET_ASSETS], out);
  for (const k of Object.keys(KNOWN_RHC_CONTRACTS)) collectAddresses(k, out);
  out.delete(DEAD_BURN_ADDRESS.toLowerCase());
  return out;
})();

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * §9.9 BB-1: buyback settings are validated like the pay-to address. Before, any string was published in
 * /v1/config, and a non-integer ZGUARD_BUYBACK_REVENUE_BPS made BigInt() throw on every paid call.
 */
export function resolveBuybackConfig(env: NodeJS.ProcessEnv): {
  ponsTokenAddress: string | null;
  buybackWallet: string | null;
  burnAddress: string;
  buybackRevenueBps: number;
  buybackConfigErrors: string[];
} {
  const errors: string[] = [];
  const addr = (name: string, raw: string | undefined, opts: { allowDead?: boolean } = {}): string | null => {
    const v = (raw ?? "").trim();
    if (!v) return null;
    if (!EVM_ADDR_RE.test(v) || /^0x0{40}$/i.test(v)) {
      errors.push(`${name} is not a valid non-zero 0x EVM address; value hidden`);
      return null;
    }
    const lower = v.toLowerCase();
    if (!opts.allowDead && lower === DEAD_BURN_ADDRESS.toLowerCase()) {
      errors.push(`${name} must not be the burn address`);
      return null;
    }
    if (FOREIGN_PROTOCOL_ADDRESSES.has(lower)) {
      errors.push(`${name} is a third-party protocol/asset contract (pons, Uniswap, USDG/Paxos, …), not a ZGuard address`);
      return null;
    }
    return v;
  };

  const ponsTokenAddress = addr("ZGUARD_PONS_TOKEN_ADDRESS", env.ZGUARD_PONS_TOKEN_ADDRESS);
  const buybackWallet = addr("ZGUARD_BUYBACK_WALLET", env.ZGUARD_BUYBACK_WALLET);
  const burnAddress = addr("ZGUARD_BURN_ADDRESS", env.ZGUARD_BURN_ADDRESS, { allowDead: true }) ?? DEAD_BURN_ADDRESS;
  if (ponsTokenAddress && buybackWallet && ponsTokenAddress.toLowerCase() === buybackWallet.toLowerCase()) {
    errors.push("ZGUARD_PONS_TOKEN_ADDRESS and ZGUARD_BUYBACK_WALLET must differ");
  }

  let buybackRevenueBps = 10_000;
  const rawBps = (env.ZGUARD_BUYBACK_REVENUE_BPS ?? "").trim();
  if (rawBps) {
    if (/^\d+$/.test(rawBps) && Number(rawBps) <= 10_000) {
      buybackRevenueBps = Number(rawBps);
    } else {
      errors.push("ZGUARD_BUYBACK_REVENUE_BPS must be an integer 0..10000; using the default 10000");
    }
  }
  return { ponsTokenAddress, buybackWallet, burnAddress, buybackRevenueBps, buybackConfigErrors: errors };
}

const PLACEHOLDER_PAY_TO = "0x0000000000000000000000000000000000004663";

/** Validates the x402 treasury address; an invalid value is replaced by the placeholder and never exposed. */
export function resolvePayTo(
  env: NodeJS.ProcessEnv,
  isProduction: boolean
): { x402PayTo: string; x402PayToError: string | null } {
  const rawName = env.ZGUARD_X402_PAY_TO ? "ZGUARD_X402_PAY_TO" : env.ZGUARD_BUYBACK_WALLET ? "ZGUARD_BUYBACK_WALLET" : null;
  const raw = (env.ZGUARD_X402_PAY_TO || env.ZGUARD_BUYBACK_WALLET || "").trim();
  if (!raw) {
    return {
      x402PayTo: PLACEHOLDER_PAY_TO,
      x402PayToError: isProduction
        ? "ZGUARD_X402_PAY_TO is not set; payments are refused until it is your 0x… wallet address"
        : null,
    };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw) || /^0x0{40}$/i.test(raw)) {
    return {
      x402PayTo: PLACEHOLDER_PAY_TO,
      x402PayToError: `${rawName} is not a valid 0x EVM address (42 chars, 0x + 40 hex); value hidden, payments refused`,
    };
  }
  if (FOREIGN_PROTOCOL_ADDRESSES.has(raw.toLowerCase())) {
    // §9.9: revenue must land in a ZGuard-controlled address, never a pons/Uniswap/USDG contract.
    return {
      x402PayTo: PLACEHOLDER_PAY_TO,
      x402PayToError: `${rawName} is a third-party protocol/asset contract, not a ZGuard treasury; payments refused`,
    };
  }
  return { x402PayTo: raw, x402PayToError: null };
}
