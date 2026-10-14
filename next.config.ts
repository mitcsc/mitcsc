import type { NextConfig } from "next";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const nextConfig: NextConfig = {
  images: {
    // The hero polaroids also request 512 (see src/components/home/Photos.tsx);
    // their larger candidates are default device sizes.
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 512],
    qualities: [75],
    // Event photos never change under the same file name, so optimized
    // variants can stay cached for a year. Rename a file to replace it.
    minimumCacheTTL: ONE_YEAR_SECONDS,
  },
  async headers() {
    return [
      {
        // Font files are versioned by name and never edited in place.
        source: "/font/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: `public, max-age=${ONE_YEAR_SECONDS}, immutable`,
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/deliberations/:path*", destination: "/dashboard/delibs", permanent: true },
      { source: "/vote/:path*", destination: "/dashboard/delibs", permanent: true },
      {
        source: "/link",
        destination: "/links",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
