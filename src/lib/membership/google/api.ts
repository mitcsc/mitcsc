import { MembershipError } from "../errors";
import { clubAccessToken } from "./oauth";

export class GoogleApiError extends MembershipError {
  constructor(public googleStatus: number, message: string) {
    super(message, googleStatus === 429 ? 429 : 502);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

// When Google says it is busy, a read waits this long before each retry. Google asks clients to back off like this.
const RETRY_DELAYS_MS = [500, 2000];
// The longest wait a Retry-After header can ask for before the read gives up instead.
const MAX_RETRY_AFTER_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryDelay(response: Response, attempt: number) {
  const asked = Number(response.headers.get("retry-after")) * 1000;
  if (asked > 0) return Math.min(asked, MAX_RETRY_AFTER_MS);
  return RETRY_DELAYS_MS[attempt] * (0.75 + Math.random() / 2);
}

// Sends a request to a Google API as the club account. Never logs URLs, payloads, or tokens.
// Reads that hit a rate limit or a Google server error are retried with backoff.
// `upload` sends raw bytes with their own content type, for a Drive upload, instead of a JSON body.
type Upload = { bytes: Uint8Array; type: string };

async function send(url: string, init: { method?: string; body?: unknown; upload?: Upload; query?: Query; timeoutMs?: number; auth?: boolean }) {
  const method = init.method || "GET";
  const target = new URL(url);
  for (const [name, value] of Object.entries(init.query || {})) if (value !== undefined) target.searchParams.set(name, String(value));
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = init.upload ? { "Content-Type": init.upload.type } : init.body === undefined ? {} : { "Content-Type": "application/json" };
    if (init.auth !== false) headers.Authorization = `Bearer ${await clubAccessToken()}`;
    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers,
        ...(init.upload ? { body: new Uint8Array(init.upload.bytes) } : init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        cache: "no-store",
        signal: AbortSignal.timeout(init.timeoutMs || 20_000),
      });
    } catch {
      throw new GoogleApiError(503, "Google is unavailable. Please try again.");
    }
    if (response.ok) return response;
    // Drive reports some rate limits as 403 with a rateLimitExceeded reason.
    const reason = await response.text().catch(() => "");
    const rateLimited = response.status === 429 || (response.status === 403 && /rateLimitExceeded/i.test(reason));
    if (method === "GET" && (rateLimited || response.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
      await sleep(retryDelay(response, attempt));
      continue;
    }
    console.error(JSON.stringify({ event: "membership_google_error", api: target.hostname, status: response.status, rateLimited }));
    if (rateLimited) throw new GoogleApiError(429, "Google is busy. Please try again in a minute.");
    if (response.status === 404) throw new GoogleApiError(404, "Google could not find that file. It may have been deleted or unshared.");
    if (response.status === 403) throw new GoogleApiError(403, "The club Google account cannot open that file.");
    throw new GoogleApiError(response.status, "Google returned an error. Please try again.");
  }
}

// Calls a Google API as the club account and returns its JSON reply.
export async function google<T>(url: string, init: { method?: string; body?: unknown; upload?: Upload; query?: Query; timeoutMs?: number } = {}): Promise<T> {
  const response = await send(url, init);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// Downloads bytes from Google, for example a photo from Drive. `auth: false` is for signed links that need no token.
export async function googleBytes(url: string, init: { query?: Query; auth?: boolean } = {}) {
  const response = await send(url, { ...init, timeoutMs: 30_000 });
  return { bytes: Buffer.from(await response.arrayBuffer()), type: response.headers.get("content-type") || "" };
}

export const DRIVE = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
export const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
