import { createPublicClient, defineChain, fallback, http, isAddress, type Address, type Hex } from "viem";
import { allowlistedModeForChain } from "./execution-mode";
import { IS_MAINNET, MANIFEST, NETWORK_COPY, PERM_CHAIN_ID, V3_VENUE } from "./network";

export { IS_MAINNET, NETWORK_COPY, PERM_CHAIN_ID, V3_VENUE };
const deployment = MANIFEST;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
// RPC override names are chain-specific so a testnet URL can never leak into a mainnet build.
export const PERM_RPC = (IS_MAINNET ? process.env.RH_MAINNET_RPC_URL : process.env.RH_TESTNET_RPC_URL) || deployment.rpcUrl;
export const PERM_FALLBACK_RPC = IS_MAINNET ? process.env.RH_MAINNET_FALLBACK_RPC_URL : process.env.RH_TESTNET_FALLBACK_RPC_URL;
export const PERM_EXPLORER = deployment.explorerUrl;

export const permChain = defineChain({
  id: PERM_CHAIN_ID,
  name: NETWORK_COPY.name,
  nativeCurrency: { name: NETWORK_COPY.nativeCurrencyName, symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [deployment.rpcUrl] },
  },
  blockExplorers: {
    default: { name: NETWORK_COPY.explorerName, url: PERM_EXPLORER },
  },
  testnet: NETWORK_COPY.testnet,
});

export const POOL_MANAGER_ADDRESS = deployment.poolManager as Address;
export const V4_QUOTER_ADDRESS = deployment.v4Quoter as Address;
export const PERMIT2_ADDRESS = deployment.permit2 as Address;

const envRouter = process.env.NEXT_PUBLIC_PERM_ROUTER_ADDRESS;
const envV4Adapter = process.env.NEXT_PUBLIC_PERM_V4_ADAPTER_ADDRESS;
const envV3Adapter = process.env.NEXT_PUBLIC_PERM_V3_ADAPTER_ADDRESS;
const envV2Adapter = process.env.NEXT_PUBLIC_PERM_V2_ADAPTER_ADDRESS;
export const PERM_ROUTER_ADDRESS = (envRouter || deployment.permRouter || undefined) as Address | undefined;
export const PERM_V4_ADAPTER_ADDRESS = (envV4Adapter || deployment.v4Adapter || undefined) as Address | undefined;
export const PERM_V3_ADAPTER_ADDRESS = (envV3Adapter || deployment.v3Adapter || undefined) as Address | undefined;
const manifestOptional = deployment as { v2Adapter?: string | null; wethAdapter?: string | null };
// Testnet keeps V2 env-only (third-party factory); mainnet may also read the official-Uniswap-V2 adapter from the manifest.
export const PERM_V2_ADAPTER_ADDRESS = (envV2Adapter || (IS_MAINNET ? manifestOptional.v2Adapter : undefined) || undefined) as Address | undefined;
if (envV2Adapter && !isAddress(envV2Adapter)) throw new Error("NEXT_PUBLIC_PERM_V2_ADAPTER_ADDRESS must be an address");
const envWethAdapter = process.env.NEXT_PUBLIC_PERM_WETH_ADAPTER_ADDRESS;
if (envWethAdapter && !isAddress(envWethAdapter)) throw new Error("NEXT_PUBLIC_PERM_WETH_ADAPTER_ADDRESS must be an address");
/** 1:1 ETH<->WETH route step; needed to reach the WETH-denominated Aggregator Hook pools on mainnet. */
export const PERM_WETH_ADAPTER_ADDRESS = (envWethAdapter || manifestOptional.wethAdapter || undefined) as Address | undefined;
// Server-side V2 gate. Testnet: reviewed third-party factory (staging opt-in). Mainnet: official Uniswap V2 (opt-in).
export const REVIEWED_V2_STAGING_ENABLED = IS_MAINNET
  ? process.env.PERM_MAINNET_ENABLE_UNISWAP_V2 === "1"
  : process.env.PERM_STAGING_ALLOW_REVIEWED_V2 === "1";
