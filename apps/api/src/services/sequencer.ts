import { parseAbi, type Hex, type PublicClient } from "viem";
import type { ZGuardAppConfig } from "../config.js";

const SEQUENCER_FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export interface SequencerHealthStatus {
  up: boolean;
  gracePeriodPassed: boolean;
  latestBlockAgeSeconds: number | null;
  source: string;
}

const seqCache = new Map<number, { expiresAt: number; status: SequencerHealthStatus }>();

/**
 * Checks Robinhood Chain L2 sequencer health (§7.5 & Robinhood Oracles docs):
 * 1. If `ZGUARD_SEQUENCER_UPTIME_FEED` is configured, reads Chainlink's L2 Sequencer Uptime Feed
 *    (`answer == 0` means up; `now - startedAt > gracePeriodSeconds`).
 * 2. Always verifies L2 latest block timestamp freshness (`eth_getBlockByNumber("latest")`).
 */
export async function checkSequencerHealth(
  config: ZGuardAppConfig,
  client: PublicClient,
  chainId: number
): Promise<SequencerHealthStatus> {
  const cached = seqCache.get(chainId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.status;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  let latestBlockAgeSeconds: number | null = null;
  let blockUp = true;

  try {
    const latestBlock = await client.getBlock({ blockTag: "latest" });
    latestBlockAgeSeconds = Math.max(0, nowSec - Number(latestBlock.timestamp));
    if (latestBlockAgeSeconds > config.sequencerMaxBlockAgeSeconds) {
      blockUp = false;
    }
  } catch {
    blockUp = false;
  }

  if (
    config.sequencerUptimeFeedAddress &&
    /^0x[0-9a-fA-F]{40}$/.test(config.sequencerUptimeFeedAddress)
  ) {
    try {
      const [, answer, startedAt] = await client.readContract({
        address: config.sequencerUptimeFeedAddress as Hex,
        abi: SEQUENCER_FEED_ABI,
        functionName: "latestRoundData",
      });
      const feedUp = answer === 0n;
      const gracePassed = nowSec - Number(startedAt) > config.sequencerGracePeriodSeconds;
      const status: SequencerHealthStatus = {
        up: feedUp && blockUp,
        gracePeriodPassed: gracePassed,
        latestBlockAgeSeconds,
        source: "chainlink_l2_sequencer_feed+rpc_block",
      };
      seqCache.set(chainId, { expiresAt: Date.now() + 15_000, status });
      return status;
    } catch {
      // Fall back to RPC block liveness
    }
  }

  const status: SequencerHealthStatus = {
    up: blockUp,
    gracePeriodPassed: true,
    latestBlockAgeSeconds,
    source: "rpc_latest_block",
  };
  seqCache.set(chainId, { expiresAt: Date.now() + 15_000, status });
  return status;
}
