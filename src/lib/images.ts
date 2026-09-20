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
