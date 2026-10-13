import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/membership/exec-auth";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new NextResponse(null, { status: 403 });
  const response = NextResponse.redirect(new URL("/dashboard", request.url), 303);
  response.cookies.delete({ name: SESSION_COOKIE, path: "/" });
  return response;
}
