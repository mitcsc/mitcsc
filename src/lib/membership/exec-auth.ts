import { cookies } from "next/headers";
import { MembershipError } from "./errors";
import { folderEditors } from "./google/drive";
import { clubConnection, clubEmail } from "./google/oauth";
import { keys } from "./keys";
import { getJson, redis } from "./redis";
import { sign, verify } from "./signing";
import { currentYear } from "./store";

export const SESSION_COOKIE = "csc_dashboard";
const SESSION_MS = 12 * 3600_000;
const ACCESS_CACHE_SECONDS = 300;

export interface ExecAccess {
  folderId: string | null;
  people: { email: string; role: "Owner" | "Editor" }[];
  checkedAt: number;
}

export function sessionCookie(email: string) {
  return {
    name: SESSION_COOKIE,
    value: sign("dashboard-session", { email }, SESSION_MS),
    options: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: SESSION_MS / 1000 },
  };
}

// For trying the dashboard locally without Google. `next dev` only.
export function devEmail() {
  return process.env.NODE_ENV === "development" ? process.env.DASHBOARD_DEV_EMAIL?.toLowerCase() || null : null;
}

// Everyone who can edit this year's Drive folder, cached for a few minutes.
export async function execAccess(fresh = false): Promise<ExecAccess> {
  if (!fresh) {
    const cached = await getJson<ExecAccess>(keys.execAccess);
    if (cached && Date.now() - cached.checkedAt < ACCESS_CACHE_SECONDS * 1000) return cached;
  }
  const config = await currentYear();
  const connection = await clubConnection();
  if (!config?.folderId || !connection || connection.brokenAt) return { folderId: config?.folderId || null, people: [], checkedAt: Date.now() };
  const access: ExecAccess = { folderId: config.folderId, people: await folderEditors(config.folderId), checkedAt: Date.now() };
  await redis("SET", keys.execAccess, JSON.stringify(access));
  return access;
}

export async function clearExecAccessCache() {
  await redis("DEL", keys.execAccess);
}

// The club account can always sign in, so the dashboard can be set up before any folder exists.
export async function hasExecAccess(email: string) {
  if (email === clubEmail() || email === devEmail()) return true;
  const access = await execAccess().catch(() => null);
  return !!access?.people.some((p) => p.email === email);
}

export async function signedInEmail() {
  const session = verify<{ email: string }>("dashboard-session", (await cookies()).get(SESSION_COOKIE)?.value);
  return session?.email || null;
}

// Every dashboard action calls this first.
export async function requireExec() {
  const email = await signedInEmail();
  if (!email) throw new MembershipError("Sign in to use the dashboard.", 401);
  if (!(await hasExecAccess(email))) throw new MembershipError("This Google account does not have access.", 403);
  return email;
}
