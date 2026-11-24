import { parseAbi, type PublicClient } from "viem";
import {
  CHAINLINK_CONFIRMED_FEEDS_RHC,
  RHC_CANONICAL_ASSETS,
  RHC_MAINNET_CHAIN_ID,
  RHC_TESTNET_ASSETS,
  RHC_TESTNET_CHAIN_ID,
  getRhcChainProfile,
} from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";

export interface OfficialStockTokenEntry {
  chainId: number;
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
  "function oraclePaused() view returns (bool)",
]);

/**
 * Periodically refreshes:
 *   1. Official Robinhood Stock Token Registry (`https://api.robinhood.com/rhj/assets`) + Testnet 46630 BeaconProxy deployments
 *   2. Official Chainlink RHC Mainnet Feeds (`https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`)
 *   3. Off-chain Robinhood REST Pricing API (`https://api.robinhood.com/rhj/prices/{symbol}`) when on Testnet 46630
 * Never relies on ticker matching — identity is strictly `(chainId, contractAddress)` (§1.2, §7.2, §7.5, §10).
 */
export class RhcRegistryService {
  private readonly config: ZGuardAppConfig;
  private stockByChainAndAddr = new Map<string, OfficialStockTokenEntry>();
  private canonicalAddrByChainAndSym = new Map<string, string>();
  private feedBySymbol = new Map<string, ChainlinkFeedEntry>();
  private lastRefreshedMs = 0;
  private refreshPromise: Promise<void> | null = null;

