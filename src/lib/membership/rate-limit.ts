import { headers } from "next/headers";
import { MembershipError } from "./errors";
import { keys } from "./keys";
import { pipeline } from "./redis";

export async function clientIp() {
  const list = await headers();
  return list.get("x-real-ip") || list.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

// Fixed-window counters in Redis, so limits hold across serverless instances.
export async function limit(scope: string, id: string, max: number, windowSeconds: number) {
  const key = keys.rateLimit(scope, id);
  const [count] = await pipeline<[number, number]>([["INCR", key], ["EXPIRE", key, windowSeconds, "NX"]]);
  if (count > max) throw new MembershipError("Too many tries. Please wait a few minutes and try again.", 429);
}
