import { GMAIL, google } from "./google/api";
import { keys } from "./keys";
import { redis } from "./redis";
import { getMember, markPaidEver, updateMember } from "./store";
import type { YearConfig } from "./types";

interface Part {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: Part[];
}

interface Message {
  id: string;
  payload: Part;
}

interface VenmoPayment {
  messageId: string;
  amount: number;
  year: string;
  kerb: string;
}

function findHtml(part: Part): string | null {
  if (part.mimeType === "text/html" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts || []) {
    const html = findHtml(child);
    if (html) return html;
  }
  return null;
}

function decodeEntities(text: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") return String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return named[code.toLowerCase()] ?? whole;
  });
}

// Lowercase, plain hyphens, no spaces around hyphens. Anything else must match the prefilled note exactly.
export function normalizeNote(note: string) {
  return note.normalize("NFKC").toLowerCase().replace(/[‐-―−]/g, "-").replace(/\s*-\s*/g, "-").replace(/\s+/g, " ").trim();
}

// Reads one Venmo "paid you" email. Returns null unless it is a genuine Venmo email
// whose note is exactly "CSC-<year>-<kerb>".
export function parseVenmoEmail(message: Message): VenmoPayment | null {
  const headers = message.payload.headers || [];
  // Google adds the topmost Authentication-Results header. Lower ones could be forged by the sender.
  const auth = headers.find((h) => h.name.toLowerCase() === "authentication-results")?.value.toLowerCase() || "";
  if (!/dkim=pass[^;]*header\.(i=@venmo\.com|d=venmo\.com)/.test(auth)) return null;
  const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value || "";
  const amountMatch = /\$\s?([\d,]+(?:\.\d{1,2})?)/.exec(subject);
  if (!/paid/i.test(subject) || !amountMatch) return null;
  const html = findHtml(message.payload);
  const noteHtml = html && /class=["'][^"']*\btransaction-note\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1];
  if (!noteHtml) return null;
  const note = normalizeNote(decodeEntities(noteHtml.replace(/<[^>]+>/g, " ")));
  const match = /^csc-(\d{4}-\d{4})-([a-z][a-z0-9_]{1,7})$/.exec(note);
  if (!match) return null;
  return { messageId: message.id, amount: Number(amountMatch[1].replace(/,/g, "")), year: match[1], kerb: match[2] };
}

// Confirms unpaid signups whose Venmo payment email has arrived. Each email confirms one signup.
// Returns the kerbs it confirmed. Runs at most once per few seconds per year.
export async function checkVenmo(config: YearConfig, options: { minGapSeconds?: number } = {}) {
  const gate = await redis("SET", keys.venmoCheck(config.year), String(Date.now()), "NX", "EX", options.minGapSeconds ?? 10);
  if (gate !== "OK") return { ran: false, confirmed: [] as string[] };
  const query = `from:venmo@venmo.com "CSC-${config.year}" newer_than:400d`;
  const list = await google<{ messages?: { id: string }[] }>(`${GMAIL}/messages`, { query: { q: query, maxResults: 200 } });
  const confirmed: string[] = [];
  for (const { id } of list.messages || []) {
    if (await redis<number>("EXISTS", keys.venmoMessage(id))) continue;
    const message = await google<Message>(`${GMAIL}/messages/${id}`, { query: { format: "full" } });
    const payment = parseVenmoEmail(message);
    if (!payment || payment.year !== config.year) {
      // This email can never match a signup, so skip it on later checks.
      await redis("SET", keys.venmoMessage(id), "-", "NX");
      continue;
    }
    const member = await getMember(config.year, payment.kerb);
    if (!member || member.status === "paid" || payment.amount + 1e-9 < member.price) continue;
    if ((await redis("SET", keys.venmoMessage(id), payment.kerb, "NX")) !== "OK") continue;
    await updateMember(config.year, payment.kerb, (m) => (m.status === "paid" ? m : {
      ...m, status: "paid", paidVia: "venmo", paidAt: Date.now(), confirmedBy: "Venmo check", venmoMessageId: id,
    }));
    confirmed.push(payment.kerb);
  }
  if (confirmed.length) await markPaidEver(confirmed);
  await redis("SET", `${keys.venmoCheck(config.year)}:last`, String(Date.now()));
  return { ran: true, confirmed };
}

export async function lastVenmoCheck(year: string) {
  const value = await redis<string | null>("GET", `${keys.venmoCheck(year)}:last`);
  return value ? Number(value) : null;
}
