import dns from "node:dns/promises";
import net from "node:net";
import { scanContent, type ContentCheckResult, type ContentInput } from "@zguard/sdk";
import type { ZGuardAppConfig } from "../config.js";

function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("::ffff:")) {
      return isPrivateOrReservedIp(lower.slice(7));
    }
    return false;
  }
  return true;
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

  const host = parsed.hostname.toLowerCase();
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
    const resp = await fetch(urlCheck.fetchUrl, {
      redirect: "manual",
      headers: {
        Accept: "application/json, text/plain, text/html;q=0.8",
        "User-Agent": "ZGuard-MetadataScanner/0.1",
      },
      signal: AbortSignal.timeout(config.urlFetchTimeoutMs),
    });

    if (!resp.ok) {
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

    // Read up to `urlFetchMaxBytes` bytes from response stream
    const reader = resp.body?.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    if (reader) {
      while (totalBytes < config.urlFetchMaxBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const slice =
          totalBytes + value.byteLength > config.urlFetchMaxBytes
            ? value.subarray(0, config.urlFetchMaxBytes - totalBytes)
            : value;
        chunks.push(slice);
        totalBytes += slice.byteLength;
        if (totalBytes >= config.urlFetchMaxBytes) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");
    const contentType = resp.headers.get("content-type") ?? "";
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
