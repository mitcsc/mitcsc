import { randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";
import { isActive, normalizeSlug, normalizeUrl, slugProblem, type ShortLink } from "./link-rules";
import { localDate } from "./membership/config";
import { MembershipError } from "./membership/errors";
import { redis, updateJson } from "./membership/redis";

export type { ShortLink } from "./link-rules";

// What the public Links page shows.
interface LinkItem {
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

// All links in their order on the Links page.
export async function allLinks(): Promise<ShortLink[]> {
  const raw = await redis<string | null>("GET", LIST_KEY);
  return raw ? (JSON.parse(raw) as LinkList).links : [];
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
  // A new database has no list yet. NX keeps an existing one.
  await redis("SET", LIST_KEY, JSON.stringify({ links: [] }), "NX");
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

// Puts the links in the order of ids, as dragged in the dashboard.
// A link missing from ids, for example one added meanwhile in another tab, stays at the top.
export async function reorderLinks(ids: string[]) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new MembershipError("Invalid order.");
  await changeLinks((links) => {
    const place = new Map(ids.map((id, i) => [id, i]));
    return [...links].sort((a, b) => (place.get(a.id) ?? -1) - (place.get(b.id) ?? -1));
  });
}
