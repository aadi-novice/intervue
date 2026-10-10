import type { NextConfig } from "next";

const backend = process.env.BACKEND_INTERNAL_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  output: "standalone",
  // Same-origin proxy: browser -> /api/<path> -> backend /<path>. Keeps the
  // httpOnly auth cookies first-party (no CORS, no SameSite=None).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
