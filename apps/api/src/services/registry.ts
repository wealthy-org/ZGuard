import { parseAbi, type PublicClient } from "viem";
import { CHAINLINK_CONFIRMED_FEEDS_RHC, RHC_CANONICAL_ASSETS } from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";

export interface OfficialStockTokenEntry {
  address: `0x${string}`;
  symbol: string;
  name: string;
}

export interface ChainlinkFeedEntry {
  proxyAddress: `0x${string}`;
  name: string;
  symbol?: string;
  decimals: number;
  heartbeatSeconds: number;
  feedType?: string;
}

const AGGREGATOR_V3_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

const ERC8056_ABI = parseAbi([
  "function uiMultiplier() view returns (uint256)",
]);

/**
 * Periodically refreshes:
 *   1. Official Robinhood Stock Token Registry (`https://docs.robinhood.com/chain/contracts/`)
 *   2. Official Chainlink RHC Mainnet Feeds (`https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`)
 * Never relies on a hardcoded static ticker table (§1.2, §7.2, §7.5, §10).
 */
export class RhcRegistryService {
  private readonly config: ZGuardAppConfig;
  private stockByAddress = new Map<string, OfficialStockTokenEntry>();
  private canonicalAddressBySymbol = new Map<string, string>();
  private feedBySymbol = new Map<string, ChainlinkFeedEntry>();
  private lastRefreshedMs = 0;
  private refreshPromise: Promise<void> | null = null;

  constructor(config: ZGuardAppConfig) {
    this.config = config;
    // Always register canonical WETH & USDG
    this.canonicalAddressBySymbol.set(
      "USDG",
      RHC_CANONICAL_ASSETS.USDG.address.toLowerCase()
    );
    this.canonicalAddressBySymbol.set(
      "WETH",
      RHC_CANONICAL_ASSETS.WETH.address.toLowerCase()
    );
    this.feedBySymbol.set("USDG", {
      proxyAddress: CHAINLINK_CONFIRMED_FEEDS_RHC.USDG_USD.proxy,
      name: "USDG / USD",
      symbol: "USDG",
      decimals: CHAINLINK_CONFIRMED_FEEDS_RHC.USDG_USD.decimals,
      heartbeatSeconds: CHAINLINK_CONFIRMED_FEEDS_RHC.USDG_USD.heartbeatSeconds,
    });
    this.feedBySymbol.set("WETH", {
      proxyAddress: CHAINLINK_CONFIRMED_FEEDS_RHC.ETH_USD.proxy,
      name: "ETH / USD",
      symbol: "WETH",
      decimals: CHAINLINK_CONFIRMED_FEEDS_RHC.ETH_USD.decimals,
      heartbeatSeconds: CHAINLINK_CONFIRMED_FEEDS_RHC.ETH_USD.heartbeatSeconds,
    });
  }

