import { NextResponse, type NextRequest } from "next/server";
import { renewedSession, SESSION_COOKIE } from "@/lib/membership/session";

// Each visit to the dashboard renews the sign-in, so exec who visit at least once every 30 days stay signed in.
export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  try {
    const cookie = renewedSession(request.cookies.get(SESSION_COOKIE)?.value);
    if (cookie) response.cookies.set(cookie.name, cookie.value, cookie.options);
  } catch {
    // Without MEMBERSHIP_SECRET there is nothing to renew. The page shows the setup error.
  }
  return response;
}

// Node, not the edge runtime, for node:crypto in signing.ts.
export const config = { matcher: "/dashboard/:path*", runtime: "nodejs" };
