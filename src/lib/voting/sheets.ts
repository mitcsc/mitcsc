import { randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { VotingError } from "./security";

// This ID identifies this module's cache, not a physical Vercel machine.
const cacheId = randomUUID();
let requestSequence = 0;
function operationName(suffix: string) {
  if (suffix.startsWith("?fields=")) return "metadata";
  if (suffix.startsWith("/values:batchGet")) return "read_batch";
  if (suffix.startsWith("/values:batchUpdate")) return "write_batch";
  if (suffix.startsWith(":batchUpdate")) return "structure_write";
  if (suffix.includes(":append")) return "append";
  return "values";
}
let auth: GoogleAuth | undefined;
const cache = new Map<string, { storedAt: number; value: unknown }>();
const generations = new Map<string, number>();
const cooldowns = new Map<string, {until: number; failures: number}>();
const pending = new Map<string, Promise<unknown>>();
function rangeTab(range: string) { return range.split("!")[0].replace(/^'|'$/g, ""); }
export function invalidateMetadata(sheetId: string) {
  for (const key of cache.keys()) if (key.startsWith(`${sheetId}?fields=`)) cache.delete(key);
}
export function invalidate(sheetId: string, tabs?: string[]) {
  generations.set(sheetId, (generations.get(sheetId) || 0) + 1);
  for (const key of cache.keys()) {
    if (!key.startsWith(sheetId) || !key.includes("/values")) continue;
    const decoded = decodeURIComponent(key);
    if (!tabs || tabs.some(tab => decoded.includes(`'${tab}'!`))) cache.delete(key);
  }
}
export async function sheets<T>(sheetId: string, suffix = "", method = "GET", data?: unknown, fresh = false, ttlMs = 5000): Promise<T> {
  const key = `${sheetId}${suffix}`;
  if (method === "GET" && !fresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.storedAt < (suffix.startsWith("?fields=") ? 24 * 3600_000 : ttlMs)) return hit.value as T;
    const running = pending.get(key);
    if (running) return running as Promise<T>;
  }
  const kind = method === "GET" ? "read" : "write";
  const cooldown = cooldowns.get(kind);
  if (cooldown && cooldown.until > Date.now()) throw new VotingError("Google Sheets is busy. Retrying shortly.", 429, Math.ceil((cooldown.until - Date.now()) / 1000));
  const generation = generations.get(sheetId) || 0;
  const execute = async () => {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!email || !privateKey) throw new VotingError("Google service account credentials are not configured.", 503);
    auth ||= new GoogleAuth({ credentials: { client_email: email, private_key: privateKey }, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    let response: Response;
    try {
      const client = await auth.getClient();
      const token = await client.getAccessToken();
      const sequence = ++requestSequence;
      const startedAt = new Date().toISOString();
      const started = performance.now();
      let status: number | null = null;
      try {
        response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${suffix}`, {
          method, headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }), cache: "no-store", signal: AbortSignal.timeout(15_000),
        });
        status = response.status;
      } finally {
        // One record per outbound attempt. Cache hits, deduplicated callers, and cooldowns do not count.
        // Never pass request URLs, spreadsheet IDs, payloads, credentials, or error messages to the logger.
        if (process.env.VERCEL === "1" || process.env.VOTING_REQUEST_LOGS === "1") {
          try {
            console.log(JSON.stringify({event: "voting_sheets_request", cacheId, sequence, startedAt,
              kind, operation: operationName(suffix), fresh, status,
              outcome: status === null ? "transport_error" : status >= 200 && status < 300 ? "ok" : "http_error",
              durationMs: Math.round(performance.now() - started)}));
          } catch { /* Logging must never interrupt voting. */ }
        }
      }
    } catch { throw new VotingError("Google Sheets is unavailable. Your local ballot is safe; please retry.", 503); }
    if (response.status === 429) {
      const failures = (cooldowns.get(kind)?.failures || 0) + 1;
      const delay = Math.min(30_000, 1000 * 2 ** (failures - 1));
      cooldowns.set(kind, {until: Date.now() + delay, failures});
      throw new VotingError("Google Sheets is busy. Retrying shortly.", 429, Math.ceil(delay / 1000));
    }
    if (response.ok) cooldowns.delete(kind);
    if (!response.ok) {
      invalidateMetadata(sheetId);
      throw new VotingError("Cannot access the election spreadsheet. Check its link, sharing permissions, and tab structure.", 503);
    }
    const result = await response.json() as T;
    if (method === "GET") {
      if (cache.size > 100) cache.clear();
      if (!fresh && generation === (generations.get(sheetId) || 0)) cache.set(key, { storedAt: Date.now(), value: result });
      // Admin/ballot batches already fetched Session. Reuse that same read for voter polling.
      // Admission still bypasses this cache, and a concurrent local mutation prevents stale priming.
      if (suffix.startsWith("/values:batchGet?") && generation === (generations.get(sheetId) || 0)) {
        const ranges = new URLSearchParams(suffix.split("?")[1]).getAll("ranges");
        const index = ranges.indexOf("'Session'!A1:B20");
        const valueRanges = (result as {valueRanges?: unknown[]}).valueRanges;
        if (index >= 0 && valueRanges?.[index]) {
          const sessionKey = `${sheetId}/values:batchGet?ranges=${encodeURIComponent(ranges[index])}&valueRenderOption=UNFORMATTED_VALUE`;
          cache.set(sessionKey, {storedAt: Date.now(), value: {valueRanges: [valueRanges[index]]}});
        }
      }
    } else {
      const ranges = (data as {data?: {range: string}[]})?.data?.map(entry => rangeTab(entry.range));
      const appendRange = suffix.includes(":append") ? rangeTab(decodeURIComponent(suffix.slice(8).split(":append")[0])) : undefined;
      invalidate(sheetId, ranges || (appendRange ? [appendRange] : undefined));
      if (suffix === ":batchUpdate") for (const k of cache.keys()) if (k.startsWith(sheetId)) cache.delete(k);
    }
    return result;
  };
  const promise = execute();
  if (method === "GET" && !fresh) pending.set(key, promise);
  try { return await promise; } finally { if (method === "GET" && !fresh) pending.delete(key); }
}
export async function readRanges(id: string, ranges: string[], fresh = false, ttlMs = 5000) {
  const result = await sheets<{ valueRanges: { values?: string[][] }[] }>(id, `/values:batchGet?${ranges.map(r => `ranges=${encodeURIComponent(r)}`).join("&")}&valueRenderOption=UNFORMATTED_VALUE`, "GET", undefined, fresh, ttlMs);
  return result.valueRanges.map(range => Array.from(range.values || [], row => (row || []).map(cell => String(cell))));
}
export async function writeRanges(id: string, data: { range: string; values: (string | number | boolean)[][] }[]) {
  return sheets(id, "/values:batchUpdate", "POST", { valueInputOption: "RAW", data });
}

