/**
 * I5 crosscheck of apps/api/src/services/url-scanner.ts (metadata URL fetch, enabled by default).
 * Offline: only a local HTTP server on 127.0.0.1.   tsx --test test/poc-url-scanner.test.ts
 *
 * [URL-1] DNS rebinding: a name validated as public that re-resolves to a private address must not be fetched.
 *         (Old code validated with dns.lookup and then let fetch() resolve again; verified by hand with
 *         127.0.0.1.nip.io + a first public answer: the internal server answered.)
 * [URL-2] fetch limits: no redirects, byte cap, overall timeout including a slow body.
 * [URL-3] only ports 80/443, no credentials in the URL, IPv6 literal handling.
 * [URL-4] reserved ranges: IPv4 TEST-NETs/benchmark, IPv6 mapped/compatible/NAT64/6to4/Teredo/ULA/link-local.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  createPinnedLookup,
  isPrivateOrReservedIp,
  normalizeAndValidateSafeUrl,
  safeFetch,
} from "../src/services/url-scanner.js";

let hits = 0;
let port = 0;
const server = http.createServer((req, res) => {
  hits += 1;
  if (req.url === "/redirect") {
    res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
    res.end();
    return;
  }
  if (req.url === "/big") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("A".repeat(50_000));
    return;
  }
  if (req.url === "/slow") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("start");
    return; // never ends
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end('{"name":"INTERNAL-SECRET"}');
});

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

describe("[URL-1] DNS rebinding is refused at connect time", () => {
  it("a hostname resolving to 127.0.0.1 at connect time never reaches the server", async () => {
    const before = hits;
    await assert.rejects(
      () =>
        safeFetch(`http://rebind.attacker.test:${port}/meta.json`, {
          timeoutMs: 2000,
          maxBytes: 1024,
          resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        }),
      (err: NodeJS.ErrnoException) => err.code === "ESSRF"
    );
    assert.equal(hits, before);
  });

  it("refuses when ANY returned record is private (mixed public + private answer)", async () => {
    const lookup = createPinnedLookup(async () => [
      { address: "93.184.215.14", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    const err = await new Promise<NodeJS.ErrnoException | null>((r) => lookup("x.test", { all: true }, (e) => r(e)));
    assert.equal(err?.code, "ESSRF");
  });

  it("passes public records through in both lookup call styles", async () => {
    const lookup = createPinnedLookup(async () => [{ address: "93.184.215.14", family: 4 }]);
    const all = await new Promise<unknown>((r) => lookup("x.test", { all: true }, (_e, a) => r(a)));
    assert.deepEqual(all, [{ address: "93.184.215.14", family: 4 }]);
    const single = await new Promise<unknown>((r) => lookup("x.test", {}, (_e, a) => r(a)));
    assert.equal(single, "93.184.215.14");
  });

  it("refuses a private IP literal even if called without prior validation", async () => {
    const before = hits;
    await assert.rejects(
      () => safeFetch(`http://127.0.0.1:${port}/`, { timeoutMs: 2000, maxBytes: 1024 }),
      (err: NodeJS.ErrnoException) => err.code === "ESSRF"
    );
    assert.equal(hits, before);
  });
});

describe("[URL-2] fetch limits", () => {
  const opts = { timeoutMs: 1500, maxBytes: 1024, unsafeAllowPrivateLiteralForTests: true };

  it("does not follow redirects (e.g. to the metadata service)", async () => {
    const r = await safeFetch(`http://127.0.0.1:${port}/redirect`, opts);
    assert.equal(r.status, 302);
    assert.equal(r.bytesRead, 0);
  });

  it("caps the body at maxBytes", async () => {
    const r = await safeFetch(`http://127.0.0.1:${port}/big`, opts);
    assert.equal(r.bytesRead, 1024);
    assert.equal(r.body.byteLength, 1024);
  });

  it("times out on a body that never ends", async () => {
    const t0 = Date.now();
    await assert.rejects(() => safeFetch(`http://127.0.0.1:${port}/slow`, { ...opts, timeoutMs: 400 }), /timed out/);
    assert.ok(Date.now() - t0 < 1500);
  });

  it("returns the body on the happy path", async () => {
    const r = await safeFetch(`http://127.0.0.1:${port}/meta.json`, opts);
    assert.equal(r.status, 200);
    assert.match(r.body.toString(), /INTERNAL-SECRET/);
  });
});

describe("[URL-3] URL validation", () => {
  for (const [url, why] of [
    ["http://example.com:25/", /non-standard port/],
    ["https://example.com:8443/", /non-standard port/],
    ["http://user:pass@example.com/", /Credentials/],
    ["http://[::1]/", /private\/reserved IP literal/],
    ["http://[::ffff:127.0.0.1]/", /private\/reserved IP literal/],
    ["http://[64:ff9b::a9fe:a9fe]/", /private\/reserved IP literal/],
    ["http://2130706433/", /private\/reserved IP literal/], // decimal 127.0.0.1
    ["http://0x7f.1/", /private\/reserved IP literal/],
    ["file:///etc/passwd", /Disallowed URL protocol/],
    ["http://metadata.google.internal/", /internal\/loopback hostname/],
  ] as const) {
    it(`refuses ${url}`, async () => {
      const r = await normalizeAndValidateSafeUrl(url);
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.reason, why);
    });
  }

  it("accepts a public IP literal on the default port", async () => {
    assert.deepEqual(await normalizeAndValidateSafeUrl("https://1.1.1.1/x.json"), { ok: true, fetchUrl: "https://1.1.1.1/x.json" });
  });
});

describe("[URL-4] reserved address ranges", () => {
  const blocked = [
    "0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1",
    "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::127.0.0.1", "64:ff9b::a9fe:a9fe",
    "64:ff9b:1::1", "100::1", "2001::1", "2001:db8::1", "2002:7f00:1::1", "fc00::1", "fd12:3456::1", "fe80::1",
    "fec0::1", "ff02::1", "fe80::1%eth0", "not-an-ip",
  ];
  const allowed = ["8.8.8.8", "93.184.215.14", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8"];
  for (const ip of blocked) it(`blocks ${ip}`, () => assert.equal(isPrivateOrReservedIp(ip), true));
  for (const ip of allowed) it(`allows ${ip}`, () => assert.equal(isPrivateOrReservedIp(ip), false));
});
