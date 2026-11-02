import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Deployment-skew protection. When a client holding an older bundle talks to a
  // newer build (or a different replica once scaled horizontally), Next tags the
  // mismatch and forces a fresh load instead of failing with the confusing
  // "Failed to find Server Action" / "older or newer deployment" error.
  // Sourced from APP_VERSION — deploy.sh sets it to the release git tag and
  // passes it through docker-compose, so every replica of a release shares one
  // id. Falls back to undefined (no-op) for local dev. Next 16.3+ rejects any
  // character outside [A-Za-z0-9_-], and tags look like "v1.0.38", so dots
  // (and anything else) become hyphens.
  // The admin dashboard is served on admin.<host> (lib/admin-host.ts); dev
  // blocks /_next/* for any other host, so pages there would never hydrate.
  allowedDevOrigins: ["admin.localhost"],
  deploymentId: process.env.APP_VERSION?.replace(/[^A-Za-z0-9_-]/g, "-") || undefined,
  async headers() {
    return [
      {
        source: "/api/auth/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.crypteo.io" }],
        destination: "https://crypteo.io/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
