import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/**
 * Proxies /api/v1/* and /uploads/* to the NestJS backend so the browser
 * only ever talks to one origin. This is what makes the HttpOnly session
 * cookie "just work" without CORS/SameSite=None complexity — see
 * ARCHITECTURE.md "Authentication Architecture".
 */
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/v1/:path*", destination: `${API_URL}/api/v1/:path*` },
      { source: "/uploads/:path*", destination: `${API_URL}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
