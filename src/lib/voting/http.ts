import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE, readIdentity, VotingError } from "./security";
import { canonicalIdentity } from "./admin-identity";
import { authorize, settings } from "./service";
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
}
export async function session(admin = false) {
  const config = await settings();
  const jar = await cookies();
  const admitted = authorize(readIdentity(jar.get(COOKIE)?.value), config);
  const identity = await canonicalIdentity(config, admitted);
  authorize(identity, config, admin);
  return { config, identity };
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
