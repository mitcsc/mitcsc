import eventImages from "@/generated/event-images.json";

/**
 * File names under public/img/event, generated at build time by
 * scripts/generate-event-images.mjs.
 */
export function getEventImages(): readonly string[] {
  return eventImages;
}

/** Returns `count` distinct random entries from `items`, in random order. */
export function pickRandom<T>(items: readonly T[], count: number): T[] {
  const pool = [...items];
  const limit = Math.min(count, pool.length);
  // Partial Fisher-Yates shuffle: only the first `limit` slots are needed.
  for (let i = 0; i < limit; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, limit);
}

/**
 * Widths the hero polaroids offer in their srcset. Each must be listed in
 * `images.imageSizes` or `images.deviceSizes` in next.config.ts. The photos
 * are 1280px on the long side, so 1080 is the largest useful width.
 */
export const HERO_PHOTO_WIDTHS = [256, 384, 512, 640, 828, 1080];

/** Must be listed in `images.qualities` in next.config.ts. */
const QUALITY = 75;

/**
 * A URL served by the Next.js image optimizer (Vercel Image Optimization in
 * production). `src` is a path in public/ or a URL allowed by
 * `images.remotePatterns`.
 */
export function optimizerUrl(src: string, width: number): string {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${QUALITY}`;
}
