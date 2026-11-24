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
  RHC_MAINNET_CHAIN_ID,
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

export function createRhcPublicClient(config: ZGuardAppConfig): PublicClient {
  const urls = Array.from(
    new Set([config.rhcRpcUrl, config.rhcFallbackRpcUrl].filter(Boolean))
  );

  const transport =
    urls.length > 1
      ? fallback(urls.map((u) => http(u, { timeout: 10_000 })))
      : http(urls[0], { timeout: 10_000 });

  return createPublicClient({
    chain: robinhoodMainnet,
    transport,
  });
}

/**
 * Raw JSON-RPC call helper for methods like `eth_simulateV1` or `debug_traceCall`.
 */
export async function rawRhcRpc<T = unknown>(
  config: ZGuardAppConfig,
  method: string,
  params: unknown[]
): Promise<T> {
  const urls = Array.from(
    new Set([config.rhcRpcUrl, config.rhcFallbackRpcUrl].filter(Boolean))
  );

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
 * Verifies USDG's EIP-712 domain directly from the installed contract on RHC 4663 (§2.1).
 */
export async function refreshVerifiedUsdgDomain(client: PublicClient): Promise<void> {
  await verifyContractEip712DomainOnchain(
    client,
    RHC_MAINNET_CHAIN_ID,
    RHC_CANONICAL_ASSETS.USDG.address
  ).catch(() => undefined);
}