  constructor(config: ZGuardAppConfig) {
    this.config = config;

    // Seed Mainnet 4663 canonical WETH & USDG
    this.canonicalAddrByChainAndSym.set(
      `${RHC_MAINNET_CHAIN_ID}:USDG`,
      RHC_CANONICAL_ASSETS.USDG.address.toLowerCase()
    );
    this.canonicalAddrByChainAndSym.set(
      `${RHC_MAINNET_CHAIN_ID}:WETH`,
      RHC_CANONICAL_ASSETS.WETH.address.toLowerCase()
    );

    // Seed Testnet 46630 canonical WETH, USDG & verified Robinhood Stock Token BeaconProxies
    this.canonicalAddrByChainAndSym.set(
      `${RHC_TESTNET_CHAIN_ID}:USDG`,
      RHC_TESTNET_ASSETS.USDG.address.toLowerCase()
    );
    this.canonicalAddrByChainAndSym.set(
      `${RHC_TESTNET_CHAIN_ID}:WETH`,
      RHC_TESTNET_ASSETS.WETH.address.toLowerCase()
    );
    for (const st of RHC_TESTNET_ASSETS.STOCK_TOKENS) {
      const lower = st.address.toLowerCase();
      this.stockByChainAndAddr.set(`${RHC_TESTNET_CHAIN_ID}:${lower}`, {
        chainId: RHC_TESTNET_CHAIN_ID,
        address: st.address,
        symbol: st.symbol,
        name: st.name,
      });
      this.canonicalAddrByChainAndSym.set(`${RHC_TESTNET_CHAIN_ID}:${st.symbol}`, lower);
    }

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
      this.lastRefreshedMs > 0 &&
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
          if (
            (dep.chainId === RHC_MAINNET_CHAIN_ID || dep.chainId === RHC_TESTNET_CHAIN_ID) &&
            dep.contractAddress &&
            /^0x[a-fA-F0-9]{40}$/.test(dep.contractAddress)
          ) {
            const lower = dep.contractAddress.toLowerCase();
            this.stockByChainAndAddr.set(`${dep.chainId}:${lower}`, {
              chainId: dep.chainId,
              address: dep.contractAddress as `0x${string}`,
              symbol: sym,
              name,
            });
            if (sym) {
              this.canonicalAddrByChainAndSym.set(`${dep.chainId}:${sym}`, lower);
              // Also ensure Testnet ticker map knows all official Robinhood equity symbols so fake ticker-twins on 46630 are caught!
              if (!this.canonicalAddrByChainAndSym.has(`${RHC_TESTNET_CHAIN_ID}:${sym}`)) {
                this.canonicalAddrByChainAndSym.set(`${RHC_TESTNET_CHAIN_ID}:${sym}`, lower);
              }
            }
          }
        }
      }
    } else {
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
        this.stockByChainAndAddr.set(`${RHC_MAINNET_CHAIN_ID}:${lower}`, {
          chainId: RHC_MAINNET_CHAIN_ID,
          address: addr,
          symbol: rawSym,
          name: rawName,
        });
        this.canonicalAddrByChainAndSym.set(`${RHC_MAINNET_CHAIN_ID}:${rawSym}`, lower);
      }
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
      const baseSym = name.split("/")[0]?.trim().toUpperCase();
      if (!baseSym) continue;
      const decimals =
        Number(item.decimals ?? (item.multiply ? Math.log10(Number(item.multiply)) : 8)) || 8;
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

  public getStockTokenByAddress(
    address: string,
    chainId: number = this.config.activeChainId
  ): OfficialStockTokenEntry | null {
    return this.stockByChainAndAddr.get(`${chainId}:${address.trim().toLowerCase()}`) ?? null;
  }

  public getCanonicalTickerMap(chainId: number = this.config.activeChainId): Record<string, string> {
    const out: Record<string, string> = {};
    const prefix = `${chainId}:`;
    for (const [k, addr] of this.canonicalAddrByChainAndSym.entries()) {
      if (k.startsWith(prefix)) {
        out[k.slice(prefix.length)] = addr;
      }
    }
    // Always guard USDG & WETH for the requested chain
    const profile = getRhcChainProfile(chainId);
    out.USDG = profile.usdgAddress.toLowerCase();
    out.WETH = profile.wethAddress.toLowerCase();
    return out;
  }

  public listStockTokens(chainId: number = this.config.activeChainId): OfficialStockTokenEntry[] {
    const out: OfficialStockTokenEntry[] = [];
    for (const entry of this.stockByChainAndAddr.values()) {
      if (entry.chainId === chainId) out.push(entry);
    }
    return out;
  }

  public getStats(chainId: number = this.config.activeChainId) {
    const activeCount = this.listStockTokens(chainId).length;
    const mainnetCount = this.listStockTokens(RHC_MAINNET_CHAIN_ID).length;
    const testnetCount = this.listStockTokens(RHC_TESTNET_CHAIN_ID).length;
    return {
      activeChainId: chainId,
      stockTokenCount: activeCount,
      mainnetStockTokenCount: mainnetCount,
      testnetStockTokenCount: testnetCount,
      chainlinkFeedCount: this.feedBySymbol.size,
      lastRefreshedAt: this.lastRefreshedMs
        ? new Date(this.lastRefreshedMs).toISOString()
        : null,
    };
  }

  /**
   * Reads ERC-8056 `uiMultiplier()` & `oraclePaused()` on-chain, plus:
   * - Mainnet (4663): Chainlink `AggregatorV3Interface.latestRoundData()` (§7.5 — never multiplies by uiMultiplier again)
   * - Testnet (46630): Robinhood Official REST Pricing API (`https://api.robinhood.com/rhj/prices/{symbol}`) (§7.2)
   */
  public async readOracleData(
    client: PublicClient,
    symbol: string,
    tokenAddress?: `0x${string}`,
    chainId: number = this.config.activeChainId
  ): Promise<{
    feedProxy: string | null;
    priceUsd: string | null;
    updatedAt: number | null;
    stale: boolean | null;
    oraclePaused?: boolean | null;
    uiMultiplier?: string | null;
  }> {
    let uiMultiplier: string | null = null;
    let oraclePaused: boolean | null = null;
    if (tokenAddress) {
      const [mRes, pRes] = await Promise.all([
        client
          .readContract({
            address: tokenAddress,
            abi: ERC8056_ABI,
            functionName: "uiMultiplier",
          })
          .catch(() => null),
        client
          .readContract({
            address: tokenAddress,
            abi: ERC8056_ABI,
            functionName: "oraclePaused",
          })
          .catch(() => null),
      ]);
      uiMultiplier = mRes !== null ? mRes.toString() : null;
      oraclePaused = pRes !== null ? Boolean(pRes) : null;
    }

    // On Mainnet 4663: read on-chain Chainlink AggregatorV3Interface proxy
    if (chainId === RHC_MAINNET_CHAIN_ID) {
      const feed = this.feedBySymbol.get(symbol.toUpperCase());
      if (feed) {
        try {
          const [, answer, , updatedAt] = await client.readContract({
            address: feed.proxyAddress,
            abi: AGGREGATOR_V3_ABI,
            functionName: "latestRoundData",
          });
          const updatedSec = Number(updatedAt);
          const nowSec = Math.floor(Date.now() / 1000);
          const stale =
            answer <= 0n || updatedSec <= 0 || nowSec - updatedSec > feed.heartbeatSeconds;
          const scaled = Number(answer) / 10 ** feed.decimals;
          return {
            feedProxy: feed.proxyAddress,
            priceUsd: oraclePaused === true ? null : scaled.toFixed(4),
            updatedAt: updatedSec,
            stale,
            oraclePaused,
            uiMultiplier,
          };
        } catch {
          // Fall through to REST pricing API below
        }
      }
    }

    // On Testnet 46630 (or fallback): read official Robinhood REST Pricing API (`https://api.robinhood.com/rhj/prices/{symbol}`)
    if (symbol.toUpperCase() === "USDG") {
      return {
        feedProxy: "rhj-rest:USDG",
        priceUsd: "1.0000",
        updatedAt: Math.floor(Date.now() / 1000),
        stale: false,
        oraclePaused,
        uiMultiplier,
      };
    }

    try {
      const resp = await fetch(
        `https://api.robinhood.com/rhj/prices/${encodeURIComponent(symbol.toUpperCase())}`,
        { signal: AbortSignal.timeout(4_000) }
      );
      if (resp.ok) {
        const data = (await resp.json()) as {
          quotes?: Array<{
            tokenBid?: string;
            tokenAsk?: string;
            bid?: string;
            ask?: string;
            isTradingHalt?: boolean;
            generatedAt?: string;
          }>;
        };
        const q = data.quotes?.[0];
        if (q) {
          const bid = Number(q.tokenBid ?? q.bid ?? "0");
          const ask = Number(q.tokenAsk ?? q.ask ?? "0");
          const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : bid || ask;
          const genSec = q.generatedAt ? Math.floor(Date.parse(q.generatedAt) / 1000) : null;
          return {
            feedProxy: "https://api.robinhood.com/rhj/prices",
            priceUsd: q.isTradingHalt || oraclePaused === true || mid <= 0 ? null : mid.toFixed(4),
            updatedAt: genSec,
            stale: Boolean(q.isTradingHalt),
            oraclePaused: oraclePaused ?? Boolean(q.isTradingHalt),
            uiMultiplier,
          };
        }
      }
    } catch {
      // Ignore off-chain price error
    }

    return {
      feedProxy: null,
      priceUsd: null,
      updatedAt: null,
      stale: null,
      oraclePaused,
      uiMultiplier,
    };
  }
}
