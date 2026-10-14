import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { CLUB_EMAIL } from "./config";
import { authorizationUrl, CLUB_SCOPES, clubEmail, SIGN_IN_SCOPES } from "./google/oauth";
import { sign } from "./signing";

export const STATE_COOKIE = "csc_oauth_state";

export type Flow = "sign-in" | "connect";

// Only same-site dashboard paths, so the callback cannot redirect anywhere else.
export function safeNext(value: string | null) {
  return value && /^\/dashboard(\/[\w\-/]*)?$/.test(value) ? value : "/dashboard";
}

export function startFlow(request: Request, flow: Flow) {
  const url = new URL(request.url);
  const nonce = randomBytes(16).toString("base64url");
  const next = safeNext(url.searchParams.get("next"));
  let target: string;
  let state: string;
  try {
    target = authorizationUrl({
      origin: url.origin,
      state: nonce,
      scopes: flow === "connect" ? CLUB_SCOPES : SIGN_IN_SCOPES,
      offline: flow === "connect",
      loginHint: flow === "connect" ? clubEmail() : undefined,
    });
    state = sign("oauth-state", { nonce, flow, next }, 10 * 60_000);
  } catch (error) {
    // Missing server settings. The log names them; visitors get a plain message.
    console.error("Google sign-in could not start:", error instanceof Error ? error.message : error);
    const back = new URL(next, url.origin);
    back.searchParams.set("problem", `Google sign-in is not set up on this site yet. Email ${CLUB_EMAIL} if this keeps happening.`);
    return NextResponse.redirect(back);
  }
  const response = NextResponse.redirect(target);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/google", maxAge: 600,
  });
  return response;
}
