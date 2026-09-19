import { PRESIDENT_COOKIE, requirePresident } from "./president";
import { presidentIdentity, presidentPoll, voterPoll } from "./redis-service";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE, readIdentity, VotingError } from "./security";
import { canonicalIdentity } from "./admin-identity";
import { authorize, settings } from "./service";
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
}
export async function session(admin = false) {
  const jar = await cookies();
  if (jar.get(PRESIDENT_COOKIE)) {
    requirePresident(jar.get(PRESIDENT_COOKIE)?.value);
    const config = await settings();
    return {config, identity: await presidentIdentity(config)};
  }
  const raw = readIdentity(jar.get(COOKIE)?.value);
  if (!raw) throw new VotingError("Join the session.", 401);
  const config = await settings();
  if (raw.role === "admin") throw new VotingError("Enter the president password.", 401);
  const admitted = authorize(raw, config);
  const identity = await canonicalIdentity(config, admitted);
  authorize(identity, config, admin);
  return { config, identity };
}
export async function pollingSession() {
  const jar = await cookies();
  if (jar.get(PRESIDENT_COOKIE)) {
    requirePresident(jar.get(PRESIDENT_COOKIE)?.value);
    return presidentPoll();
  }
  const identity = readIdentity(jar.get(COOKIE)?.value);
  if (!identity) throw new VotingError("Join the session.",401);
  return voterPoll(identity);
}
export function failure(error: unknown) {
  if (error instanceof VotingError) {
    const response = json({ error: error.message }, error.status);
    if (error.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
  return json({ error: "Voting is temporarily unavailable. Please retry; your local draft is preserved." }, 503);
}
export const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/api/voting", maxAge: 24 * 3600 };
