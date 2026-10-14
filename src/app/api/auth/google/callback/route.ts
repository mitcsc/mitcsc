import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicMessage } from "@/lib/membership/errors";
import { clearExecAccessCache, hasExecAccess, requireExec, sessionCookie } from "@/lib/membership/exec-auth";
import { clubEmail, exchangeCode, saveClubConnection } from "@/lib/membership/google/oauth";
import { STATE_COOKIE, type Flow } from "@/lib/membership/oauth-flow";
import { verify } from "@/lib/membership/signing";

export const dynamic = "force-dynamic";

function back(request: Request, path: string, problem?: string) {
  const url = new URL(path, request.url);
  if (problem) url.searchParams.set("problem", problem);
  const response = NextResponse.redirect(url);
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/auth/google" });
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = verify<{ nonce: string; flow: Flow; next: string }>("oauth-state", (await cookies()).get(STATE_COOKIE)?.value);
  if (!state || state.nonce !== url.searchParams.get("state")) return back(request, "/dashboard", "Sign-in expired. Please try again.");
  const code = url.searchParams.get("code");
  if (!code) return back(request, state.next, url.searchParams.get("error") === "access_denied" ? undefined : "Google sign-in failed. Please try again.");
  try {
    const { email, name, tokens } = await exchangeCode(code, url.origin);
    if (state.flow === "connect") {
      const by = await requireExec();
      if (email !== clubEmail()) return back(request, state.next, `Connect ${clubEmail()}, not ${email}.`);
      await saveClubConnection(email, by, tokens);
      await clearExecAccessCache();
      return back(request, state.next);
    }
    if (!(await hasExecAccess(email))) return back(request, "/dashboard", "This Google account does not have access.");
    const response = back(request, state.next);
    const cookie = sessionCookie(email, name);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    return back(request, state.next, publicMessage(error, "Google sign-in failed. Please try again."));
  }
}
