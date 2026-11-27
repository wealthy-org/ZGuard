import assert from "node:assert/strict";
import type { NextRequest } from "next/server";
import {
  RequestBodyTooLargeError,
  boundedEnvironmentInteger,
  consumeRateLimit,
  readJsonBody,
  requestIdentity,
  ttlCached,
} from "../lib/server/runtime";

function requestWithChunks(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return { headers: new Headers(headers), body } as unknown as NextRequest;
}

async function main() {
const settingName = "PERM_TEST_BOUNDED_INTEGER";
delete process.env[settingName];
assert.equal(boundedEnvironmentInteger(settingName, 12, 1, 100), 12);
process.env[settingName] = "42";
assert.equal(boundedEnvironmentInteger(settingName, 12, 1, 100), 42);
process.env[settingName] = "-1";
assert.throws(() => boundedEnvironmentInteger(settingName, 12, 1, 100), /must be an integer/);
process.env[settingName] = "101";
assert.throws(() => boundedEnvironmentInteger(settingName, 12, 1, 100), /must be between/);
delete process.env[settingName];

const encoder = new TextEncoder();
const parsed = await readJsonBody(requestWithChunks([
  encoder.encode('{"amount"'),
  encoder.encode(':"100"}'),
], { "content-type": "application/json" }), 64) as { amount: string };
assert.deepEqual(parsed, { amount: "100" });

await assert.rejects(
  readJsonBody(requestWithChunks([encoder.encode('{"x":"'), encoder.encode("a".repeat(80)), encoder.encode('"}')]), 32),
  RequestBodyTooLargeError,
);
await assert.rejects(
  readJsonBody(requestWithChunks([encoder.encode("{}")], { "content-length": "999" }), 32),
  RequestBodyTooLargeError,
);
await assert.rejects(
  readJsonBody(requestWithChunks([encoder.encode("not-json")]), 32),
  SyntaxError,
);

const identityRequest = {
  headers: new Headers({
    "x-vercel-forwarded-for": "not-an-ip",
    "cf-connecting-ip": "203.0.113.8",
    "x-forwarded-for": "198.51.100.7",
  }),
} as unknown as NextRequest;
assert.equal(requestIdentity(identityRequest), "203.0.113.8");
const invalidIdentity = { headers: new Headers({ "x-forwarded-for": "x".repeat(600) }) } as unknown as NextRequest;
assert.equal(requestIdentity(invalidIdentity), "anonymous");

const rateKey = `runtime-test:${crypto.randomUUID()}`;
assert.equal((await consumeRateLimit(rateKey, 1, 0.01)).allowed, true);
const limited = await consumeRateLimit(rateKey, 1, 0.01);
assert.equal(limited.allowed, false);
assert(limited.retryAfter >= 1);

let loads = 0;
const cacheKey = `runtime-test:${crypto.randomUUID()}`;
const loader = async () => {
  loads += 1;
  await new Promise((resolve) => setTimeout(resolve, 10));
  return { ok: true };
};
const [first, second] = await Promise.all([
  ttlCached(cacheKey, 1_000, loader),
  ttlCached(cacheKey, 1_000, loader),
]);
assert.deepEqual(first, { ok: true });
assert.strictEqual(first, second);
assert.equal(loads, 1);
assert.strictEqual(await ttlCached(cacheKey, 1_000, loader), first);
assert.equal(loads, 1);
await assert.rejects(ttlCached("x".repeat(1_025), 1_000, loader), /Invalid cache request/);

console.log("Server runtime: bounded settings, streamed body cap, proxy identity validation, token bucket, and cache coalescing passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
