import { sign, verify } from "@/lib/membership/signing";

const PURPOSE = "delib-export";
const TTL_MS = 60 * 60_000;

// Google's "Save to Drive" fetches the file without the host's dashboard cookie,
// so its link carries a short-lived signature that names the delib and its host.
export function exportToken(sessionId: string, host: string) {
  return sign(PURPOSE, { sessionId, host }, TTL_MS);
}

// The host's email if the token is valid for this delib.
export function exportTokenHost(token: string, sessionId: string) {
  const data = verify<{ sessionId: string; host: string }>(PURPOSE, token);
  return data?.sessionId === sessionId ? data.host : null;
}
