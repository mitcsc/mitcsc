import { createHash, timingSafeEqual } from "node:crypto";
import { publicMessage } from "@/lib/membership/errors";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear } from "@/lib/membership/store";
import { syncMembersNow } from "@/lib/membership/sync";
import { checkVenmo } from "@/lib/membership/venmo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const reply = (status: number, body: object) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

// Daily safety net: catches Venmo payments nobody checked for, and rewrites the members sheet.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return reply(503, { error: "Cron is not configured." });
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(request.headers.get("authorization") || ""), digest(`Bearer ${secret}`))) return reply(401, { error: "Unauthorized." });

  const config = await currentYear().catch(() => null);
  const connection = await clubConnection().catch(() => null);
  if (!config || !connection || connection.brokenAt) return reply(200, { ok: true, skipped: "No school year or no Google connection." });
  const result: Record<string, unknown> = { ok: true };
  try {
    result.venmo = (await checkVenmo(config, { minGapSeconds: 30 })).confirmed.length;
  } catch (error) {
    result.ok = false;
    result.venmo = publicMessage(error, "Venmo check failed.");
  }
  try {
    await syncMembersNow(config.year);
  } catch (error) {
    result.ok = false;
    result.sync = publicMessage(error, "Sheet sync failed.");
  }
  return reply(result.ok ? 200 : 500, result);
}
