import { keepAlive } from "@/lib/voting/keepalive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  return keepAlive(request);
}
