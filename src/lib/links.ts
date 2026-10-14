import { randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { unstable_cache } from "next/cache";
import { isActive, normalizeSlug, normalizeUrl, slugProblem, type ShortLink } from "./link-rules";
import { localDate } from "./membership/config";
import { MembershipError } from "./membership/errors";
import { redis, updateJson } from "./membership/redis";

export type { ShortLink } from "./link-rules";

// What the public Links page shows.
export interface LinkItem {
  title: string;
  url: string;
}

const PREFIX = "csc:links:v1";
const LIST_KEY = `${PREFIX}:list`;
// Clicks on each short link, by link id.
const CLICKS_KEY = `${PREFIX}:clicks`;

// Public reads come from Next's data cache, so visits and redirects rarely reach Redis.
// Every change in the dashboard clears the cache through this tag.
export const LINKS_TAG = "links";

type LinkList = { links: ShortLink[] };

// All links in their order on the Links page. The first read copies the old Google Sheet in.
export async function allLinks(): Promise<ShortLink[]> {
  const raw = await redis<string | null>("GET", LIST_KEY);
  if (raw) return (JSON.parse(raw) as LinkList).links;
  // A failed sheet read throws, so nothing is stored and the next read tries again.
  const links = await sheetLinks();
  // NX: if two first reads race, the first copy wins and both return it.
  await redis("SET", LIST_KEY, JSON.stringify({ links }), "NX");
  return allLinks();
}

const cachedLinks = unstable_cache(allLinks, ["links"], { tags: [LINKS_TAG], revalidate: 3600 });

async function readCached() {
  return cachedLinks().catch(() => [] as ShortLink[]);
}

export async function getLinks(): Promise<LinkItem[]> {
  const today = localDate(new Date());
  return (await readCached()).filter((l) => l.shown && isActive(l, today)).map(({ title, url }) => ({ title, url }));
}

// The working link for csc.mit.edu/<slug>, or null.
export async function resolveShortlink(slug: string): Promise<ShortLink | null> {
  const wanted = slug.toLowerCase();
  const today = localDate(new Date());
  return (await readCached()).find((l) => l.slug === wanted && isActive(l, today)) ?? null;
}

export async function countClick(id: string) {
  await redis("HINCRBY", CLICKS_KEY, id, 1).catch(() => undefined);
}

export async function linkClicks(): Promise<Record<string, number>> {
  const flat = await redis<string[]>("HGETALL", CLICKS_KEY);
  const out: Record<string, number> = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = Number(flat[i + 1]);
  return out;
}

export interface LinkInput {
  title: string;
  slug: string;
  url: string;
  expiresOn: string;
  shown: boolean;
}

function cleanLink(input: LinkInput, others: ShortLink[]) {
  const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
  if (!title) throw new MembershipError("Give the link a title.");
  if (title.length > 100) throw new MembershipError("Keep the title under 100 characters.");
  const url = typeof input.url === "string" && input.url.length <= 2000 ? normalizeUrl(input.url) : null;
  if (!url) throw new MembershipError("Enter a web address, like https://example.com.");
  const slug = typeof input.slug === "string" && input.slug.trim() ? normalizeSlug(input.slug) : null;
  if (slug) {
    const problem = slugProblem(slug, others.flatMap((l) => (l.slug ? [l.slug] : [])));
    if (problem) throw new MembershipError(problem);
  }
  const expiresOn = typeof input.expiresOn === "string" && input.expiresOn ? input.expiresOn : null;
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) throw new MembershipError("Pick a valid date.");
  return { title, slug, url, expiresOn, shown: !!input.shown };
}

async function changeLinks(change: (links: ShortLink[]) => ShortLink[]) {
  await allLinks();
  const list = await updateJson<LinkList>(LIST_KEY, ({ links }) => ({ links: change(links) }));
  if (!list) throw new MembershipError("Links storage is missing. Please try again.", 503);
  return list.links;
}

// Adds a link at the top of the list, or saves changes to one.
export async function saveLink(id: string | null, input: LinkInput) {
  let saved: ShortLink | null = null;
  await changeLinks((links) => {
    const fields = cleanLink(input, links.filter((l) => l.id !== id));
    if (!id) {
      saved = { id: randomUUID().slice(0, 8), ...fields, createdAt: Date.now() };
      return [saved, ...links];
    }
    if (!links.some((l) => l.id === id)) throw new MembershipError("This link no longer exists.", 404);
    return links.map((l) => (l.id === id ? (saved = { ...l, ...fields }) : l));
  });
  return saved!;
}

export async function deleteLink(id: string) {
  await changeLinks((links) => links.filter((l) => l.id !== id));
  await redis("HDEL", CLICKS_KEY, id);
}

// Moves a link one place up (-1) or down (1) in the list.
export async function moveLink(id: string, step: -1 | 1) {
  await changeLinks((links) => {
    const from = links.findIndex((l) => l.id === id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= links.length) return links;
    const next = [...links];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });
}

// The links from the old Google Sheet (Title, Shortlink, URL, Expiry), read once when Redis has none.
// A row whose short link is invalid or repeated keeps its link but loses the short link.
async function sheetLinks(): Promise<ShortLink[]> {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!clientEmail || !privateKey || !sheetId) return [];
  const auth = new GoogleAuth({ credentials: { client_email: clientEmail, private_key: privateKey }, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const token = await (await auth.getClient()).getAccessToken();
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:D`, { headers: { Authorization: `Bearer ${token.token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read the links sheet (${response.status}).`);
  const rows = ((await response.json()).values ?? []) as string[][];
  return linksFromRows(rows, Date.now());
}

export function linksFromRows(rows: string[][], now: number): ShortLink[] {
  const links: ShortLink[] = [];
  rows.slice(1).forEach((row, i) => {
    const title = (row[0] || "").replace(/\s+/g, " ").trim().slice(0, 100);
    const url = normalizeUrl(row[2] || "");
    if (!title || !url) return;
    const slug = normalizeSlug(row[1] || "");
    const day = sheetDay((row[3] || "").trim());
    links.push({
      id: randomUUID().slice(0, 8), title, url, expiresOn: day, shown: true, createdAt: now + i,
      slug: slug && !slugProblem(slug, links.flatMap((l) => (l.slug ? [l.slug] : []))) ? slug : null,
    });
  });
  return links;
}

// The day written in the sheet's Expiry cell, as "YYYY-MM-DD". "2026-10-20" and "10/20/2026" both give 2026-10-20.
function sheetDay(cell: string) {
  if (/^\d{4}-\d{2}-\d{2}/.test(cell)) return cell.slice(0, 10);
  const date = new Date(cell);
  if (!cell || Number.isNaN(date.getTime())) return null;
  // A date without a time parses as midnight on this machine, so its local parts are the written day.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