/**
 * Mainnet Aggregator Hook gate (server). Requires the opt-in flag and the WETH adapter; each hook must
 * additionally be codehash-pinned on PermV4Adapter (checked per quote) and listed in the manifest.
 */
export const MAINNET_AGGREGATOR_HOOKS_ENABLED = IS_MAINNET
  && process.env.PERM_MAINNET_ENABLE_AGGREGATOR_HOOKS === "1"
  && Boolean(PERM_WETH_ADAPTER_ADDRESS);
export const ROUTER_VERSION = Number(process.env.NEXT_PUBLIC_PERM_ROUTER_VERSION || deployment.routerVersion || 1);
const deploymentBlockOverride = process.env.NEXT_PUBLIC_PERM_DEPLOYMENT_BLOCK;
if (deploymentBlockOverride && !/^\d+$/.test(deploymentBlockOverride)) throw new Error("NEXT_PUBLIC_PERM_DEPLOYMENT_BLOCK must be an integer");
export const DEPLOYMENT_BLOCK = deploymentBlockOverride ? Number(deploymentBlockOverride) : deployment.deploymentBlock as number | null;
if (DEPLOYMENT_BLOCK !== null && (!Number.isSafeInteger(DEPLOYMENT_BLOCK) || DEPLOYMENT_BLOCK < 0)) throw new Error("Deployment block is invalid");

export const ALLOWLISTED_MODE = allowlistedModeForChain(process.env.NEXT_PUBLIC_PERM_CHAIN_ID).mode;
export const ALLOWLISTED_STAGING_BUILD = process.env.NEXT_PUBLIC_PERM_EXECUTION_MODE === ALLOWLISTED_MODE;
export const REVIEWED_V2_CLIENT_ENABLED = ALLOWLISTED_STAGING_BUILD
  && (IS_MAINNET ? process.env.NEXT_PUBLIC_PERM_ENABLE_UNISWAP_V2 === "1" : process.env.NEXT_PUBLIC_PERM_STAGING_ALLOW_REVIEWED_V2 === "1")
  && Boolean(PERM_V2_ADAPTER_ADDRESS);
/** Client toggle for the "Aggregator Hook" routing button on mainnet (the server gate above is authoritative). */
export const AGGREGATOR_HOOKS_CLIENT_ENABLED = IS_MAINNET
  && process.env.NEXT_PUBLIC_PERM_ENABLE_AGGREGATOR_HOOKS === "1"
  && Boolean(PERM_WETH_ADAPTER_ADDRESS);
const stagingAddressesValid = Boolean(
  envRouter && isAddress(envRouter)
    && envV4Adapter && isAddress(envV4Adapter)
    && envV3Adapter && isAddress(envV3Adapter),
);

const manifestExecutionReady = (deployment as { executionReady?: boolean }).executionReady === true;
const manifestRouter = (deployment as { permRouter?: string | null }).permRouter || undefined;
const manifestV4Adapter = (deployment as { v4Adapter?: string | null }).v4Adapter || undefined;
const manifestV3Adapter = (deployment as { v3Adapter?: string | null }).v3Adapter || undefined;
const runtimeMatchesOfficialManifest = Boolean(
  manifestRouter && manifestV4Adapter && manifestV3Adapter
    && PERM_ROUTER_ADDRESS?.toLowerCase() === manifestRouter.toLowerCase()
    && PERM_V4_ADAPTER_ADDRESS?.toLowerCase() === manifestV4Adapter.toLowerCase()
    && PERM_V3_ADAPTER_ADDRESS?.toLowerCase() === manifestV3Adapter.toLowerCase()
    && ROUTER_VERSION === Number(deployment.routerVersion),
);
const officialReleaseDeploymentReady = Boolean(
  manifestExecutionReady && Number(deployment.routerVersion) >= 2 && runtimeMatchesOfficialManifest,
);
const fullReleaseCandidateOverride = Boolean(
  process.env.NEXT_PUBLIC_PERM_EXECUTION_READY === "1"
    && !ALLOWLISTED_STAGING_BUILD
    && stagingAddressesValid
    && ROUTER_VERSION >= 2
    && deploymentBlockOverride
    && DEPLOYMENT_BLOCK !== null,
);
// The candidate override only selects a reviewed Router-v2 runtime. Strict health still
// requires fallback RPC, indexer, shared limits, alerts, WalletConnect and remote custody.
export const RELEASE_DEPLOYMENT_READY = officialReleaseDeploymentReady || fullReleaseCandidateOverride;

