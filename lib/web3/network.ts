import type { Address } from "viem";
import testnetManifest from "@/deployments/robinhood-testnet.json";
import mainnetManifest from "@/deployments/robinhood-mainnet.json";
import testnetPools from "@/deployments/v4-pools.json";
import mainnetPools from "@/deployments/mainnet/v4-pools.json";

/**
 * Build-time network selection. One build serves exactly one chain:
 *   NEXT_PUBLIC_PERM_CHAIN_ID=4663  → Robinhood Chain mainnet (manifest deployments/robinhood-mainnet.json)
 *   unset / 46630                   → Robinhood Chain testnet (manifest deployments/robinhood-testnet.json)
 * Any other value fails the build instead of silently falling back.
 */
export const ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
export const ROBINHOOD_MAINNET_CHAIN_ID = 4_663;

const rawChainId = process.env.NEXT_PUBLIC_PERM_CHAIN_ID;
if (rawChainId && rawChainId !== String(ROBINHOOD_TESTNET_CHAIN_ID) && rawChainId !== String(ROBINHOOD_MAINNET_CHAIN_ID)) {
  throw new Error(`NEXT_PUBLIC_PERM_CHAIN_ID must be ${ROBINHOOD_MAINNET_CHAIN_ID} or ${ROBINHOOD_TESTNET_CHAIN_ID}`);
}

export const IS_MAINNET = rawChainId === String(ROBINHOOD_MAINNET_CHAIN_ID);
export const PERM_CHAIN_ID = IS_MAINNET ? ROBINHOOD_MAINNET_CHAIN_ID : ROBINHOOD_TESTNET_CHAIN_ID;

type V3VenueManifest = { factory: string; swapRouter02: string; quoterV2: string; quoterShim?: string; weth: string };

/** The subset of the deployment manifest the app reads. Both manifests satisfy it. */
export type PermManifest = {
  routerVersion: number;
  network: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  poolManager: string;
  poolDiscoveryStartBlock?: number;
  v4Quoter: string;
  permit2: string;
  permRouter: string | null;
  v4Adapter: string | null;
  v3Adapter: string | null;
  v2Adapter?: string | null;
  wethAdapter?: string | null;
  deploymentBlock: number | null;
  executionReady?: boolean;
  venues: { synthraV3?: V3VenueManifest | null; uniswapV3?: V3VenueManifest | null };
  aggregatorHooks?: unknown[];
  policy: { version: number; platformFeeBps: number; rebateShareBps: number };
};

export const MANIFEST = (IS_MAINNET ? mainnetManifest : testnetManifest) as unknown as PermManifest;
if (MANIFEST.chainId !== PERM_CHAIN_ID) throw new Error(`Deployment manifest chain ${MANIFEST.chainId} does not match ${PERM_CHAIN_ID}`);

type RegistryPool = {
  id: string;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  hookData: string;
  sourceType: string;
  initializationBlock: number;
};
export const POOL_REGISTRY = (IS_MAINNET ? mainnetPools : testnetPools) as unknown as { chainId: number; pools: RegistryPool[] };
if (POOL_REGISTRY.chainId !== PERM_CHAIN_ID) throw new Error(`v4 pool registry chain ${POOL_REGISTRY.chainId} does not match ${PERM_CHAIN_ID}`);

/**
 * The concentrated-liquidity (v3-style) venue served by PermV3Adapter on this chain.
 * Testnet: Synthra v3 (third party). Mainnet: canonical Uniswap v3 — Synthra has no pools on 4663.
 * providerId must equal the id passed to PermRouter.configureAdapter for the v3 adapter.
 */
const v3Manifest = (IS_MAINNET ? MANIFEST.venues.uniswapV3 : MANIFEST.venues.synthraV3) as V3VenueManifest | null | undefined;
if (!v3Manifest) throw new Error("The deployment manifest has no v3 venue for this chain");
export const V3_VENUE = {
  providerId: IS_MAINNET ? "UNISWAP_V3" as const : "SYNTHRA_V3" as const,
  label: IS_MAINNET ? "Uniswap v3 pool" : "Synthra v3 pool",
  shortLabel: IS_MAINNET ? "Uniswap v3" : "Synthra v3",
  factory: v3Manifest.factory as Address,
  swapRouter02: v3Manifest.swapRouter02 as Address,
  quoterV2: v3Manifest.quoterV2 as Address,
  quoterShim: (v3Manifest.quoterShim || v3Manifest.quoterV2) as Address,
  weth: v3Manifest.weth as Address,
} as const;

/** Every provider id a v3-style step may carry, across both chains (used by display/filter code). */
export const V3_PROVIDER_IDS = ["UNISWAP_V3", "SYNTHRA_V3"] as const;
export type V3ProviderId = (typeof V3_PROVIDER_IDS)[number];
export function isV3ProviderId(value: string): value is V3ProviderId {
  return (V3_PROVIDER_IDS as readonly string[]).includes(value);
}

/** User-facing network copy. Keep marketing claims out of here; this is factual labelling only. */
export const NETWORK_COPY = IS_MAINNET
  ? {
      name: "Robinhood Chain",
      shortName: "Robinhood Chain",
      chipLabel: "Robinhood Chain",
      kicker: "ROBINHOOD CHAIN",
      explorerName: "Blockscout",
      nativeCurrencyName: "Ether",
      testnet: false,
      assetBoundary: "Robinhood Stock Tokens are tokens, not shares. They do not carry shareholder rights.",
      confirmationMessage: "Waiting for Robinhood Chain confirmation…",
    }
  : {
      name: "Robinhood Chain Testnet",
      shortName: "RH Testnet",
      chipLabel: "RH Testnet",
      kicker: "ROBINHOOD CHAIN TESTNET",
      explorerName: "Robinhood Testnet Explorer",
      nativeCurrencyName: "Testnet Ether",
      testnet: true,
      assetBoundary: "All assets are third-party testnet fixtures with no monetary value. Symbols do not represent equity, issuer affiliation, or guaranteed pricing.",
      confirmationMessage: "Waiting for Robinhood Chain testnet confirmation…",
    };