  public async ensureFresh(): Promise<void> {
    const maxAgeMs = this.config.registryRefreshSeconds * 1000;
    if (
      this.stockByAddress.size > 0 &&
      Date.now() - this.lastRefreshedMs < maxAgeMs
    ) {
      return;
    }
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.refreshNow().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  public async refreshNow(): Promise<void> {
    await Promise.allSettled([
      this.refreshStockTokenRegistry(),
      this.refreshChainlinkFeeds(),
    ]);
    this.lastRefreshedMs = Date.now();
  }

  private async refreshStockTokenRegistry(): Promise<void> {
    const resp = await fetch(this.config.stockRegistryUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return;
    const contentType = resp.headers.get("content-type") ?? "";
    const rawBody = await resp.text();

    const nextByAddr = new Map<string, OfficialStockTokenEntry>();

    // Primary: Official Robinhood Chain Stock Token JSON API (`https://api.robinhood.com/rhj/assets`)
    if (contentType.includes("json") || rawBody.trim().startsWith("{")) {
      const parsed = JSON.parse(rawBody) as {
        assets?: Array<{
          tokenSymbol?: string;
          tokenName?: string;
          status?: string;
          deployments?: Array<{ contractAddress?: string; chainId?: number }>;
        }>;
      };
      for (const asset of parsed.assets ?? []) {
        if (asset.status && asset.status !== "ASSET_STATUS_ACTIVE") continue;
        const sym = (asset.tokenSymbol ?? "").trim().toUpperCase();
        const name = (asset.tokenName ?? sym).trim();
        for (const dep of asset.deployments ?? []) {
          if (dep.chainId === 4663 && dep.contractAddress && /^0x[a-fA-F0-9]{40}$/.test(dep.contractAddress)) {
            const lower = dep.contractAddress.toLowerCase();
            nextByAddr.set(lower, {
              address: dep.contractAddress as `0x${string}`,
              symbol: sym,
              name,
            });
            if (sym) this.canonicalAddressBySymbol.set(sym, lower);
          }
        }
      }
    } else {
      // Fallback: HTML table rows if pointed at a static/docs HTML mirror
      const rowRegex =
        /<tr[^>]*>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>[\s\S]*?(0x[a-fA-F0-9]{40})[\s\S]*?<\/td>\s*<\/tr>/gi;
      let match: RegExpExecArray | null;
      while ((match = rowRegex.exec(rawBody)) !== null) {
        const rawName = match[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
        const rawSym = match[2].replace(/<[^>]+>/g, "").trim().toUpperCase();
        const addr = match[3] as `0x${string}`;
        if (!rawSym || !/^0x[a-fA-F0-9]{40}$/.test(addr)) continue;
        if (rawSym === "WETH" || rawSym === "USDG") continue;
        const lower = addr.toLowerCase();
        nextByAddr.set(lower, { address: addr, symbol: rawSym, name: rawName });
        this.canonicalAddressBySymbol.set(rawSym, lower);
      }
    }

    if (nextByAddr.size > 0) {
      this.stockByAddress = nextByAddr;
    }
  }

  private async refreshChainlinkFeeds(): Promise<void> {
    const resp = await fetch(this.config.chainlinkFeedsUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return;
    const items = (await resp.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(items)) return;

    for (const item of items) {
      const proxy = String(item.proxyAddress ?? item.contractAddress ?? "");
      if (!/^0x[a-fA-F0-9]{40}$/.test(proxy)) continue;
      const name = String(item.name ?? "");
      // e.g. "AAPL / USD" -> symbol "AAPL"
      const baseSym = name.split("/")[0]?.trim().toUpperCase();
      if (!baseSym) continue;
      const decimals = Number(item.decimals ?? item.multiply ? Math.log10(Number(item.multiply)) : 8) || 8;
      const heartbeatSeconds = Number(item.heartbeat ?? 86400) || 86400;
      this.feedBySymbol.set(baseSym, {
        proxyAddress: proxy as `0x${string}`,
        name,
        symbol: baseSym,
        decimals,
        heartbeatSeconds,
        feedType: typeof item.feedType === "string" ? item.feedType : undefined,
      });
    }
  }

  public getStockTokenByAddress(address: string): OfficialStockTokenEntry | null {
    return this.stockByAddress.get(address.trim().toLowerCase()) ?? null;
  }

  public getCanonicalTickerMap(): Record<string, string> {
    return Object.fromEntries(this.canonicalAddressBySymbol.entries());
  }

  public listStockTokens(): OfficialStockTokenEntry[] {
    return Array.from(this.stockByAddress.values());
  }

  public getStats() {
    return {
      stockTokenCount: this.stockByAddress.size,
      chainlinkFeedCount: this.feedBySymbol.size,
      lastRefreshedAt: this.lastRefreshedMs
        ? new Date(this.lastRefreshedMs).toISOString()
        : null,
    };
  }

  /**
   * Reads Chainlink AggregatorV3Interface.latestRoundData() + ERC-8056 uiMultiplier() (§7.5).
   * Note per §7.5: Chainlink price already includes uiMultiplier(), so we NEVER multiply it again.
   */
  public async readOracleData(
    client: PublicClient,
    symbol: string,
    tokenAddress?: `0x${string}`
  ): Promise<{
    feedProxy: string | null;
    priceUsd: string | null;
    updatedAt: number | null;
    stale: boolean | null;
    uiMultiplier?: string | null;
  }> {
    let uiMultiplier: string | null = null;
    if (tokenAddress) {
      try {
        const m = await client.readContract({
          address: tokenAddress,
          abi: ERC8056_ABI,
          functionName: "uiMultiplier",
        });
        uiMultiplier = m.toString();
      } catch {
        uiMultiplier = null;
      }
    }

    const feed = this.feedBySymbol.get(symbol.toUpperCase());
    if (!feed) {
      return {
        feedProxy: null,
        priceUsd: null,
        updatedAt: null,
        stale: null,
        uiMultiplier,
      };
    }

    try {
      const [, answer, , updatedAt] = await client.readContract({
        address: feed.proxyAddress,
        abi: AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
      });
      const updatedSec = Number(updatedAt);
      const nowSec = Math.floor(Date.now() / 1000);
      const stale = updatedSec <= 0 || nowSec - updatedSec > feed.heartbeatSeconds;
      const scale = 10 ** feed.decimals;
      const formatted = (Number(answer) / scale).toFixed(4);
      return {
        feedProxy: feed.proxyAddress,
        priceUsd: formatted,
        updatedAt: updatedSec,
        stale,
        uiMultiplier,
      };
    } catch {
      return {
        feedProxy: feed.proxyAddress,
        priceUsd: null,
        updatedAt: null,
        stale: null,
        uiMultiplier,
      };
    }
  }
}
