import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { MembershipError } from "./errors";
import { sendEmail } from "./google/gmail";
import { canSendEmail, clubConnection } from "./google/oauth";
import { keys } from "./keys";
import { redis } from "./redis";
import type { Member } from "./types";

const LINK_MINUTES = 15;
const SITE = "https://csc.mit.edu";

// Production links always point at csc.mit.edu, so a forged Host header can't send someone elsewhere.
async function origin() {
  if (process.env.NODE_ENV === "production") return SITE;
  const list = await headers();
  return `${list.get("x-forwarded-proto") || "http"}://${list.get("host")}`;
}

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// Emails kerb@mit.edu a link that opens the member's card. Only the inbox owner can use it.
export async function emailCardLink(member: Member) {
  if (!canSendEmail(await clubConnection())) throw new MembershipError("Card emails are off right now. Email mitcsc@mit.edu and exec will send your card.", 503);
  const id = randomBytes(24).toString("base64url");
  await redis("SET", keys.cardLink(id), `${member.year}:${member.kerb}`, "EX", LINK_MINUTES * 60);
  const url = `${await origin()}/join/pass?link=${id}`;
  const first = member.name.split(" ")[0] || member.kerb;
  await sendEmail({
    to: `${member.kerb}@mit.edu`,
    subject: "Your MIT CSC membership card",
    text: [
      `Hi ${first},`,
      "",
      `Open this link to add your MIT CSC ${member.year} membership card to Apple Wallet or Google Wallet:`,
      url,
      "",
      `The link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`,
      "",
      "MIT CSC",
    ].join("\n"),
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#18181b;max-width:480px">
<p>Hi ${escape(first)},</p>
<p>Open this link to add your MIT CSC ${member.year} membership card to Apple Wallet or Google Wallet.</p>
<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#c5393a;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px">Open my membership card</a></p>
<p style="color:#71717a;font-size:13px">The link works once and expires in ${LINK_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p>
<p>MIT CSC</p>
</div>`,
  });
}

const LINK_ID = /^[A-Za-z0-9_-]{32}$/;

// Whether a link from the email can still be used, without using it up.
export async function cardLinkIsLive(id: string) {
  return LINK_ID.test(id) && (await redis<number>("EXISTS", keys.cardLink(id))) === 1;
}

// Uses up a link from the email. Returns the year and kerb it was for, or null when it is unknown, used, or expired.
export async function redeemCardLink(id: string) {
  if (!LINK_ID.test(id)) return null;
  const value = await redis<string | null>("GETDEL", keys.cardLink(id));
  const match = value && /^(\d{4}-\d{4}):([a-z0-9_]+)$/.exec(value);
  return match ? { year: match[1], kerb: match[2] } : null;
}
