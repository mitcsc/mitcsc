import { cookies } from "next/headers";
import { body, limitJoin, requireOrigin, text, VotingError } from "@/lib/voting/security";
import { PRESIDENT_COOKIE, presidentEnabled, presidentLogin, requirePresident } from "@/lib/voting/president";
import { createElection, currentElection, endElection, electionResults } from "@/lib/voting/redis-service";
import { cookieOptions, failure, json } from "@/lib/voting/http";
export const runtime = "nodejs";
export const maxDuration = 60;
const publicConfig = (config: Awaited<ReturnType<typeof currentElection>>) => config && ({sessionId: config.sessionId, name: config.name, open: !!config.password, joinCode: config.password});
export async function GET(request: Request) {
  try {
    requirePresident((await cookies()).get(PRESIDENT_COOKIE)?.value);
    if (new URL(request.url).searchParams.get("view") === "results") {
      const config = await currentElection();
      if (!config) throw new VotingError("No election results are available.", 404);
      return json(await electionResults(config));
    }
    return json({enabled: true, election: publicConfig(await currentElection()), serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL});
  } catch (error) {return failure(error);}
}
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    if (!presidentEnabled()) throw new VotingError("President login is not configured.", 503);
    const input = await body(request);
    if (input.action === "login") {
      limitJoin(request);
      let token: string;
      try {token = presidentLogin(text(input.password, "password", 500));}
      catch (error) {if (error instanceof VotingError && error.status === 401) limitJoin(request, true); throw error;}
      const response = json({ok: true});
      response.cookies.set(PRESIDENT_COOKIE, token, cookieOptions);
      return response;
    }
    requirePresident((await cookies()).get(PRESIDENT_COOKIE)?.value);
    if (input.action === "create") return json({election: publicConfig(await createElection(input))});
    if (input.action === "end") {await endElection(text(input.sessionId, "session ID", 100)); return json({ok: true});}
    throw new VotingError("Unknown action.");
  } catch (error) {return failure(error);}
}
