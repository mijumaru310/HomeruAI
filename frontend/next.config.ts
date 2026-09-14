import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.0.3", "10.120.6.245", "192.168.0.16", "10.119.60.205", "10.76.217.226"],

  async rewrites() {
    // Vercel Services owns /api/* routing. This proxy is only for local Next.js.
    if (process.env.VERCEL) return [];
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
