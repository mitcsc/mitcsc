import { cookies } from "next/headers";
import { after } from "next/server";
import { MembershipError } from "./errors";
import { CLUB_DRIVE_FOLDER } from "./config";
import { clubFolder, findFolder, folderEditors, FOLDER } from "./google/drive";
import { ClubNotConnected, clubConnection, clubEmail } from "./google/oauth";
import { keys } from "./keys";
import { getJson, redis } from "./redis";
import { readSession, SESSION_COOKIE } from "./session";

export { SESSION_COOKIE, sessionCookie } from "./session";

const ACCESS_CACHE_SECONDS = 300;
// A list older than ACCESS_CACHE_SECONDS but younger than this is still used, while Google is read again after the response.
// So nobody waits on Google while the dashboard is in use. An older list is read again first.
const ACCESS_STALE_SECONDS = 3600;

export interface ExecAccess {
  folderId: string | null;
  people: { email: string; role: "Owner" | "Editor" }[];
  checkedAt: number;
}

// For trying the dashboard locally without Google. Local mode (`npm run dev`) sets it. Development only.
export function devEmail() {
  return process.env.NODE_ENV === "development" ? process.env.DASHBOARD_DEV_EMAIL?.toLowerCase() || null : null;
}

// Everyone who can edit the club's "MIT CSC" Drive folder, cached for a few minutes.
// While Google can't be reached or the club account needs reconnecting, the last list stays in use,
// so exec can still sign in and reconnect it.
// `stored` is the cached list when the caller already read keys.execAccess, to save a Redis read.
export async function execAccess(fresh = false, stored?: ExecAccess | null): Promise<ExecAccess> {
  const cached = stored !== undefined ? stored : await getJson<ExecAccess>(keys.execAccess);
  const age = cached ? Date.now() - cached.checkedAt : Infinity;
  if (!fresh && age < ACCESS_CACHE_SECONDS * 1000) return cached!;
  if (!fresh && age < ACCESS_STALE_SECONDS * 1000) {
    refreshAccessLater();
    return cached!;
  }
  const connection = await clubConnection();
  if (!connection) return { folderId: null, people: [], checkedAt: Date.now() };
  try {
    if (connection.brokenAt) throw new ClubNotConnected();
    const folderId = (await findFolder(CLUB_DRIVE_FOLDER))?.id || null;
    if (!folderId) return { folderId: null, people: [], checkedAt: Date.now() };
    const access: ExecAccess = { folderId, people: await folderEditors(folderId), checkedAt: Date.now() };
    await redis("SET", keys.execAccess, JSON.stringify(access));
    return access;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

// Reads the list from Google after the response. One request at a time does it.
function refreshAccessLater() {
  try {
    after(async () => {
      if ((await redis("SET", keys.lock("exec-access"), "1", "NX", "EX", 60)) !== "OK") return;
      await execAccess(true).catch((error) => console.error(error));
    });
  } catch {
    // Outside a request there is no "after". The next request reads it.
  }
}

// The club's "MIT CSC" folder. The exec list already knows it, so most pages skip a Drive request.
export async function knownClubFolder() {
  const access = await execAccess().catch(() => null);
  return access?.folderId ? { id: access.folderId, name: CLUB_DRIVE_FOLDER, mimeType: FOLDER } : clubFolder();
}

export async function clearExecAccessCache() {
  await redis("DEL", keys.execAccess);
}

// The club account can always sign in, so the dashboard can be set up before any folder exists.
export async function hasExecAccess(email: string, stored?: ExecAccess | null) {
  if (email === clubEmail() || email === devEmail()) return true;
  const access = await execAccess(false, stored).catch(() => null);
  return !!access?.people.some((p) => p.email === email);
}

async function session() {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function signedInEmail() {
  return (await session())?.email || null;
}

// The signed-in exec, with the name from their Google account. Sessions from before names were saved
// fall back to the part of the email before the @.
export async function requireExecPerson(stored?: ExecAccess | null) {
  const email = await requireExec(stored);
  return { email, name: (await session())?.name || email.split("@")[0] };
}

// Every dashboard action calls this first.
export async function requireExec(stored?: ExecAccess | null) {
  const email = await signedInEmail();
  if (!email) throw new MembershipError("Sign in to use the dashboard.", 401);
  if (!(await hasExecAccess(email, stored))) throw new MembershipError("This Google account does not have access.", 403);
  return email;
}
