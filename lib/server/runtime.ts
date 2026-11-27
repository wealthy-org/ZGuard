import { createHash } from "node:crypto";
import { isIP } from "node:net";
import postgres, { type Sql } from "postgres";
import type { NextRequest } from "next/server";

type Bucket = { tokens: number; updatedAt: number };
type GlobalRuntime = typeof globalThis & { __permRateLimitSql?: Sql };
const rateLimitConnectionString = process.env.PERM_RATE_LIMIT_DATABASE_URL
  || process.env.DATABASE_URL
  || process.env.PERM_INDEXER_DATABASE_URL;
const requireSharedRateLimit = process.env.PERM_REQUIRE_SHARED_RATE_LIMIT === "1";
const buckets = new Map<string, Bucket>();
const cache = new Map<string, { expiresAt: number; value: unknown }>();
const pendingCache = new Map<string, Promise<unknown>>();
const MAX_BUCKETS = 10_000;
const MAX_CACHE_ENTRIES = 2_000;
const MAX_PENDING_LOADS = 1_000;

export class RequestBodyTooLargeError extends Error {}
export class SharedRateLimitUnavailableError extends Error {}

function rateLimitDatabase() {
  if (!rateLimitConnectionString) return undefined;
  const global = globalThis as GlobalRuntime;
  global.__permRateLimitSql ??= postgres(rateLimitConnectionString, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: process.env.PGSSLMODE === "disable" ? false : "require",
  });
  return global.__permRateLimitSql;
}

export function boundedEnvironmentInteger(name: string, fallback: number, minimum: number, maximum: number) {
  if (!name || !Number.isSafeInteger(fallback) || !Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum)
    || minimum > fallback || fallback > maximum) throw new Error("Invalid bounded setting definition");
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export async function readJsonBody(request: NextRequest, maxBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid body limit");
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new RequestBodyTooLargeError();
  if (!request.body) throw new SyntaxError("Missing JSON body");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel("request body too large");
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function firstValidIp(value: string | null) {
  if (!value || value.length > 512) return undefined;
  for (const item of value.split(",").slice(0, 8)) {
    const candidate = item.trim().replace(/^\[|\]$/g, "");
    if (candidate.length <= 45 && isIP(candidate)) return candidate;
  }
  return undefined;
}

export function requestIdentity(request: NextRequest) {
  // Hosting proxies overwrite these headers. Invalid/unbounded caller values collapse
  // to one anonymous bucket instead of creating attacker-controlled map keys.
  return firstValidIp(request.headers.get("x-vercel-forwarded-for"))
    || firstValidIp(request.headers.get("cf-connecting-ip"))
    || firstValidIp(request.headers.get("x-real-ip"))
    || firstValidIp(request.headers.get("x-forwarded-for"))
    || "anonymous";
}

function pruneBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > 10 * 60_000) buckets.delete(key);
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

function consumeLocalRateLimit(key: string, capacity: number, refillPerSecond: number) {
  const now = Date.now();
  const previous = buckets.get(key) || { tokens: capacity, updatedAt: now };
  const elapsed = Math.max(0, now - previous.updatedAt) / 1_000;
  const tokens = Math.min(capacity, previous.tokens + elapsed * refillPerSecond);
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) pruneBuckets(now);
  // Refresh insertion order so hard-cap eviction removes the least-recently-used bucket.
  buckets.delete(key);
  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((1 - tokens) / refillPerSecond)) };
  }
  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { allowed: true, retryAfter: 0 };
}

/**
 * Uses the PostgreSQL token bucket when configured so all serverless instances
 * share one limit. Local memory is intentionally a development fallback only;
 * PERM_REQUIRE_SHARED_RATE_LIMIT=1 makes production fail closed.
 */
export async function consumeRateLimit(key: string, capacity: number, refillPerSecond: number) {
  if (!key || key.length > 1_024 || !Number.isFinite(capacity) || capacity < 1
      || !Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
    throw new Error("Invalid rate-limit configuration");
  }

  const sql = rateLimitDatabase();
  if (sql) {
    const keyHash = createHash("sha256").update(key).digest("hex");
    try {
      const rows = await sql<Array<{ allowed: boolean; retry_after: number | string }>>`
        SELECT allowed,retry_after
        FROM perm_consume_rate_limit(${keyHash},${capacity},${refillPerSecond})
      `;
      const row = rows[0];
      if (!row || typeof row.allowed !== "boolean") throw new Error("Shared rate limiter returned no result");
      return { allowed: row.allowed, retryAfter: Math.max(0, Number(row.retry_after)) };
    } catch (cause) {
      console.error("[shared-rate-limit]", cause);
      if (requireSharedRateLimit) throw new SharedRateLimitUnavailableError("Shared request protection is unavailable");
    }
  } else if (requireSharedRateLimit) {
    throw new SharedRateLimitUnavailableError("Shared request protection is not configured");
  }

  return consumeLocalRateLimit(key, capacity, refillPerSecond);
}

function pruneCache(now: number) {
  for (const [key, item] of cache) if (item.expiresAt <= now) cache.delete(key);
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export async function ttlCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  if (!key || key.length > 1_024 || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Invalid cache request");
  const existing = cache.get(key);
  if (existing && existing.expiresAt > Date.now()) return existing.value as T;
  const pending = pendingCache.get(key);
  if (pending) return pending as Promise<T>;
  if (pendingCache.size >= MAX_PENDING_LOADS) throw new Error("Server cache is saturated");
  const loading = loader().then((value) => {
    const now = Date.now();
    if (!cache.has(key) && cache.size >= MAX_CACHE_ENTRIES) pruneCache(now);
    cache.delete(key);
    cache.set(key, { expiresAt: now + ttlMs, value });
    return value;
  }).finally(() => pendingCache.delete(key));
  pendingCache.set(key, loading);
  return loading;
}

export function safeServerError(scope: string, cause: unknown, fallback: string) {
  console.error(`[${scope}]`, cause);
  return fallback;
}
