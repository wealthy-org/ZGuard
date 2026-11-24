import { parseAbiItem, type Hex, type PublicClient } from "viem";
import { getRhcChainProfile } from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";

export interface HolderMetrics {
  count: number | null;
  top10Bps: number | null;
  source?: string;
}

const holderCache = new Map<string, { expiresAt: number; data: HolderMetrics }>();

/**
 * Resolves live token holder count & top-10 concentration (in basis points, 0..10000) (§6.3.2):
 * 1. Custom `ZGUARD_HOLDER_INDEXER_URL` if configured by operator.
 * 2. Official Blockscout REST v2 API (`https://explorer.testnet.chain.robinhood.com/api/v2` on 46630,
 *    or `https://robinhoodchain.blockscout.com/api/v2` on 4663):
 *      - `GET /tokens/{address}` -> `holders_count`, `total_supply`
 *      - `GET /tokens/{address}/holders` -> sums top 10 holder balances / `total_supply` * 10,000
 * 3. Recent on-chain `Transfer` log scan fallback for newly deployed curves/tokens when Blockscout is behind or blocked.
 * Never fabricates numbers (§6.3.2: "Jangan mengarang angka").
 */
export async function fetchHolderMetrics(params: {
  config: ZGuardAppConfig;
  client: PublicClient;
  chainId: number;
  tokenAddress: string;
  totalSupplyHint?: bigint | null;
}): Promise<HolderMetrics> {
  const { config, client, chainId, tokenAddress, totalSupplyHint } = params;
  const cacheKey = `${chainId}:${tokenAddress.toLowerCase()}`;
  const hit = holderCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.data;
  }

  // 1. Custom operator indexer override
  if (config.holderIndexerUrl) {
    try {
      const url = `${config.holderIndexerUrl.replace(/\/+$/, "")}/${tokenAddress}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      if (resp.ok) {
        const json = (await resp.json()) as { count?: number; top10Bps?: number };
        const result: HolderMetrics = {
          count: typeof json.count === "number" ? json.count : null,
          top10Bps: typeof json.top10Bps === "number" ? json.top10Bps : null,
          source: "configured_indexer",
        };
        holderCache.set(cacheKey, { expiresAt: Date.now() + 120_000, data: result });
        return result;
      }
    } catch {
      // Fall through to official Blockscout API
    }
  }

  // 2. Official Robinhood Chain Blockscout API v2
  const profile = getRhcChainProfile(chainId);
  const apiBase = profile.explorerApiUrl;
  try {
    const [tokResp, holdersResp] = await Promise.all([
      fetch(`${apiBase}/tokens/${tokenAddress}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6_000),
      }),
      fetch(`${apiBase}/tokens/${tokenAddress}/holders`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6_000),
      }),
    ]);

    if (tokResp.ok && holdersResp.ok) {
      const tokJson = (await tokResp.json()) as {
        holders_count?: string | number | null;
        holders?: string | number | null;
        total_supply?: string | null;
      };
      const holdersJson = (await holdersResp.json()) as {
        items?: Array<{ value?: string; address?: { hash?: string } }>;
      };

      const rawCount = tokJson.holders_count ?? tokJson.holders;
      const count =
        rawCount !== undefined && rawCount !== null && !Number.isNaN(Number(rawCount))
          ? Number(rawCount)
          : (holdersJson.items?.length ?? null);

      const supply =
        tokJson.total_supply && /^\d+$/.test(tokJson.total_supply)
          ? BigInt(tokJson.total_supply)
          : (totalSupplyHint ?? null);

      let top10Bps: number | null = null;
      if (supply && supply > 0n && Array.isArray(holdersJson.items) && holdersJson.items.length > 0) {
        let top10Sum = 0n;
        for (const item of holdersJson.items.slice(0, 10)) {
          if (item.value && /^\d+$/.test(item.value)) {
            top10Sum += BigInt(item.value);
          }
        }
        const computedBps = Number((top10Sum * 10_000n) / supply);
        top10Bps = Math.min(10_000, Math.max(0, computedBps));
      }

      const result: HolderMetrics = {
        count,
        top10Bps,
        source: `blockscout_v2 (${chainId})`,
      };
      holderCache.set(cacheKey, { expiresAt: Date.now() + 120_000, data: result });
      return result;
    }
  } catch {
    // Fall through if Blockscout API is rate-limited or Cloudflare-challenged
  }

  // 3. Honest fallback: check if token was freshly created within recent 2,000 blocks; otherwise report null without guessing
  try {
    const latestBlock = await client.getBlockNumber();
    const fromBlock = latestBlock > 2_000n ? latestBlock - 2_000n : 0n;
    const logs = await client.getLogs({
      address: tokenAddress as Hex,
      event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"),
      fromBlock,
      toBlock: latestBlock,
    });

    const sawGenesisMint = logs.some(
      (l) => l.args.from?.toLowerCase() === "0x0000000000000000000000000000000000000000"
    );
    if (sawGenesisMint && logs.length > 0) {
      const balances = new Map<string, bigint>();
      for (const l of logs) {
        const from = (l.args.from ?? "").toLowerCase();
        const to = (l.args.to ?? "").toLowerCase();
        const val = l.args.value ?? 0n;
        if (from && from !== "0x0000000000000000000000000000000000000000") {
          balances.set(from, (balances.get(from) ?? 0n) - val);
        }
        if (to && to !== "0x0000000000000000000000000000000000000000") {
          balances.set(to, (balances.get(to) ?? 0n) + val);
        }
      }
      const positive = Array.from(balances.values())
        .filter((v) => v > 0n)
        .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));
      const total = totalSupplyHint ?? positive.reduce((acc, v) => acc + v, 0n);
      const top10Sum = positive.slice(0, 10).reduce((acc, v) => acc + v, 0n);
      const result: HolderMetrics = {
        count: positive.length,
        top10Bps: total > 0n ? Math.min(10_000, Number((top10Sum * 10_000n) / total)) : null,
        source: "onchain_genesis_transfer_logs",
      };
      holderCache.set(cacheKey, { expiresAt: Date.now() + 60_000, data: result });
      return result;
    }
  } catch {
    // Ignore log scan throttling
  }

  const unavailable: HolderMetrics = {
    count: null,
    top10Bps: null,
    source: "indexer_unavailable (configure ZGUARD_HOLDER_INDEXER_URL)",
  };
  holderCache.set(cacheKey, { expiresAt: Date.now() + 30_000, data: unavailable });
  return unavailable;
}
