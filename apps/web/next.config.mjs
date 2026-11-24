/** @type {import('next').NextConfig} */
const internalApiUrl = process.env.ZGUARD_INTERNAL_API_URL || "http://127.0.0.1:8787";

const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["*.e2b.app", "localhost", "127.0.0.1"],
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
