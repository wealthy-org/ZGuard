export type IndexerCursorHealth = {
  lastIndexedBlock?: string | null;
  lastIndexedBlockHash?: string | null;
  updatedAt?: string | null;
};

export type IndexerFreshnessLimits = {
  maxBlockLag: bigint;
  maxUpdatedLagSeconds: number;
};

function boundedEnvironmentInteger(
  environment: { [key: string]: string | undefined },
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = environment[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

/**
 * Hosted staging tolerates one delayed five-minute indexing interval. A release
 * uses the stricter defaults unless the operator supplies lower bounded values.
 */
export function indexerFreshnessLimits(
  environment: { [key: string]: string | undefined } = process.env,
  nonReleaseStaging = false,
): IndexerFreshnessLimits {
  return {
    maxBlockLag: BigInt(boundedEnvironmentInteger(
      environment,
      "PERM_HEALTH_MAX_INDEXER_BLOCK_LAG",
      nonReleaseStaging ? 5_000 : 300,
      0,
      1_000_000,
    )),
    maxUpdatedLagSeconds: boundedEnvironmentInteger(
      environment,
      "PERM_HEALTH_MAX_INDEXER_TIME_LAG_SECONDS",
      nonReleaseStaging ? 1_800 : 900,
      1,
      86_400,
    ),
  };
}

export function assessIndexerFreshness(
  cursor: IndexerCursorHealth | null | undefined,
  latestBlockNumber: bigint,
  limits: IndexerFreshnessLimits,
  nowMs = Date.now(),
) {
  const reasons: string[] = [];
  const rawBlock = cursor?.lastIndexedBlock;
  const blockValid = typeof rawBlock === "string" && /^\d+$/.test(rawBlock);
  const indexedBlock = blockValid ? BigInt(rawBlock) : null;
  const cursorNotAhead = indexedBlock !== null && indexedBlock <= latestBlockNumber;
  const blockLag = cursorNotAhead ? latestBlockNumber - indexedBlock : null;
  const updatedAtMs = typeof cursor?.updatedAt === "string" ? Date.parse(cursor.updatedAt) : Number.NaN;
  const timestampValid = Number.isFinite(updatedAtMs) && updatedAtMs <= nowMs + 60_000;
  const updatedLagSeconds = timestampValid ? Math.max(0, Math.floor((nowMs - updatedAtMs) / 1_000)) : null;
  const hashPresent = typeof cursor?.lastIndexedBlockHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(cursor.lastIndexedBlockHash);
  const freshByBlock = blockLag !== null && blockLag <= limits.maxBlockLag;
  const freshByTime = updatedLagSeconds !== null && updatedLagSeconds <= limits.maxUpdatedLagSeconds;

  if (!blockValid) reasons.push("missing-or-invalid-cursor");
  else if (!cursorNotAhead) reasons.push("cursor-ahead-of-chain");
  else if (!freshByBlock) reasons.push("block-lag-exceeded");
  if (!timestampValid) reasons.push("missing-invalid-or-future-update-time");
  else if (!freshByTime) reasons.push("update-time-lag-exceeded");
  if (!hashPresent) reasons.push("missing-or-invalid-cursor-hash");

  return {
    healthy: reasons.length === 0,
    blockLag: blockLag?.toString() ?? null,
    updatedLagSeconds,
    maxBlockLag: limits.maxBlockLag.toString(),
    maxUpdatedLagSeconds: limits.maxUpdatedLagSeconds,
    freshByBlock,
    freshByTime,
    cursorNotAhead,
    hashPresent,
    reasons,
  };
}
