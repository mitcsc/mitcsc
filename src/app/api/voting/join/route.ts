import { cookies } from "next/headers";
import { cookieOptions, failure, json } from "@/lib/voting/http";
import { body, COOKIE, DEVICE_COOKIE, equal, limitJoin, readIdentity, requireOrigin, signIdentity, text, VotingError } from "@/lib/voting/security";
import { settings } from "@/lib/voting/service";
import { claimIdentity } from "@/lib/voting/admin-identity";
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
    // Device identity is consulted only after password verification; it cannot authorize API access.
    const existing = readIdentity(jar.get(COOKIE)?.value) || readIdentity(jar.get(DEVICE_COOKIE)?.value, "device");
    const joinId = data.joinId === undefined ? undefined : text(data.joinId, "join ID", 100);
    if (joinId && !/^[a-f0-9-]{36}$/i.test(joinId)) throw new VotingError("Invalid join ID.");
    const identity = await claimIdentity(config, name, existing, joinId);
    const response = json({ ok: true });
    response.cookies.set(COOKIE, signIdentity(identity), cookieOptions);
    const deviceSeconds = 365 * 24 * 3600;
    response.cookies.set(DEVICE_COOKIE, signIdentity(identity, { purpose: "device", ttlMs: deviceSeconds * 1000 }), { ...cookieOptions, maxAge: deviceSeconds });
    return response;
  } catch (error) { return failure(error); }
}
