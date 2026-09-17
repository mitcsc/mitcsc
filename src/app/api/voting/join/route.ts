import { cookies } from "next/headers";
import { cookieOptions, failure, json } from "@/lib/voting/http";
import { body, COOKIE, equal, limitJoin, readIdentity, requireOrigin, signIdentity, text, VotingError } from "@/lib/voting/security";
import { settings } from "@/lib/voting/service";
import { claimIdentity } from "@/lib/voting/facilitator";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireOrigin(request); limitJoin(request);
    const data = await body(request);
    const password = text(data.password, "password", 500);
    const name = text(data.name, "name", 100);
    const config = await settings();
    if (!config.password || !equal(password, config.password)) { limitJoin(request, true); throw new VotingError("Incorrect password, or this voting session is closed.", 401); }
    const jar = await cookies();
    const identity = await claimIdentity(config, name, readIdentity(jar.get(COOKIE)?.value));
    const response = json({ ok: true });
    response.cookies.set(COOKIE, signIdentity(identity), cookieOptions);
    return response;
  } catch (error) { return failure(error); }
}
