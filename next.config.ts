import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/link",
        destination: "/links",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
