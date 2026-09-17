import { GoogleAuth } from "google-auth-library";
import { VotingError } from "./security";

let auth: GoogleAuth | undefined;
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
export function invalidate(sheetId: string) {
  for (const key of cache.keys()) if (key.includes(sheetId) && key.includes("/values")) cache.delete(key);
}
export async function sheets<T>(sheetId: string, suffix = "", method = "GET", data?: unknown, fresh = false): Promise<T> {
  const key = `${sheetId}${suffix}`;
  if (method === "GET" && !fresh) {
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value as T;
    const running = pending.get(key);
    if (running) return running as Promise<T>;
  }
  const execute = async () => {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!email || !privateKey) throw new VotingError("Google service account credentials are not configured.", 503);
    auth ||= new GoogleAuth({ credentials: { client_email: email, private_key: privateKey }, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    let response: Response;
    try {
      const client = await auth.getClient();
      const token = await client.getAccessToken();
      response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${suffix}`, {
        method, headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }), cache: "no-store", signal: AbortSignal.timeout(15_000),
      });
    } catch { throw new VotingError("Google Sheets is unavailable. Your local ballot is safe; please retry.", 503); }
    if (!response.ok) throw new VotingError(response.status === 429 ? "Google Sheets is busy. Please retry in a moment." : "Cannot access the election spreadsheet. Check its link, sharing permissions, and tab structure.", response.status === 429 ? 429 : 503);
    const result = await response.json() as T;
    if (method === "GET") {
      if (cache.size > 100) cache.clear();
      cache.set(key, { until: Date.now() + (suffix.startsWith("?fields=") ? 60_000 : 5000), value: result });
    } else {
      invalidate(sheetId);
      if (suffix === ":batchUpdate") for (const k of cache.keys()) if (k.startsWith(sheetId)) cache.delete(k);
    }
    return result;
  };
  const promise = execute();
  if (method === "GET" && !fresh) pending.set(key, promise);
  try { return await promise; } finally { if (method === "GET" && !fresh) pending.delete(key); }
}
export async function readRanges(id: string, ranges: string[], fresh = false) {
  const result = await sheets<{ valueRanges: { values?: string[][] }[] }>(id, `/values:batchGet?${ranges.map(r => `ranges=${encodeURIComponent(r)}`).join("&")}&valueRenderOption=UNFORMATTED_VALUE`, "GET", undefined, fresh);
  return result.valueRanges.map(range => (range.values || []).map(row => row.map(cell => String(cell))));
}
export async function writeRanges(id: string, data: { range: string; values: (string | number | boolean)[][] }[]) {
  return sheets(id, "/values:batchUpdate", "POST", { valueInputOption: "RAW", data });
}
