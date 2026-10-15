import { sign, verify } from "./signing";

// The dashboard sign-in. It lasts 30 days from the last visit: each visit renews it (see src/middleware.ts).
// Access is checked separately on every page and action, so exec removed from the Drive folder lose access within minutes.

export const SESSION_COOKIE = "csc_dashboard";
const SESSION_MS = 30 * 24 * 3600_000;
// A visit renews the sign-in at most once a day, so most responses don't set a cookie.
const RENEW_AFTER_MS = 24 * 3600_000;

interface Session { email: string; name?: string | null }

export function sessionCookie(email: string, name: string | null = null) {
  return {
    name: SESSION_COOKIE,
    value: sign("dashboard-session", { email, name }, SESSION_MS),
    options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_MS / 1000 },
  };
}

export function readSession(token: string | undefined) {
  return verify<Session>("dashboard-session", token);
}

// A new cookie for a valid sign-in made or renewed more than a day ago, or null.
export function renewedSession(token: string | undefined) {
  const session = readSession(token) as (Session & { exp: number }) | null;
  if (!session || session.exp - Date.now() > SESSION_MS - RENEW_AFTER_MS) return null;
  return sessionCookie(session.email, session.name ?? null);
}
