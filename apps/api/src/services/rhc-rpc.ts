import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  type Chain,
  type PublicClient,
} from "viem";
import {
  RHC_CANONICAL_ASSETS,
  RHC_EXPLORER_MAINNET,
  RHC_EXPLORER_TESTNET,
  RHC_MAINNET_CHAIN_ID,
  RHC_TESTNET_ASSETS,
  RHC_TESTNET_CHAIN_ID,
  verifyContractEip712DomainOnchain,
} from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";

export const robinhoodMainnet: Chain = defineChain({
  id: RHC_MAINNET_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: RHC_EXPLORER_MAINNET },
  },
});

export const robinhoodTestnet: Chain = defineChain({
  id: RHC_TESTNET_CHAIN_ID,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: RHC_EXPLORER_TESTNET },
  },
  testnet: true,
});

export function getRpcUrlsForChain(config: ZGuardAppConfig, chainId: number): string[] {
  if (chainId === config.activeChainId) {
    return Array.from(
      new Set([config.rhcRpcUrl, config.rhcFallbackRpcUrl].filter(Boolean))
    );
  }
  if (chainId === RHC_MAINNET_CHAIN_ID) {
    return Array.from(
      new Set([config.rhcMainnetRpcUrl, config.rhcMainnetFallbackRpcUrl].filter(Boolean))
    );
  }
  return Array.from(
    new Set([config.rhcTestnetRpcUrl, config.rhcTestnetFallbackRpcUrl].filter(Boolean))
  );
}

export function createRhcClientForChain(
  config: ZGuardAppConfig,
  chainId: number = config.activeChainId
): PublicClient {
  const urls = getRpcUrlsForChain(config, chainId);
  const transport =
    urls.length > 1
      ? fallback(urls.map((u) => http(u, { timeout: 10_000 })))
      : http(urls[0], { timeout: 10_000 });

  return createPublicClient({
    chain: chainId === RHC_MAINNET_CHAIN_ID ? robinhoodMainnet : robinhoodTestnet,
    transport,
  });
}

export function createRhcPublicClient(config: ZGuardAppConfig): PublicClient {
  return createRhcClientForChain(config, config.activeChainId);
}

/**
 * Raw JSON-RPC call helper for methods like `eth_simulateV1` or `debug_traceCall`.
 */
export async function rawRhcRpc<T = unknown>(
  config: ZGuardAppConfig,
  method: string,
  params: unknown[],
  chainId: number = config.activeChainId
): Promise<T> {
  const urls = getRpcUrlsForChain(config, chainId);

  let lastErr: unknown;
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = (await resp.json()) as {
        result?: T;
        error?: { code: number; message: string; data?: string };
      };
      if (json.error) {
        throw new Error(`${method} RPC error (${json.error.code}): ${json.error.message}`);
      }
      return json.result as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`RPC ${method} failed`);
}

/**
 * Verifies USDG's EIP-712 domain directly from the installed contracts on RHC Testnet (46630) & Mainnet (4663) (§2.1).
 */
export async function refreshVerifiedUsdgDomain(
  client: PublicClient,
  chainId: number = RHC_TESTNET_CHAIN_ID
): Promise<void> {
  const addr =
    chainId === RHC_MAINNET_CHAIN_ID
      ? RHC_CANONICAL_ASSETS.USDG.address
      : RHC_TESTNET_ASSETS.USDG.address;
  await verifyContractEip712DomainOnchain(client, chainId, addr).catch(() => undefined);
}
