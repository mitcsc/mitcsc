import { NextResponse } from "next/server";
import { requireExec } from "@/lib/membership/exec-auth";
import { startFlow } from "@/lib/membership/oauth-flow";

export const dynamic = "force-dynamic";

// "Connect" or "Reconnect" for the club Google account. Only signed-in exec can start it.
export async function GET(request: Request) {
  try {
    await requireExec();
  } catch {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return startFlow(request, "connect");
}
