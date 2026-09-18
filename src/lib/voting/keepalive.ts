import { randomInt, timingSafeEqual, createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { redisCommand, redisKey } from "./redis";

const reply = (status: number, body: object) => Response.json(body, {status, headers: {"Cache-Control": "no-store"}});

export async function keepAlive(request: Request, wait: (ms: number) => Promise<unknown> = sleep) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return reply(503, {error: "Health check is not configured."});
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(request.headers.get("authorization") || ""), digest(`Bearer ${secret}`))) {
    return reply(401, {error: "Unauthorized."});
  }
  try {
    // Small bounded jitter, never a long-running scheduled sleep.
    await wait(randomInt(0, 5001));
    const result = await redisCommand("SET", redisKey("health-check"), new Date().toISOString());
    if (result !== "OK") throw new Error("Health check failed");
    return reply(200, {ok: true});
  } catch {
    return reply(503, {error: "Redis health check failed."});
  }
}
