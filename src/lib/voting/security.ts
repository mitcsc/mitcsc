export class VotingError extends Error {
  constructor(message: string, public status = 400, public retryAfter?: number) { super(message); }
}
// A signed-in exec's place in one election. The id is derived from their email, so it is the same on every device.
export interface Identity { id: string; name: string; role: "admin" | "voter"; sessionId: string }
// Blocks requests from other sites. Compares with the Host header, because `next dev` reports every request URL as localhost.
export function requireOrigin(request: Request) {
  const host = request.headers.get("host") || new URL(request.url).host;
  let origin = "";
  try { origin = new URL(request.headers.get("origin") || "").host; } catch { /* A missing or opaque origin is rejected below. */ }
  if (!origin || origin !== host) throw new VotingError("Request origin is not allowed.", 403);
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 100_000) throw new VotingError("Request is too large.");
  try {
    const result = JSON.parse(raw);
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw new VotingError("Expected a JSON object."); }
}
export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new VotingError(`Invalid ${label}.`);
  return value.trim();
}
