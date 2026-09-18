import { failure, json, session } from "@/lib/voting/http";
import { body, requireOrigin } from "@/lib/voting/security";
import { adminAction } from "@/lib/voting/service";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try { requireOrigin(request); const { config, identity } = await session(true); return json(await adminAction(config, identity, await body(request))); }
  catch (error) { return failure(error); }
}
