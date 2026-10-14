import { randomBytes } from "node:crypto";
import { CLUB_EMAIL } from "../config";
import { GMAIL, google } from "./api";
import { clubEmail } from "./oauth";

// Non-ASCII header text, like a curly quote in the subject, needs RFC 2047 encoding.
function header(value: string) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function body(text: string) {
  return Buffer.from(text).toString("base64").replace(/.{76}/g, "$&\r\n");
}

// Sends one email from the club Google account. Replies go to the club's MIT address.
export async function sendEmail(email: { to: string; subject: string; text: string; html: string }) {
  const boundary = `csc-${randomBytes(12).toString("hex")}`;
  const message = [
    `From: ${header("MIT CSC")} <${clubEmail()}>`,
    `To: ${email.to}`,
    `Reply-To: ${CLUB_EMAIL}`,
    `Subject: ${header(email.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body(email.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body(email.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
  await google(`${GMAIL}/messages/send`, { method: "POST", body: { raw: Buffer.from(message).toString("base64url") } });
}
