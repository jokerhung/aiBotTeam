import type { NextConfig } from "next";
import { hostname, networkInterfaces } from "node:os";

const API = process.env.BOTTEAM_API ?? "http://127.0.0.1:8899";

// BOTTEAM_EXPORT=1 builds the app as plain static files (web/out) that the Python server serves itself: one program, no Node at run time.
const exportBuild = process.env.BOTTEAM_EXPORT === "1";

const nextConfig: NextConfig = {
  // LAN and Tailscale addresses must also be permitted for dev assets and HMR.
  allowedDevOrigins: [...new Set([
    "localhost", "127.0.0.1", hostname(),
    ...Object.values(networkInterfaces()).flatMap((addresses) => (addresses ?? []).filter((a) => !a.internal).map((a) => a.address)),
    ...(process.env.WEB_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean),
  ])],
  ...(exportBuild ? { output: "export" as const, distDir: ".next-export", images: { unoptimized: true } } : {}),
  devIndicators: false, // the dev badge sits on top of the profile button
  compress: false, // gzip would buffer the SSE stream behind the /api rewrite
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  ...(exportBuild ? {} : { async rewrites() { return [{ source: "/api/:path*", destination: `${API}/api/:path*` }]; } }),
};

export default nextConfig;
