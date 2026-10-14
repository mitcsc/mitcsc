import { failure, json, session } from "@/lib/voting/http";
import { recordPresence } from "@/lib/voting/presence";
import { getState } from "@/lib/voting/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { config, identity } = await session();
    const state = await getState(config, identity);
    // Presence is best-effort and cannot interrupt ballots or admission.
    try {
      const query = new URL(request.url).searchParams;
      if (!state.isAdmin && state.active && query.has("presence")) await recordPresence(config, identity.id, query.get("presence") === "hidden");
    } catch { /* Roster falls back to unknown; voting continues. */ }
    return json(state);
  }
  catch (error) { return failure(error); }
}
