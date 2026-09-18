import { failure, json, session } from "@/lib/voting/http";
import { text } from "@/lib/voting/security";
import { recoverBallot } from "@/lib/voting/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const {config, identity} = await session();
    const query = new URL(request.url).searchParams;
    return json(await recoverBallot(config, identity, text(query.get("candidateId"), "candidate ID", 100), text(query.get("version"), "ballot version", 100)));
  } catch (error) { return failure(error); }
}
