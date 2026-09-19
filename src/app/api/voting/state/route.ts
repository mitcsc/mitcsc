import { failure, json, pollingSession } from "@/lib/voting/http";
import { recordPresence } from "@/lib/voting/presence";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { config, identity, state } = await pollingSession();
    // Presence is best-effort and cannot interrupt ballots or admission.
    try {
      if (!state.isAdmin && state.active && new URL(request.url).searchParams.has("presence")) {
        await recordPresence(config,identity.id,new URL(request.url).searchParams.get("presence") === "hidden");
      }
    } catch { /* Roster falls back to unknown; voting continues. */ }
    return json(state);
  }
  catch (error) { return failure(error); }
}
