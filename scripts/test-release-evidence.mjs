import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import assuranceModule from "./lib/release-assurance.cjs";

const { fetchEvidence, isPrivateIp, publicHttpsTarget } = assuranceModule;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const body = Buffer.from("immutable release evidence\n", "utf8");
const digest = sha256(body);
const resolutions = new Map([
  ["evidence.example", [{ address: "1.1.1.1", family: 4 }]],
  ["cdn.example", [{ address: "8.8.8.8", family: 4 }]],
  ["mixed.example", [{ address: "1.1.1.1", family: 4 }, { address: "10.0.0.8", family: 4 }]],
  ["metadata.example", [{ address: "169.254.169.254", family: 4 }]],
]);
const lookup = async (hostname, options) => {
  assert.equal(options.all, true);
  assert.equal(options.verbatim, true);
  const answer = resolutions.get(hostname);
  if (!answer) throw new Error("NXDOMAIN");
  return answer;
};

const calls = [];
const result = await fetchEvidence("https://evidence.example/audit.txt", digest, "audit fixture", {
  lookup,
  download: async (target) => {
    calls.push({ hostname: target.hostname, addresses: target.addresses.map((entry) => entry.address) });
    if (target.hostname === "evidence.example") {
      return { status: 302, headers: { location: "https://cdn.example/final.txt" }, body: Buffer.alloc(0), pinnedAddress: target.addresses[0].address };
    }
    return {
      status: 200,
      headers: { "content-length": String(body.length) },
      body,
      pinnedAddress: target.addresses[0].address,
    };
  },
});
assert.equal(result.url, "https://cdn.example/final.txt");
assert.equal(result.sha256, digest);
assert.equal(result.bytes, body.length);
assert.equal(result.pinnedAddress, "8.8.8.8");
assert.deepEqual(calls, [
  { hostname: "evidence.example", addresses: ["1.1.1.1"] },
  { hostname: "cdn.example", addresses: ["8.8.8.8"] },
]);

for (const address of [
  "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1",
  "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1",
  "::", "::1", "::ffff:127.0.0.1", "64:ff9b::1", "2001:db8::1", "fc00::1", "fe80::1", "ff00::1",
]) assert.equal(isPrivateIp(address), true, `${address} must not be treated as public`);
for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) {
  assert.equal(isPrivateIp(address), false, `${address} should be treated as public`);
}

await assert.rejects(
  () => publicHttpsTarget("https://127.0.0.1/evidence", "literal", lookup),
  /non-public address/,
);
await assert.rejects(
  () => publicHttpsTarget("https://mixed.example/evidence", "mixed", lookup),
  /non-public address/,
);
await assert.rejects(
  () => publicHttpsTarget("http://evidence.example/evidence", "scheme", lookup),
  /credential-free HTTPS/,
);
await assert.rejects(
  () => publicHttpsTarget("https://user:secret@evidence.example/evidence", "credentials", lookup),
  /credential-free HTTPS/,
);
await assert.rejects(
  () => publicHttpsTarget("https://evidence.example:8443/evidence", "port", lookup),
  /standard HTTPS port/,
);
await assert.rejects(
  () => publicHttpsTarget("https://service.local/evidence", "local", lookup),
  /local host/,
);

let redirectRequests = 0;
await assert.rejects(() => fetchEvidence("https://evidence.example/start", digest, "private redirect", {
  lookup,
  download: async (target) => {
    redirectRequests += 1;
    return { status: 302, headers: { location: "https://metadata.example/latest" }, body: Buffer.alloc(0), pinnedAddress: target.addresses[0].address };
  },
}), /non-public address/);
assert.equal(redirectRequests, 1, "a private redirect target must be rejected before the second request");

await assert.rejects(() => fetchEvidence("https://evidence.example/start", digest, "scheme redirect", {
  lookup,
  download: async (target) => ({
    status: 302,
    headers: { location: "http://cdn.example/final" },
    body: Buffer.alloc(0),
    pinnedAddress: target.addresses[0].address,
  }),
}), /credential-free HTTPS/);

let loops = 0;
await assert.rejects(() => fetchEvidence("https://evidence.example/start", digest, "redirect loop", {
  lookup,
  download: async (target) => {
    loops += 1;
    return { status: 302, headers: { location: "/again" }, body: Buffer.alloc(0), pinnedAddress: target.addresses[0].address };
  },
}), /too many or invalid redirects/);
assert.equal(loops, 5);

await assert.rejects(() => fetchEvidence("https://evidence.example/large", digest, "oversized fixture", {
  lookup,
  download: async (target) => ({
    status: 200,
    headers: { "content-length": String(10 * 1024 * 1024 + 1) },
    body,
    pinnedAddress: target.addresses[0].address,
  }),
}), /exceeds/);
await assert.rejects(() => fetchEvidence("https://evidence.example/wrong", "0".repeat(64), "hash fixture", {
  lookup,
  download: async (target) => ({
    status: 200,
    headers: { "content-length": String(body.length) },
    body,
    pinnedAddress: target.addresses[0].address,
  }),
}), /SHA-256 does not match/);

if (process.env.RUN_LIVE_EVIDENCE_TESTS === "1") {
  const liveUrl = process.env.PERM_LIVE_EVIDENCE_URL
    || "https://raw.githubusercontent.com/wealthy-org/Perm/a008d8dd2a6933cbfe531baeba343ead9b9b6bd3/deployments/robinhood-testnet.json";
  const liveSha = process.env.PERM_LIVE_EVIDENCE_SHA256
    || "c890f4aaf6d9702e943dc458021a8446f8e5212d74afd8fa9e5d973a4b798a5b";
  const live = await fetchEvidence(liveUrl, liveSha, "live immutable evidence");
  assert.ok(live.bytes > 0);
  assert.match(live.pinnedAddress || "", /\S/);
  console.log(`Live evidence download: ${live.bytes} bytes verified through pinned address ${live.pinnedAddress}`);
}

console.log("Release evidence: pinned public DNS, redirect revalidation, byte limits, and SHA-256 verification fail closed");
