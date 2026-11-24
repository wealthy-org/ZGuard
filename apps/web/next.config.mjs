/** @type {import('next').NextConfig} */

// On Vercel, set ZGUARD_INTERNAL_API_URL to your deployed API base URL
// (e.g. https://zguard-api-xxx.vercel.app). Defaults to local dev server.
const internalApiUrl =
  process.env.ZGUARD_INTERNAL_API_URL ||
  process.env.ZGUARD_API_URL ||
  "http://127.0.0.1:8787";

const nextConfig = {
  reactStrictMode: true,
  // Vercel production: allow cross-origin from the API domain
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
    return [
      {
        source: "/v1/:path*",
        destination: `${internalApiUrl}/v1/:path*`,
      },
      {
        source: "/health",
        destination: `${internalApiUrl}/health`,
      },
    ];
  },
};

export default nextConfig;
