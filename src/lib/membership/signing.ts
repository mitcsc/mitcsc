import { createHmac, timingSafeEqual } from "node:crypto";
import { MembershipError } from "./errors";

function secret() {
  const value = process.env.MEMBERSHIP_SECRET;
  if (!value || value.length < 32) throw new MembershipError("Set MEMBERSHIP_SECRET to at least 32 random characters.", 503);
  return value;
}

function mac(purpose: string, payload: string) {
  return createHmac("sha256", secret()).update(`${purpose}\n${payload}`).digest();
}

function same(a: Buffer, b: Buffer) {
  return a.length === b.length && timingSafeEqual(a, b);
}

// A tamper-proof, expiring value for cookies and OAuth state.
export function sign<T extends object>(purpose: string, data: T, ttlMs: number) {
  const payload = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + ttlMs })).toString("base64url");
  return `${payload}.${mac(purpose, payload).toString("base64url")}`;
}

export function verify<T extends object>(purpose: string, token: string | undefined): T | null {
  if (!token || token.length > 4096) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!same(Buffer.from(signature, "base64url"), mac(purpose, payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as T & { exp: number };
    if (!Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// The value in a membership card QR code. It stays short so the code is easy to scan.
// Format: CSC1.<start year>.<kerb>.<signature>
export function cardToken(year: string, kerb: string) {
  const start = year.slice(0, 4);
  return `CSC1.${start}.${kerb}.${mac("card", `${start}.${kerb}`).subarray(0, 12).toString("base64url")}`;
}

export function readCardToken(value: string): { startYear: string; kerb: string } | null {
  const match = /^CSC1\.(\d{4})\.([a-z][a-z0-9_]{1,7})\.([A-Za-z0-9_-]{16})$/.exec(value.trim());
  if (!match) return null;
  const [, start, kerb, signature] = match;
  const expected = mac("card", `${start}.${kerb}`).subarray(0, 12);
  return same(Buffer.from(signature, "base64url"), expected) ? { startYear: start, kerb } : null;
}
