import { NextResponse } from "next/server";
import { MembershipError } from "@/lib/membership/errors";
import { requireExecPerson, signedInEmail, type ExecAccess } from "@/lib/membership/exec-auth";
import { keys } from "@/lib/membership/keys";
import { redisEnabled } from "./redis";
import { identityFor, redisPoll, type Person } from "./redis-service";
import { VotingError } from "./security";
import { authorize, settings } from "./service";
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
}
// The signed-in exec, from the dashboard session. Only exec can take part in delibs.
// `stored` is the cached exec access list when the caller already read it.
export async function person(stored?: ExecAccess | null): Promise<Person> {
  try { return await requireExecPerson(stored); }
  catch (error) {
    if (error instanceof MembershipError) throw new VotingError(error.message, error.status);
    throw error;
  }
}
// The open delib and the signed-in exec's place in it.
export async function session(admin = false) {
  const signedIn = await person();
  const config = await settings();
  return { config, person: signedIn, identity: authorize(identityFor(config, signedIn), config, admin) };
}
// For polls: the signed-in exec, the open delib or null, and the open delib's public view when the
// client sends ?session= for it. One Redis command reads all three, where separate reads took three.
export async function poll(request: Request) {
  // A signed-out request fails before any Redis read.
  if (!await signedInEmail()) throw new VotingError("Sign in to use the dashboard.", 401);
  if (!redisEnabled()) throw new VotingError("Configure Redis before opening voting.", 503);
  const {extra: [access], config, view} = await redisPoll([keys.execAccess], new URL(request.url).searchParams.get("session"));
  return {person: await person(access ? JSON.parse(access) as ExecAccess : null), config: config?.open ? config : null, view};
}
// Like session(), for polls.
export async function pollSession(request: Request, admin = false) {
  const {person: signedIn, config, view} = await poll(request);
  if (!config) throw new VotingError("No delib is open.", 404);
  return {config, view, identity: authorize(identityFor(config, signedIn), config, admin)};
}
export function failure(error: unknown) {
  if (error instanceof VotingError) {
    const response = json({ error: error.message }, error.status);
    if (error.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
  return json({ error: "Voting is temporarily unavailable. Please retry; your local draft is preserved." }, 503);
}
