import { cookies } from "next/headers";
import { cookieOptions, failure, json } from "@/lib/voting/http";
import { body, COOKIE, equal, limitJoin, readIdentity, requireOrigin, signIdentity, text, VotingError } from "@/lib/voting/security";
import { settings } from "@/lib/voting/service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireOrigin(request); limitJoin(request);
    const data = await body(request);
    if (data.role !== "admin" && data.role !== "voter") throw new VotingError("Choose voter or facilitator access.");
    const password = text(data.password, "password", 500);
    const name = data.role === "voter" ? text(data.name, "name", 100) : "Facilitator";
    const config = await settings();
    const expected = data.role === "admin" ? config.adminPassword : config.password;
    if (!expected || !equal(password, expected)) { limitJoin(request, true); throw new VotingError("Incorrect password, or this voting session is closed.", 401); }
    const jar = await cookies();
    const old = readIdentity(jar.get(COOKIE)?.value);
    // An already admitted voter keeps their identity when rejoining this session.
    const signed = old && old.role === data.role && old.sessionId === config.sessionId && old.sheetId === config.sheetId
      ? jar.get(COOKIE)!.value
      : signIdentity({ name, role: data.role, sessionId: config.sessionId, sheetId: config.sheetId });
    const response = json({ ok: true });
    response.cookies.set(COOKIE, signed, cookieOptions);
    return response;
  } catch (error) { return failure(error); }
}
