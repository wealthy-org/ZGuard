import assert from "node:assert/strict";
import { assessIndexerFreshness, indexerFreshnessLimits } from "../lib/server/indexer-health";

const hash = `0x${"12".repeat(32)}`;
const now = Date.parse("2026-11-17T10:00:00.000Z");
const limits = { maxBlockLag: 5_000n, maxUpdatedLagSeconds: 1_800 };

const healthy = assessIndexerFreshness({
  lastIndexedBlock: "99500",
  lastIndexedBlockHash: hash,
  updatedAt: "2026-11-17T09:55:00.000Z",
}, 100_000n, limits, now);
assert.equal(healthy.healthy, true);
assert.equal(healthy.blockLag, "500");
assert.equal(healthy.updatedLagSeconds, 300);

const staleBlock = assessIndexerFreshness({
  lastIndexedBlock: "90000",
  lastIndexedBlockHash: hash,
  updatedAt: "2026-11-17T09:55:00.000Z",
}, 100_000n, limits, now);
assert.equal(staleBlock.healthy, false);
assert.equal(staleBlock.freshByBlock, false);
assert(staleBlock.reasons.includes("block-lag-exceeded"));

const staleTime = assessIndexerFreshness({
  lastIndexedBlock: "99500",
  lastIndexedBlockHash: hash,
  updatedAt: "2026-11-17T09:00:00.000Z",
}, 100_000n, limits, now);
assert.equal(staleTime.healthy, false);
assert.equal(staleTime.freshByTime, false);
assert(staleTime.reasons.includes("update-time-lag-exceeded"));

const ahead = assessIndexerFreshness({
  lastIndexedBlock: "100001",
  lastIndexedBlockHash: hash,
  updatedAt: "2026-11-17T09:59:59.000Z",
}, 100_000n, limits, now);
assert.equal(ahead.healthy, false);
assert(ahead.reasons.includes("cursor-ahead-of-chain"));

const malformed = assessIndexerFreshness({
  lastIndexedBlock: "NaN",
  lastIndexedBlockHash: "0x1234",
  updatedAt: "invalid",
}, 100_000n, limits, now);
assert.equal(malformed.healthy, false);
assert(malformed.reasons.includes("missing-or-invalid-cursor"));
assert(malformed.reasons.includes("missing-or-invalid-cursor-hash"));
assert(malformed.reasons.includes("missing-invalid-or-future-update-time"));

assert.deepEqual(indexerFreshnessLimits({}, true), { maxBlockLag: 5_000n, maxUpdatedLagSeconds: 1_800 });
assert.deepEqual(indexerFreshnessLimits({}, false), { maxBlockLag: 300n, maxUpdatedLagSeconds: 900 });
assert.deepEqual(indexerFreshnessLimits({
  PERM_HEALTH_MAX_INDEXER_BLOCK_LAG: "25",
  PERM_HEALTH_MAX_INDEXER_TIME_LAG_SECONDS: "60",
}, true), { maxBlockLag: 25n, maxUpdatedLagSeconds: 60 });
assert.throws(() => indexerFreshnessLimits({ PERM_HEALTH_MAX_INDEXER_BLOCK_LAG: "Infinity" }, true), /must be an integer/);
assert.throws(() => indexerFreshnessLimits({ PERM_HEALTH_MAX_INDEXER_TIME_LAG_SECONDS: "0" }, true), /must be between/);

console.log("Indexer health: cursor syntax, canonical bounds, block freshness, time freshness, and bounded thresholds fail closed");
