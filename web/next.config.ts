import type { NextConfig } from "next";

const API = process.env.BOTTEAM_API ?? "http://127.0.0.1:8899";

const nextConfig: NextConfig = {
  devIndicators: false, // the dev badge sits on top of the profile button
  compress: false, // gzip would buffer the SSE stream behind the /api rewrite
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};

export default nextConfig;
