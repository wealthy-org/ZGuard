import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

/**
 * Best-effort client IP. On Vercel the platform sets `x-forwarded-for` (first hop = client) and
 * `x-real-ip`; locally we fall back to "local".
 */
export function clientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip")?.trim() || c.req.header("cf-connecting-ip")?.trim() || "local";
}

/** Constant-time string comparison for secrets (admin key). */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * In-memory fixed-window limiter for the GLOBAL per-IP budget. It is per serverless instance by
 * design (cheap, no DB round-trip on every request). Abuse-sensitive routes such as `/v1/register`
 * additionally use the store-backed limiter, which is shared across instances.
 */
export class MemoryRateLimiter {
  private readonly buckets = new Map<string, { windowStart: number; hits: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowSeconds: number
  ) {}

  hit(key: string, nowMs = Date.now()): { allowed: boolean; remaining: number; resetSec: number } {
    if (this.limit <= 0) return { allowed: true, remaining: Number.MAX_SAFE_INTEGER, resetSec: 0 };
    const nowSec = Math.floor(nowMs / 1000);
    const windowStart = nowSec - (nowSec % this.windowSeconds);
    const prev = this.buckets.get(key);
    const hits = prev && prev.windowStart === windowStart ? prev.hits + 1 : 1;
    this.buckets.set(key, { windowStart, hits });
    if (this.buckets.size > 20_000) {
      for (const [k, v] of this.buckets) if (v.windowStart < windowStart) this.buckets.delete(k);
    }
    return {
      allowed: hits <= this.limit,
      remaining: Math.max(0, this.limit - hits),
      resetSec: windowStart + this.windowSeconds - nowSec,
    };
  }
}

/**
 * Rolling latency recorder per route (last N samples). Exposed at `GET /v1/metrics` and as a
 * `Server-Timing` header so the brief's p95 < 800 ms target can actually be measured.
 */
export class LatencyRecorder {
  private readonly samples = new Map<string, number[]>();
  private readonly counts = new Map<string, { total: number; errors: number }>();
  private readonly startedAt = new Date().toISOString();

  constructor(private readonly maxSamples = 500) {}

  record(route: string, ms: number, status: number): void {
    const list = this.samples.get(route) ?? [];
    list.push(ms);
    if (list.length > this.maxSamples) list.shift();
    this.samples.set(route, list);
    const cnt = this.counts.get(route) ?? { total: 0, errors: 0 };
    cnt.total += 1;
    if (status >= 500) cnt.errors += 1;
    this.counts.set(route, cnt);
  }

  snapshot(): {
    scope: "per-instance";
    since: string;
    routes: Record<
      string,
      { count: number; errors5xx: number; window: number; p50Ms: number; p95Ms: number; p99Ms: number; maxMs: number }
    >;
  } {
    const routes: ReturnType<LatencyRecorder["snapshot"]>["routes"] = {};
    for (const [route, list] of this.samples) {
      const sorted = [...list].sort((a, b) => a - b);
      const pick = (p: number) =>
        sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]! : 0;
      const cnt = this.counts.get(route) ?? { total: 0, errors: 0 };
      routes[route] = {
        count: cnt.total,
        errors5xx: cnt.errors,
        window: sorted.length,
        p50Ms: Math.round(pick(0.5)),
        p95Ms: Math.round(pick(0.95)),
        p99Ms: Math.round(pick(0.99)),
        maxMs: Math.round(sorted[sorted.length - 1] ?? 0),
      };
    }
    return { scope: "per-instance", since: this.startedAt, routes };
  }
}

/** Routes that are free, read-only and contain no tenant data: safe for `Access-Control-Allow-Origin: *`. */
export function isPublicReadRoute(method: string, path: string): boolean {
  if (method !== "GET" && method !== "OPTIONS") return false;
  return (
    path === "/health" ||
    path === "/v1/config" ||
    path === "/v1/registry" ||
    path === "/v1/metrics" ||
    path.startsWith("/v1/token/") ||
    path.startsWith("/v1/attestation/")
  );
}

/** Normalizes a concrete path to a route label for metrics (no unbounded cardinality). */
export function routeLabel(path: string): string {
  if (path.startsWith("/v1/token/")) return "/v1/token/:chainId/:address";
  if (path.startsWith("/v1/attestation/")) return "/v1/attestation/:decisionId";
  return path;
}
