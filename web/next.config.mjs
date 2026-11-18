import { hostname, networkInterfaces } from "node:os";

// Where the services this app talks to live. The browser only ever sees this app's own address: the rewrites below are the proxy.
const API = process.env.BOTTEAM_API ?? "http://127.0.0.1:8899";
const ZALO = process.env.BOTTEAM_ZALO ?? `http://127.0.0.1:${process.env.ZALO_PORT ?? "8902"}`;

// BOTTEAM_EXPORT=1 builds the app as plain static files (web/out) that the Python server serves itself: one program, no Node at run time.
const exportBuild = process.env.BOTTEAM_EXPORT === "1";

/** @type {import("next").NextConfig} */
const nextConfig = {
  // LAN and Tailscale addresses must also be permitted for dev assets and HMR.
  allowedDevOrigins: [...new Set([
    "localhost", "127.0.0.1", hostname(),
    ...Object.values(networkInterfaces()).flatMap((addresses) => (addresses ?? []).filter((a) => !a.internal).map((a) => a.address)),
    ...(process.env.WEB_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim()).filter(Boolean),
  ])],
  ...(exportBuild ? { output: "export", distDir: ".next-export", images: { unoptimized: true } } : {}),
  ...(!exportBuild && process.env.BOTTEAM_DIST_DIR ? { distDir: process.env.BOTTEAM_DIST_DIR } : {}), // a second dev server beside the first needs its own build folder
  devIndicators: false, // the dev badge sits on top of the profile button
  compress: false, // gzip would buffer the SSE stream behind the /api rewrite
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  // The proxy: /api/* is the Python server, /zalo-api/* is the Node.js Zalo service (zalo-service/). In the static build the Python server serves both paths itself.
  ...(exportBuild ? {} : {
    async rewrites() {
      return [
        { source: "/api/:path*", destination: `${API}/api/:path*` },
        { source: "/zalo-api/:path*", destination: `${ZALO}/:path*` },
      ];
    },
  }),
};

export default nextConfig;
