import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export class VotingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const COOKIE = "csc_voting";
export interface Identity { id: string; name: string; role: "admin" | "voter"; sessionId: string; sheetId: string; exp: number; claimId?: string }
function secret() {
  const value = process.env.VOTING_COOKIE_SECRET;
  if (value) {
    if (value.length < 32) throw new VotingError("VOTING_COOKIE_SECRET must contain at least 32 random characters.", 503);
    return value;
  }
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!privateKey) throw new VotingError("Google service account credentials are not configured.", 503);
  return createHmac("sha256", privateKey).update("mitcsc:voting:cookie-signing:v1").digest("base64url");
}
export function equal(a: string, b: string) {
  const key = secret();
  return timingSafeEqual(createHmac("sha256", key).update(a).digest(), createHmac("sha256", key).update(b).digest());
}
export function signIdentity(data: Omit<Identity, "id" | "exp"> & { id?: string }) {
  const identity = { ...data, id: data.id || randomUUID(), exp: Date.now() + 24 * 3600_000 };
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}
export function readIdentity(value?: string): Identity | null {
  if (!value || value.length > 4096) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  if (!equal(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as Identity;
    if (data.exp <= Date.now() || !Number.isFinite(data.exp) || !data.id || !data.sessionId || !data.sheetId || !["admin", "voter"].includes(data.role)) return null;
    return data;
  } catch { return null; }
}
export function requireOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new VotingError("Request origin is not allowed.", 403);
}
const attempts = new Map<string, { count: number; until: number }>();
export function limitJoin(request: Request, failed = false) {
  const now = Date.now();
  for (const [key, item] of attempts) if (item.until <= now) attempts.delete(key);
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const entry = attempts.get(key) || { count: 0, until: now + 60_000 };
  if (attempts.size > 5000 && !attempts.has(key)) throw new VotingError("Please try again shortly.", 429);
  if (failed) entry.count++;
  attempts.set(key, entry);
  if (entry.count >= 30) throw new VotingError("Too many join attempts. Try again in a minute.", 429);
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 100_000) throw new VotingError("Request is too large.");
  try {
    const result = JSON.parse(raw);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new VotingError("Expected a JSON object."); }
}
export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new VotingError(`Invalid ${label}.`);
  return value.trim();
}
