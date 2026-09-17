import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/deliberations/:path*", destination: "/vote/:path*", permanent: true },
      {
        source: "/link",
        destination: "/links",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
