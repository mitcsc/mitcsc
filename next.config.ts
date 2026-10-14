import type { NextConfig } from "next";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const nextConfig: NextConfig = {
  images: {
    // 512 is the largest candidate the hero polaroids request (see
    // src/components/home/Photos.tsx); 2x screens showing a 256px photo
    // would otherwise fall through to the 640px device size.
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 512],
    // 60 for the hero polaroids, 75 for everything else.
    qualities: [60, 75],
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
