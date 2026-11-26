import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { LookupAddress } from "node:dns";
import { scanContent, type ContentCheckResult, type ContentInput } from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";

/** Only the default web ports: the scanner must not become a port scanner for other services ([URL-3]). */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol assignments, TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast / reserved / broadcast
  return false;
}

/** Expands an IPv6 literal (with optional embedded dotted IPv4 tail) into 8 hextets; null when invalid. */
function ipv6Hextets(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (dotted) {
    const v4 = dotted[1]!.split(".").map(Number);
    if (v4.some((p) => p > 255)) return null;
    addr = addr.slice(0, -dotted[1]!.length) + `${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const out = all.map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return out.length === 8 && out.every((n) => Number.isFinite(n)) ? out : null;
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateOrReservedIpv4(ip);
  if (family !== 6) return true;
  const h = ipv6Hextets(ip);
  if (!h) return true;
  const v4of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const zero = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);
  if (zero(0, 8)) return true; // ::
  if (zero(0, 7) && h[7] === 1) return true; // ::1
  if (zero(0, 5) && h[5] === 0xffff) return isPrivateOrReservedIpv4(v4of(h[6]!, h[7]!)); // ::ffff:a.b.c.d
  if (zero(0, 6)) return true; // IPv4-compatible ::a.b.c.d (deprecated)
  if (h[0] === 0x64 && h[1] === 0xff9b) return true; // NAT64 64:ff9b::/96 and 64:ff9b:1::/48
  if (h[0] === 0x100 && zero(1, 4)) return true; // discard-only 100::/64
  if (h[0] === 0x2001 && (h[1] === 0 || h[1] === 0xdb8)) return true; // Teredo, documentation
  if (h[0] === 0x2002) return true; // 6to4 (embeds an arbitrary IPv4)
  if ((h[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0]! & 0xffc0) === 0xfe80 || (h[0]! & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((h[0]! & 0xff00) === 0xff00) return true; // multicast
  return false;
}

export async function normalizeAndValidateSafeUrl(
  rawUrl: string
): Promise<{ ok: true; fetchUrl: string } | { ok: false; reason: string }> {
  const trimmed = rawUrl.trim();
  const normalized = trimmed.startsWith("ipfs://")
    ? `https://ipfs.io/ipfs/${trimmed.slice("ipfs://".length).replace(/^ipfs\//, "")}`
    : trimmed;

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { ok: false, reason: "Invalid URL syntax" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: `Disallowed URL protocol ${parsed.protocol}` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: "Credentials in URL are not allowed" };
  }
  if (!ALLOWED_PORTS.has(parsed.port)) {
    return { ok: false, reason: `Blocked non-standard port ${parsed.port} (SSRF protection)` };
  }

  // WHATWG URL keeps IPv6 literals in brackets: "[::1]".
  const host = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return { ok: false, reason: "Blocked internal/loopback hostname (SSRF protection)" };
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      return { ok: false, reason: "Blocked private/reserved IP literal (SSRF protection)" };
    }
    return { ok: true, fetchUrl: parsed.toString() };
  }

  try {
    const records = await dns.lookup(host, { all: true });
    if (records.length === 0) {
      return { ok: false, reason: "DNS resolution returned no records" };
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        return {
          ok: false,
          reason: `Hostname ${host} resolved to private/reserved IP (SSRF protection)`,
        };
      }
    }
  } catch {
    return { ok: false, reason: `DNS lookup failed for ${host}` };
  }

  return { ok: true, fetchUrl: parsed.toString() };
}

export type HostResolver = (hostname: string) => Promise<LookupAddress[]>;
const systemResolver: HostResolver = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

/**
 * [URL-1] DNS-rebinding guard: the address is re-validated inside the socket's own lookup, i.e. the exact
 * address the connection uses. A name that passed normalizeAndValidateSafeUrl and then re-resolves to a
 * private address (TTL 0) is refused here, before any byte is sent.
 */
