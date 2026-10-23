import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server for the container (frontend/Dockerfile).
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    // A Primavera P6 export (.xer) can be large; only its schedule tables are sent on to be read (lib/actions/xer.ts).
    serverActions: { bodySizeLimit: "100mb" },
  },
  // Settings used to live under /admin, which named the person rather than the
  // thing. Anything bookmarked or linked there still arrives.
  // Every page and answer: never shown inside another site's frame, never
  // guessed as another file type, the address kept to ourselves when a link
  // leaves, HTTPS remembered (browsers ignore it over plain HTTP), and no
  // camera, microphone or location asked for.
  async headers() {
    return [{
      // A stored file sets its own, stricter policy (app/api/files/[id]).
      source: "/((?!api/files/).*)",
      headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }],
    }, {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
  async redirects() {
    return [{ source: "/admin/:path*", destination: "/settings/:path*", permanent: true }];
  },
};

export default nextConfig;
