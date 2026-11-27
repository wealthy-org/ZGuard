import type { Address, Hex } from "viem";
import { POOL_REGISTRY as poolRegistry } from "@/lib/web3/network";

export type V4PoolFixture = {
  id: Hex;
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  hookData: Hex;
  sourceType: "direct" | "aggregator-hook";
  initializationBlock: number;
};

/** Persistent PoolManager registry for the active chain. Testnet: event-discovered
 * (deployments/v4-pools.json). Mainnet: liquidity-admitted, hookless native-ETH pools only
 * (deployments/mainnet/v4-pools.json, built by scripts/mainnet/build-pool-registry.mjs).
 * Hooked pools are excluded unless their hook address was explicitly approved by operations. */
export const ACTIVE_V4_POOLS: readonly V4PoolFixture[] = poolRegistry.pools.map((pool) => ({
  id: pool.id as Hex,
  currency0: pool.currency0 as Address,
  currency1: pool.currency1 as Address,
  fee: pool.fee,
  tickSpacing: pool.tickSpacing,
  hooks: pool.hooks as Address,
  hookData: pool.hookData as Hex,
  sourceType: pool.sourceType === "verified-hook" ? "aggregator-hook" : "direct",
  initializationBlock: pool.initializationBlock,
}));
/** @deprecated kept for older imports; the registry now follows NEXT_PUBLIC_PERM_CHAIN_ID. */
export const RH_TESTNET_V4_POOLS = ACTIVE_V4_POOLS;

export function tokenPairPools(tokenIn: Address, tokenOut: Address) {
  const input = tokenIn.toLowerCase();
  const output = tokenOut.toLowerCase();
  return ACTIVE_V4_POOLS.filter((pool) => {
    const zero = pool.currency0.toLowerCase();
    const one = pool.currency1.toLowerCase();
    return (zero === input && one === output) || (zero === output && one === input);
  });
}