export function createPinnedLookup(resolve: HostResolver = systemResolver) {
  return (
    hostname: string,
    options: { all?: boolean } | number | undefined,
    callback: (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void
  ) => {
    resolve(hostname).then(
      (records) => {
        const bad = records.find((r) => isPrivateOrReservedIp(r.address));
        if (records.length === 0 || bad) {
          const err = new Error(
            `Hostname ${hostname} resolved to private/reserved IP${bad ? ` ${bad.address}` : ""} at connect time (SSRF protection)`
          ) as NodeJS.ErrnoException;
          err.code = "ESSRF";
          callback(err);
          return;
        }
        if (typeof options === "object" && options?.all) callback(null, records);
        else callback(null, records[0]!.address, records[0]!.family);
      },
      (err: NodeJS.ErrnoException) => callback(err)
    );
  };
}

export interface SafeFetchResult {
  status: number;
  contentType: string;
  body: Buffer;
  bytesRead: number;
}

/**
 * GET with: pinned + re-validated DNS ([URL-1]), no redirects, default ports only, overall timeout covering
 * the body ([URL-2]), byte cap, and no transparent decompression (the cap counts real bytes).
 */
export function safeFetch(
  url: string,
  opts: { timeoutMs: number; maxBytes: number; resolve?: HostResolver; unsafeAllowPrivateLiteralForTests?: boolean }
): Promise<SafeFetchResult> {
  return new Promise((resolvePromise, reject) => {
    const target = new URL(url);
    const literal = target.hostname.replace(/^\[(.*)\]$/, "$1");
    // IP literals never reach the lookup hook, so they are checked here too (defence in depth).
    if (net.isIP(literal) && isPrivateOrReservedIp(literal) && !opts.unsafeAllowPrivateLiteralForTests) {
      const err = new Error(`Blocked private/reserved IP literal ${literal} (SSRF protection)`) as NodeJS.ErrnoException;
      err.code = "ESSRF";
      reject(err);
      return;
    }
    const lib = target.protocol === "https:" ? https : http;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = lib.request(
      target,
      {
        method: "GET",
        lookup: createPinnedLookup(opts.resolve) as never,
        headers: {
          Accept: "application/json, text/plain, text/html;q=0.8",
          "Accept-Encoding": "identity",
          "User-Agent": "ZGuard-MetadataScanner/0.1",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status < 200 || status >= 300) {
          res.resume();
          req.destroy();
          done(() => resolvePromise({ status, contentType, body: Buffer.alloc(0), bytesRead: 0 }));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          const room = opts.maxBytes - total;
          if (room <= 0) return;
          const slice = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
          chunks.push(slice);
          total += slice.byteLength;
          if (total >= opts.maxBytes) {
            req.destroy();
            done(() => resolvePromise({ status, contentType, body: Buffer.concat(chunks), bytesRead: total }));
          }
        });
        res.on("end", () => done(() => resolvePromise({ status, contentType, body: Buffer.concat(chunks), bytesRead: total })));
        res.on("error", (err) => done(() => reject(err)));
      }
    );
    const timer = setTimeout(() => {
      req.destroy(new Error(`URL fetch timed out after ${opts.timeoutMs} ms`));
    }, opts.timeoutMs);
    req.on("error", (err) => done(() => reject(err)));
    req.end();
  });
}

function extractScannableTextFromFetchedBody(rawText: string, contentType: string): {
  extractedText: string;
  extractedName?: string;
  extractedSymbol?: string;
} {
  const trimmed = rawText.trim();
  if (contentType.includes("json") || trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const pieces: string[] = [];
      for (const key of ["name", "symbol", "description", "external_url", "image", "prompt"]) {
        if (typeof obj[key] === "string") pieces.push(obj[key] as string);
      }
      if (Array.isArray(obj.attributes)) {
        for (const attr of obj.attributes) {
          if (attr && typeof attr === "object") {
            const rec = attr as Record<string, unknown>;
            if (typeof rec.trait_type === "string") pieces.push(rec.trait_type);
            if (typeof rec.value === "string") pieces.push(rec.value);
          }
        }
      }
      return {
        extractedText: pieces.length > 0 ? pieces.join(" | ") : trimmed.slice(0, 8_000),
        extractedName: typeof obj.name === "string" ? obj.name : undefined,
        extractedSymbol: typeof obj.symbol === "string" ? obj.symbol : undefined,
      };
    } catch {
      // Treat as plain text below
    }
  }

  // Strip HTML tags while KEEPING hidden text & HTML comments (since attackers hide prompt injections in comments/hidden spans!)
  const stripped = rawText
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { extractedText: stripped.slice(0, 12_000) };
}

/**
 * Scans inline text/metadata AND optionally fetches `content.url` (tokenURI JSON / webpage) with strict
 * SSRF protection, size cap, and Dev Brief §2.2 billing rule:
 * "Setiap tautan metadata yang dipindai: $0,005 (tautan gagal/ditolak: gratis)" -> sets `waivedCharge: true`
 * when a URL-only scan fails or is SSRF-rejected!
 */
