import type { NextConfig } from "next";

// ipconfig をターミナルで打ちIPv4 アドレスを記入
const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["192.168.0.3", "10.120.6.245",'192.168.0.16',"10.119.60.205"],

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://127.0.0.1:8000/api/:path*", // FastAPIのローカルアドレス
      },
    ];
  },
};

export default nextConfig;