export const STAGING_DEPLOYMENT_CONFIGURED = Boolean(
  ALLOWLISTED_STAGING_BUILD
    && stagingAddressesValid
    && ROUTER_VERSION >= 2
    && deploymentBlockOverride
    && DEPLOYMENT_BLOCK !== null,
);
export const STAGING_E2E_DECLARED = process.env.NEXT_PUBLIC_PERM_STAGING_E2E_PASSED === "1";
export const STAGING_DEPLOYMENT_READY = STAGING_DEPLOYMENT_CONFIGURED && STAGING_E2E_DECLARED;
export const DEPLOYMENT_READY = RELEASE_DEPLOYMENT_READY || STAGING_DEPLOYMENT_READY;
export const DEPLOYMENT_MODE = RELEASE_DEPLOYMENT_READY
  ? "release"
  : STAGING_DEPLOYMENT_CONFIGURED
    ? "allowlisted-staging"
    : "read-only";

// V2 venue, codehash-pinned on both chains (factory and pair runtime code are identical to Uniswap/v2-core).
//  - Testnet: third-party deployment, opt-in, never represented as an official Uniswap deployment.
//  - Mainnet: the official Uniswap V2 factory on 4663 (Uniswap/contracts deployments/4663.md; feeTo is the
//    Uniswap TokenJar). Opt-in via PERM_MAINNET_ENABLE_UNISWAP_V2=1.
export const REVIEWED_V2 = {
  factory: (IS_MAINNET ? "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f" : "0x6C4cA684D84761E193cB23d62b22fA83bB35E54E") as Address,
  factoryCodehash: "0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0" as const,
  weth: V3_VENUE.weth,
  wethCodehash: (IS_MAINNET
    ? "0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353"
    : "0x55f8ac53c64450f01880d8249fc5cb0c69c064e4bcb097ea80a02fff40485a7c") as Hex,
  pairCodehash: "0x5b83bdbcc56b2e630f2807bbadd2b0c21619108066b92a58de081261089e9ce5" as const,
  providerId: IS_MAINNET ? "UNISWAP_V2" as const : "REVIEWED_V2_THIRD_PARTY" as const,
  label: IS_MAINNET ? "Uniswap v2 pool" : "Source-reviewed third-party V2 pool",
  shortLabel: IS_MAINNET ? "Uniswap v2" : "Reviewed V2",
  feeNumerator: 997n,
  feeDenominator: 1_000n,
  stepGasEstimate: 115_000n,
} as const;

export function createRobinhoodPublicClient() {
  const primary = http(PERM_RPC, {
    fetchOptions: { headers: { "user-agent": "Mozilla/5.0 Perm/2.0" } },
    retryCount: 2,
    timeout: 15_000,
  });
  const transport = PERM_FALLBACK_RPC
    ? fallback([primary, http(PERM_FALLBACK_RPC, { retryCount: 1, timeout: 15_000 })])
    : primary;
  return createPublicClient({ chain: permChain, transport });
}

// Browser reads go through the same-origin /api/rpc relay first: some browsers, privacy
// extensions and networks block the chain RPC host directly, which surfaced as
// "HTTP request failed". The direct public RPC stays as a fallback.
function createBrowserPublicClient() {
  const relay = http(`${window.location.origin}/api/rpc`, { retryCount: 2, timeout: 20_000 });
  const direct = http(PERM_RPC, { retryCount: 1, timeout: 15_000 });
  return createPublicClient({ chain: permChain, transport: fallback([relay, direct]) });
}

let browserClient: ReturnType<typeof createRobinhoodPublicClient> | undefined;
export function getRobinhoodPublicClient() {
  browserClient ??= typeof window === "undefined" ? createRobinhoodPublicClient() : createBrowserPublicClient();
  return browserClient;
}
