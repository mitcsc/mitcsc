import { MembershipError } from "./errors";

type Command = (string | number)[];

function credentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new MembershipError("Membership storage is not configured.", 503);
  return { url: url.replace(/\/$/, ""), token };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const { url, token } = credentials();
  let response: Response;
  try {
    response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new MembershipError("Membership storage is unavailable. Please try again.", 503);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new MembershipError("Membership storage is unavailable. Please try again.", 503);
  return data as T;
}

// Upstash REST protocol: one command per request, or a pipeline of commands.
export async function redis<T = unknown>(...command: Command): Promise<T> {
  const data = await post<{ result?: T; error?: string }>("", command);
  if (data.error) throw new Error(`Redis ${command[0]} failed: ${data.error}`);
  return data.result as T;
}

export async function pipeline<T extends unknown[] = unknown[]>(commands: Command[]): Promise<T> {
  if (!commands.length) return [] as unknown as T;
  const data = await post<{ result?: unknown; error?: string }[]>("/pipeline", commands);
  return data.map((entry, index) => {
    if (entry.error) throw new Error(`Redis ${commands[index][0]} failed: ${entry.error}`);
    return entry.result;
  }) as T;
}

export async function getJson<T>(key: string): Promise<T | null> {
  const raw = await redis<string | null>("GET", key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function getManyJson<T>(keys: string[]): Promise<(T | null)[]> {
  if (!keys.length) return [];
  const values: (string | null)[] = [];
  // Keep each request small enough for the REST endpoint.
  for (let i = 0; i < keys.length; i += 200) values.push(...(await redis<(string | null)[]>("MGET", ...keys.slice(i, i + 200))));
  return values.map((raw) => (raw ? (JSON.parse(raw) as T) : null));
}

const COMPARE_AND_SET = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]) return 1 else return 0 end";

// Read, change, and write one JSON value without losing a concurrent write.
// Returns null when the key does not exist. The change may throw to abort.
export async function updateJson<T>(key: string, change: (value: T) => T): Promise<T | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await redis<string | null>("GET", key);
    if (!before) return null;
    const next = change(JSON.parse(before) as T);
    const after = JSON.stringify(next);
    if (after === before) return next;
    if ((await redis<number>("EVAL", COMPARE_AND_SET, 1, key, before, after)) === 1) return next;
  }
  throw new MembershipError("Too many changes at once. Please try again.", 409);
}
