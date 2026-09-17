import { failure, json, session } from "@/lib/voting/http";
import { getState } from "@/lib/voting/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try { const { config, identity } = await session(); return json(await getState(config, identity)); }
  catch (error) { return failure(error); }
}