export async function scanContentWithRemoteUrl(
  config: ZGuardAppConfig,
  input: ContentInput | undefined,
  canonicalTickerMap: Record<string, string>
): Promise<{ result: ContentCheckResult; waiveCharge: boolean }> {
  if (!input) {
    return {
      result: { decision: "allow", verdict: "unchecked", codes: [] },
      waiveCharge: false,
    };
  }

  const hasInlineContent = Boolean(
    (input.text && input.text.trim()) ||
      (input.name && input.name.trim()) ||
      (input.symbol && input.symbol.trim())
  );

  if (!input.url || !config.enableUrlFetch) {
    return {
      result: scanContent(input, canonicalTickerMap),
      waiveCharge: false,
    };
  }

  const urlCheck = await normalizeAndValidateSafeUrl(input.url);
  if (!urlCheck.ok) {
    // SSRF-protected URL scan blocked: return fail-closed deny with C-SSRF code (§2.2 & §6.4)
    const base = scanContent(input, canonicalTickerMap);
    const codes = ["C-SSRF" as const, ...base.codes];
    const waiveCharge = !hasInlineContent;
    if (!hasInlineContent && base.verdict !== "findings") {
      return {
        result: {
          decision: "deny",
          verdict: "blocked",
          codes,
          findings: base.findings,
          urlFetch: {
            url: input.url,
            fetched: false,
            httpStatus: null,
            blockedReason: urlCheck.reason,
            waivedCharge: true,
          },
        },
        waiveCharge: true,
      };
    }
    return {
      result: {
        decision: "deny",
        verdict: base.verdict === "findings" ? "findings" : "blocked",
        codes,
        findings: base.findings,
        urlFetch: {
          url: input.url,
          fetched: false,
          httpStatus: null,
          blockedReason: urlCheck.reason,
          waivedCharge: waiveCharge,
        },
      },
      waiveCharge,
    };
  }

  try {
    const resp = await safeFetch(urlCheck.fetchUrl, {
      timeoutMs: config.urlFetchTimeoutMs,
      maxBytes: config.urlFetchMaxBytes,
    });

    if (resp.status < 200 || resp.status >= 300) {
      const base = scanContent(input, canonicalTickerMap);
      const waiveCharge = !hasInlineContent;
      return {
        result: {
          decision: base.verdict === "findings" ? "deny" : hasInlineContent ? base.decision : "abstain",
          verdict: base.verdict === "findings" ? "findings" : hasInlineContent ? base.verdict : "unchecked",
          codes: base.codes,
          findings: base.findings,
          urlFetch: {
            url: input.url,
            fetched: false,
            httpStatus: resp.status,
            blockedReason: `Remote URL returned HTTP ${resp.status}`,
            waivedCharge: waiveCharge,
          },
        },
        waiveCharge,
      };
    }

    const totalBytes = resp.bytesRead;
    const rawBody = resp.body.toString("utf8");
    const contentType = resp.contentType;
    const extracted = extractScannableTextFromFetchedBody(rawBody, contentType);

    const combinedText = [input.text, extracted.extractedText].filter(Boolean).join("\n");
    const mergedScan = scanContent(
      {
        text: combinedText,
        url: input.url,
        name: input.name ?? extracted.extractedName,
        symbol: input.symbol ?? extracted.extractedSymbol,
        tokenAddress: input.tokenAddress,
      },
      canonicalTickerMap
    );

    return {
      result: {
        ...mergedScan,
        urlFetch: {
          url: input.url,
          fetched: true,
          httpStatus: resp.status,
          bytesRead: totalBytes,
          waivedCharge: false,
        },
      },
      waiveCharge: false,
    };
  } catch (err) {
    const base = scanContent(input, canonicalTickerMap);
    if ((err as NodeJS.ErrnoException | undefined)?.code === "ESSRF") {
      // Rebinding caught at connect time: same fail-closed deny as a URL rejected up front.
      const waiveCharge = !hasInlineContent;
      return {
        result: {
          decision: "deny",
          verdict: base.verdict === "findings" ? "findings" : "blocked",
          codes: ["C-SSRF" as const, ...base.codes],
          findings: base.findings,
          urlFetch: {
            url: input.url,
            fetched: false,
            httpStatus: null,
            blockedReason: (err as Error).message,
            waivedCharge: waiveCharge,
          },
        },
        waiveCharge,
      };
    }
    const waiveCharge = !hasInlineContent;
    return {
      result: {
        decision: base.verdict === "findings" ? "deny" : hasInlineContent ? base.decision : "abstain",
        verdict: base.verdict === "findings" ? "findings" : hasInlineContent ? base.verdict : "unchecked",
        codes: base.codes,
        findings: base.findings,
        urlFetch: {
          url: input.url,
          fetched: false,
          httpStatus: null,
          blockedReason: err instanceof Error ? err.message : "URL fetch failed",
          waivedCharge: waiveCharge,
        },
      },
      waiveCharge,
    };
  }
}
