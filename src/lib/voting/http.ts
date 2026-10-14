import { NextResponse } from "next/server";
import { MembershipError } from "@/lib/membership/errors";
import { requireExecPerson } from "@/lib/membership/exec-auth";
import { identityFor, type Person } from "./redis-service";
import { VotingError } from "./security";
import { authorize, settings } from "./service";
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" } });
}
// The signed-in exec, from the dashboard session. Only exec can take part in delibs.
export async function person(): Promise<Person> {
  try { return await requireExecPerson(); }
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
export function failure(error: unknown) {
  if (error instanceof VotingError) {
    const response = json({ error: error.message }, error.status);
    if (error.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
  return json({ error: "Voting is temporarily unavailable. Please retry; your local draft is preserved." }, 503);
}
