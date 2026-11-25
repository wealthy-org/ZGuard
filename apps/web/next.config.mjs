/** @type {import('next').NextConfig} */

/**
 * API proxy (gap C3).
 *
 * - Local dev: falls back to http://127.0.0.1:8787.
 * - Vercel: ZGUARD_INTERNAL_API_URL (e.g. https://zguard-api-xxx.vercel.app) is REQUIRED. When it is
 *   missing, or points back at this web deployment (self-proxy -> 308/redirect loop), no rewrite is
 *   installed and the route handlers in src/app/v1/[...path] and src/app/health answer 503
 *   {status:"misconfigured"} instead of looping.
 */
function resolveInternalApiUrl() {
  const raw = (process.env.ZGUARD_INTERNAL_API_URL || process.env.ZGUARD_API_URL || "").trim().replace(/\/+$/, "");
  const onVercel = Boolean(process.env.VERCEL);
  if (!raw) return onVercel ? null : "http://127.0.0.1:8787";
  let host;
  try {
    host = new URL(raw).host.toLowerCase();
  } catch {
    return null;
  }
  const selfHosts = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter(Boolean)
    .map((h) => String(h).toLowerCase());
  if (selfHosts.includes(host)) return null;
  if (onVercel && /^(127\.|localhost|0\.0\.0\.0)/.test(host)) return null;
  return raw;
}

const internalApiUrl = resolveInternalApiUrl();

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_ZGUARD_API_PROXY: internalApiUrl ? "configured" : "missing",
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  async rewrites() {
    if (!internalApiUrl) return { beforeFiles: [], afterFiles: [], fallback: [] };
    // beforeFiles so the proxy wins over the 503 fallback route handlers.
    return {
      beforeFiles: [
        { source: "/v1/:path*", destination: `${internalApiUrl}/v1/:path*` },
        { source: "/health", destination: `${internalApiUrl}/health` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
