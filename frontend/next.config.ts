import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  // Settings used to live under /admin, which named the person rather than the
  // thing. Anything bookmarked or linked there still arrives.
  async redirects() {
    return [{ source: "/admin/:path*", destination: "/settings/:path*", permanent: true }];
  },
};

export default nextConfig;
