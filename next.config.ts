import type { NextConfig } from "next";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const nextConfig: NextConfig = {
  images: {
    // The hero polaroids also request 512 (HERO_PHOTO_WIDTHS in src/lib/images.ts);
    // their larger candidates are default device sizes.
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 512],
    qualities: [75],
    // Event photos never change under the same file name, so optimized
    // variants can stay cached for a year. Rename a file to replace it.
    minimumCacheTTL: ONE_YEAR_SECONDS,
    // Home page photos from Drive. Production's route is the source for every
    // deploy, so they share one cache (see homePhotoSrc in src/lib/home-photos.ts).
    // Exec photos from Drive work the same way (see publicCards in src/lib/exec.ts).
    remotePatterns: [
      { protocol: "https", hostname: "csc.mit.edu", pathname: "/api/home-photos/**", search: "" },
      { protocol: "https", hostname: "csc.mit.edu", pathname: "/api/exec-photos/**", search: "" },
    ],
  },
  experimental: {
    // Exec photo uploads. The browser shrinks photos first, so they stay far below this.
    serverActions: { bodySizeLimit: "4mb" },
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
