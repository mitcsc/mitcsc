import { exportToken } from "@/lib/voting/export-link";
import { failure, json, person } from "@/lib/voting/http";
import { createElection, currentElection, deleteElection, electionResults, endElection } from "@/lib/voting/redis-service";
import { body, requireOrigin, text, VotingError } from "@/lib/voting/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Delibs tab: the open delib, and a hosted delib's full results.
export async function GET(request: Request) {
  try {
    const me = await person();
    const results = new URL(request.url).searchParams.get("results");
    if (results) {
      const sessionId = text(results, "delib", 36);
      return json({...await electionResults(sessionId, me), exportToken: exportToken(sessionId, me.email)});
    }
    const current = await currentElection();
    const election = current?.open ? {sessionId: current.sessionId, name: current.name, hostName: current.hostName, isHost: current.host === me.email} : null;
    return json({me: {name: me.name}, election});
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const me = await person();
    const input = await body(request);
    if (input.action === "create") return json(await createElection(input, me));
    if (input.action === "end") { await endElection(text(input.sessionId, "delib", 36), me); return json({ok: true}); }
    if (input.action === "delete") { await deleteElection(text(input.sessionId, "delib", 36), me); return json({ok: true}); }
    throw new VotingError("Unknown action.");
  } catch (error) { return failure(error); }
}
