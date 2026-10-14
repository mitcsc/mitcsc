import { clubEmail } from "@/lib/membership/google/oauth";
import { failure, json, person } from "@/lib/voting/http";
import { redisJoin } from "@/lib/voting/redis-service";
import { requireOrigin } from "@/lib/voting/security";
import { settings } from "@/lib/voting/service";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const signedIn = await person();
    await redisJoin(await settings(), signedIn, clubEmail());
    return json({ ok: true });
  } catch (error) { return failure(error); }
}
