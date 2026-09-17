import { cookieOptions, failure, json } from "@/lib/voting/http";
import { COOKIE, requireOrigin } from "@/lib/voting/security";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try { requireOrigin(request); const response = json({ ok: true }); response.cookies.set(COOKIE, "", { ...cookieOptions, maxAge: 0 }); return response; }
  catch (error) { return failure(error); }
}
