import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/calendar",
        destination: "/links",
        permanent: false,
      },
      {
        source: "/link",
        destination: "/links",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
