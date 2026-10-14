import { formatDay, shortYear, TIME_ZONE } from "./config";
import { MembershipError } from "./errors";
import { cardToken } from "./signing";
import type { Member, YearConfig } from "./types";

// Membership cards for Apple Wallet and Google Wallet, made by WalletWallet
// (https://www.walletwallet.dev/docs). Everything about the card's look lives in passSpec(),
// so moving to a paid plan means adding the Pro fields there and setting WALLETWALLET_PLAN=pro.
const API = "https://api.walletwallet.dev/api/passes";

export function walletEnabled() {
  return !!process.env.WALLETWALLET_API_KEY;
}

function proPlan() {
  return process.env.WALLETWALLET_PLAN === "pro";
}

// The card expires at the end of the chosen day in Boston.
function expiration(isoDate: string) {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${isoDate}T12:00:00Z`)).find((p) => p.type === "timeZoneName")!.value.replace("GMT", "") || "+00:00";
  return `${isoDate}T23:59:00${offset}`;
}

export function passSpec(config: YearConfig, member: Member, siteOrigin: string) {
  return {
    barcodeValue: cardToken(config.year, member.kerb),
    barcodeFormat: "QR",
    barcodeAltText: member.kerb,
    logoText: "MIT CSC",
    organizationName: "MIT Chinese Students Club",
    description: `MIT CSC membership card for ${config.year}`,
    headerFields: [{ label: "MEMBER", value: shortYear(config.year) }],
    primaryFields: [{ label: "NAME", value: member.name }],
    secondaryFields: [
      { label: "CLASS", value: member.classYear },
      { label: "VALID UNTIL", value: formatDay(config.walletExpiresOn, true) },
    ],
    backFields: [
      { label: "KERBEROS", value: member.kerb },
      { label: "QUESTIONS", value: "mitcsc@mit.edu" },
    ],
    colorPreset: "red",
    expirationDate: expiration(config.walletExpiresOn),
    sharingProhibited: true,
    ...(proPlan() ? { color: "#9f1f22", logoURL: `${siteOrigin}/img/logo/logo.png` } : {}),
  };
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const key = process.env.WALLETWALLET_API_KEY;
  if (!key) throw new MembershipError("Wallet cards are not set up yet.", 503);
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new MembershipError("Wallet cards are unavailable right now. Please try again.", 503);
  }
  if (!response.ok) {
    console.error(JSON.stringify({ event: "membership_wallet_error", status: response.status }));
    throw new MembershipError(response.status === 429 ? "Wallet cards are paused until next month. Show your kerb at check-in instead." : "Wallet cards are unavailable right now. Please try again.", 503);
  }
  return (await response.json()) as T;
}

export async function createPass(config: YearConfig, member: Member, siteOrigin: string) {
  const pass = await call<{ serialNumber: string; shareUrl: string }>(API, { method: "POST", body: JSON.stringify(passSpec(config, member, siteOrigin)) });
  return { serial: pass.serialNumber, shareUrl: pass.shareUrl };
}

export async function revokePass(serial: string) {
  await call(`${API}/${encodeURIComponent(serial)}`, { method: "DELETE" });
}
