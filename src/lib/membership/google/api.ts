import { MembershipError } from "../errors";
import { clubAccessToken } from "./oauth";

export class GoogleApiError extends MembershipError {
  constructor(public googleStatus: number, message: string) {
    super(message, googleStatus === 429 ? 429 : 502);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

// Sends a request to a Google API as the club account. Never logs URLs, payloads, or tokens.
async function send(url: string, init: { method?: string; body?: unknown; query?: Query; timeoutMs?: number }) {
  const token = await clubAccessToken();
  const target = new URL(url);
  for (const [name, value] of Object.entries(init.query || {})) if (value !== undefined) target.searchParams.set(name, String(value));
  let response: Response;
  try {
    response = await fetch(target, {
      method: init.method || "GET",
      headers: { Authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs || 20_000),
    });
  } catch {
    throw new GoogleApiError(503, "Google is unavailable. Please try again.");
  }
  if (!response.ok) {
    console.error(JSON.stringify({ event: "membership_google_error", api: target.hostname, status: response.status }));
    if (response.status === 404) throw new GoogleApiError(404, "Google could not find that file. It may have been deleted or unshared.");
    if (response.status === 403) throw new GoogleApiError(403, "The club Google account cannot open that file.");
    if (response.status === 429) throw new GoogleApiError(429, "Google is busy. Please try again in a minute.");
    throw new GoogleApiError(response.status, "Google returned an error. Please try again.");
  }
  return response;
}

// Calls a Google API as the club account and returns its JSON reply.
export async function google<T>(url: string, init: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const response = await send(url, init);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// Downloads a file's bytes as the club account, for example a photo from Drive.
export async function googleBytes(url: string, query: Query = {}) {
  const response = await send(url, { query, timeoutMs: 60_000 });
  return Buffer.from(await response.arrayBuffer());
}

export const DRIVE = "https://www.googleapis.com/drive/v3";
export const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
export const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
