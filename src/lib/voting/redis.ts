import { createHash } from "node:crypto";
import { VotingError } from "./security";

export function redisEnabled() {
  return !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN);
}

// The REST protocol keeps connections short-lived on Vercel. Credentials never leave the server.
export async function redisCommand<T>(...command: (string | number)[]): Promise<T> {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new VotingError("Redis is not configured for this deployment.", 503);
  const started = Date.now();
  let status: number | null = null;
  try {
    const response = await fetch(url, {method: "POST", headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"}, body: JSON.stringify(command), cache: "no-store", signal: AbortSignal.timeout(10_000)});
    status = response.status;
    const data = await response.json() as {result: T; error?: string};
    if (!response.ok || data.error) throw new Error("Redis request failed");
    return data.result;
  } catch {
    throw new VotingError("Voting is temporarily unavailable. Please retry.", 503, 2);
  } finally {
    if (process.env.VERCEL === "1" || process.env.VOTING_REQUEST_LOGS === "1") {
      console.info(JSON.stringify({event: "voting_redis_request", command: command[0], status, durationMs: Date.now() - started}));
    }
  }
}
export function redisKey(...parts: string[]) {
  return `csc:voting:v1:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}
const CAS = `if redis.call('GET', KEYS[1]) == ARGV[1] then if ARGV[3] then redis.call('MSET', KEYS[1], ARGV[2], KEYS[2], ARGV[3]) else redis.call('SET', KEYS[1], ARGV[2]) end; return 1 else return 0 end`;
export async function compareAndSet(key: string, before: string, after: string, view?: string) {
  // Session data has no expiry. A successful vote remains stored until explicitly archived.
  return await redisCommand<number>("EVAL", CAS, 2, key, `${key}:view`, before, after, ...(view ? [view] : [])) === 1;
}
export async function releaseLock(key: string, owner: string) {
  await redisCommand("EVAL", "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, key, owner);
}
