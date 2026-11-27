import type { ZGuardGuardRequest } from "@/lib/zguard/request";

/**
 * Server-side ZGuard settings. The API key never reaches the browser.
 *
 *   PERM_ZGUARD_MODE     enforce (default) | off
 *                        Anything other than the exact string "off" means enforce (fail-closed).
 *                        "off" makes the trade page show a red "unguarded" banner.
 *   PERM_ZGUARD_API_URL  ZGuard API base URL (default https://zguard-delta.vercel.app)
 *   PERM_ZGUARD_API_KEY  zg_live_… key with credit (POST /v1/register on ZGuard)
 *   PERM_ZGUARD_TIMEOUT_MS  upstream timeout, 2000–30000 (default 15000)
 */
export type ZGuardMode = "enforce" | "off";

export type ZGuardServerConfig = {
  mode: ZGuardMode;
  apiUrl: string;
  apiKey: string | undefined;
  timeoutMs: number;
  /** enforce mode with a usable key and URL */
  ready: boolean;
  problem?: string;
};

const DEFAULT_API_URL = "https://zguard-delta.vercel.app";

export function zguardServerConfig(env: Record<string, string | undefined> = process.env): ZGuardServerConfig {
  const mode: ZGuardMode = env.PERM_ZGUARD_MODE?.trim() === "off" ? "off" : "enforce";
  const rawUrl = (env.PERM_ZGUARD_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, "");
  const apiKey = env.PERM_ZGUARD_API_KEY?.trim() || undefined;
  const rawTimeout = Number(env.PERM_ZGUARD_TIMEOUT_MS ?? "15000");
  const timeoutMs = Number.isSafeInteger(rawTimeout) ? Math.min(30_000, Math.max(2_000, rawTimeout)) : 15_000;

  let problem: string | undefined;
  let apiUrl = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) problem = "PERM_ZGUARD_API_URL must use https";
    apiUrl = parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    problem = "PERM_ZGUARD_API_URL is not a valid URL";
  }
  if (!problem && !apiKey) problem = "PERM_ZGUARD_API_KEY is not set";
  if (!problem && apiKey && !/^zg_[A-Za-z0-9_]{8,200}$/.test(apiKey)) problem = "PERM_ZGUARD_API_KEY has an invalid format";

  return { mode, apiUrl, apiKey, timeoutMs, ready: mode === "enforce" && !problem, problem: mode === "enforce" ? problem : undefined };
}

export type ZGuardUpstreamResult =
  | { ok: true; receipt: unknown }
  | { ok: false; status: number; error: string };

/** Calls ZGuard POST /v1/guard. Every failure is returned as an error (the caller fails closed). */
export async function callZGuard(
  config: ZGuardServerConfig,
  request: ZGuardGuardRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ZGuardUpstreamResult> {
  if (!config.ready || !config.apiKey) return { ok: false, status: 503, error: config.problem || "ZGuard is not configured" };
  let response: Response;
  try {
    response = await fetchImpl(`${config.apiUrl}/v1/guard`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}`, "user-agent": "Perm/2.0 zguard-gate" },
      body: JSON.stringify(request),
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    return { ok: false, status: 503, error: "ZGuard is unreachable" };
  }
  if (response.status === 402) return { ok: false, status: 503, error: "ZGuard credit for this Perm deployment is exhausted" };
  if (response.status === 401 || response.status === 403) return { ok: false, status: 503, error: "ZGuard rejected the Perm API key" };
  if (response.status === 429) return { ok: false, status: 429, error: "ZGuard rate limit reached; retry shortly" };
  if (!response.ok) return { ok: false, status: 503, error: `ZGuard returned HTTP ${response.status}` };
  try {
    const receipt = await response.json();
    if (!receipt || typeof receipt !== "object" || typeof (receipt as { decision?: unknown }).decision !== "string") {
      return { ok: false, status: 503, error: "ZGuard returned an invalid verdict" };
    }
    return { ok: true, receipt };
  } catch {
    return { ok: false, status: 503, error: "ZGuard returned an invalid verdict" };
  }
}
