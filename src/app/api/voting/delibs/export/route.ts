import { failure, person } from "@/lib/voting/http";
import { exportFileName, resultRows, toCsv } from "@/lib/voting/export";
import { exportTokenHost } from "@/lib/voting/export-link";
import { electionResults } from "@/lib/voting/redis-service";
import { text, VotingError } from "@/lib/voting/security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Google's "Save to Drive" reads the file from its own origin, as its docs require.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Cache-Control, Content-Encoding, Content-Range",
};

// A hosted delib's votes as a CSV file. "Download CSV" uses the host's sign-in; "Save to Drive" uses a signed link.
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const sessionId = text(params.get("id"), "delib", 36);
    const token = params.get("token");
    const tokenHost = token ? exportTokenHost(token, sessionId) : null;
    if (token && !tokenHost) throw new VotingError("This link has expired. Open the results again.", 403);
    const host = tokenHost ? {email: tokenHost, name: ""} : await person();
    const results = await electionResults(sessionId, host);
    return new Response(`\uFEFF${toCsv(resultRows(results))}`, {headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFileName(results.name)}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...(tokenHost ? CORS : {}),
    }});
  } catch (error) { return failure(error); }
}

export function OPTIONS() {
  return new Response(null, {status: 204, headers: {...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS"}});
}
