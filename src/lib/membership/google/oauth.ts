import { OAuth2Client } from "google-auth-library";
import { MembershipError } from "../errors";
import { keys } from "../keys";
import { getJson, redis, updateJson } from "../redis";

// Exec sign in asks only for the email address. Connecting the club account asks for
// Drive (folders, sheets, sharing) and read-only Gmail (Venmo emails).
export const SIGN_IN_SCOPES = ["openid", "email"];
export const CLUB_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/gmail.readonly"];

export interface ClubConnection {
  email: string;
  refreshToken: string;
  scopes: string[];
  connectedAt: number;
  connectedBy: string;
  // Set when Google rejects the refresh token, for example after a password change.
  brokenAt: number | null;
  accessToken: string | null;
  accessTokenExpiresAt: number;
}

export function clubEmail() {
  return (process.env.CLUB_GOOGLE_EMAIL || "mitcsc@gmail.com").toLowerCase();
}

function client() {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw new MembershipError("Google sign-in is not configured. Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.", 503);
  return { id, secret };
}

export function redirectUri(origin: string) {
  return `${origin}/api/auth/google/callback`;
}

export function authorizationUrl(options: { origin: string; state: string; scopes: string[]; offline: boolean; loginHint?: string }) {
  const params = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri(options.origin),
    response_type: "code",
    scope: options.scopes.join(" "),
    state: options.state,
    include_granted_scopes: "false",
    prompt: options.offline ? "consent" : "select_account",
    ...(options.offline ? { access_type: "offline" } : {}),
    ...(options.loginHint ? { login_hint: options.loginHint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope: string;
  error?: string;
}

async function tokenRequest(body: Record<string, string>) {
  const { id, secret } = client();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  return { ok: response.ok, data };
}

export async function exchangeCode(code: string, origin: string) {
  const { ok, data } = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(origin) });
  if (!ok || !data.id_token) throw new MembershipError("Google sign-in failed. Please try again.", 401);
  const ticket = await new OAuth2Client(client().id).verifyIdToken({ idToken: data.id_token, audience: client().id });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) throw new MembershipError("Google did not share a verified email address.", 401);
  return { email: payload.email.toLowerCase(), tokens: data };
}

export async function clubConnection() {
  return getJson<ClubConnection>(keys.google);
}

export async function saveClubConnection(email: string, connectedBy: string, tokens: TokenResponse) {
  const granted = tokens.scope.split(" ");
  const missing = CLUB_SCOPES.filter((scope) => scope.startsWith("https://") && !granted.includes(scope));
  if (missing.length) throw new MembershipError("Google did not grant Drive and Gmail access. Connect again and allow every permission.", 400);
  if (!tokens.refresh_token) throw new MembershipError("Google did not return a long-term token. Remove the app's access in the Google account and connect again.", 400);
  const connection: ClubConnection = {
    email,
    refreshToken: tokens.refresh_token,
    scopes: granted,
    connectedAt: Date.now(),
    connectedBy,
    brokenAt: null,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in - 60) * 1000,
  };
  await redis("SET", keys.google, JSON.stringify(connection));
}

export class ClubNotConnected extends MembershipError {
  constructor() {
    super("The club Google account is not connected. Connect it in the dashboard Settings tab.", 503);
  }
}

// An access token for the club account, refreshed when it is about to expire.
export async function clubAccessToken() {
  const connection = await clubConnection();
  if (!connection || connection.brokenAt) throw new ClubNotConnected();
  if (connection.accessToken && connection.accessTokenExpiresAt > Date.now()) return connection.accessToken;
  const { ok, data } = await tokenRequest({ grant_type: "refresh_token", refresh_token: connection.refreshToken });
  if (!ok) {
    if (data.error === "invalid_grant") {
      await updateJson<ClubConnection>(keys.google, (c) => (c.refreshToken === connection.refreshToken ? { ...c, brokenAt: Date.now(), accessToken: null } : c));
      throw new ClubNotConnected();
    }
    throw new MembershipError("Google is unavailable. Please try again.", 503);
  }
  await updateJson<ClubConnection>(keys.google, (c) => (c.refreshToken === connection.refreshToken
    ? { ...c, accessToken: data.access_token, accessTokenExpiresAt: Date.now() + (data.expires_in - 60) * 1000 }
    : c));
  return data.access_token;
}
