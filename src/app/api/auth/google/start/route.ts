import { NextResponse } from "next/server";
import { devEmail, sessionCookie } from "@/lib/membership/exec-auth";
import { safeNext, startFlow } from "@/lib/membership/oauth-flow";

export const dynamic = "force-dynamic";

// "Continue with Google" on the dashboard.
export async function GET(request: Request) {
  const dev = devEmail();
  if (dev) {
    const response = NextResponse.redirect(new URL(safeNext(new URL(request.url).searchParams.get("next")), request.url));
    const cookie = sessionCookie(dev);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  }
  return startFlow(request, "sign-in");
}
