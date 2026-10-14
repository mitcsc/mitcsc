// Rules for short links, kept free of server imports so the dashboard and tests can use them.

// A link exec manage in the dashboard. slug is the short link (csc.mit.edu/<slug>), or null for a link that only lists on /links.
export interface ShortLink {
  id: string;
  title: string;
  slug: string | null;
  url: string;
  // The last day the link works, "YYYY-MM-DD" in Boston. Null keeps it forever.
  expiresOn: string | null;
  // Listed on the public Links page.
  shown: boolean;
  createdAt: number;
}

// Top-level paths the site already uses, so a short link cannot take them.
// tests/links.test.cjs checks that every folder in src/app and public is here.
export const RESERVED_SLUGS = [
  "_next", "alumni", "api", "dashboard", "deliberations", "exec", "favicon.ico", "font", "img",
  "join", "link", "links", "manifest.webmanifest", "vote",
];

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

// "  Formal-Tickets " → "formal-tickets". Spaces become hyphens.
export function normalizeSlug(raw: string) {
  return raw.trim().toLowerCase().replace(/^\/+/, "").replace(/\s+/g, "-");
}

// Why a slug cannot be used, or null when it can.
export function slugProblem(slug: string, taken: string[]) {
  if (!SLUG_PATTERN.test(slug)) return "Use lowercase letters, numbers, and hyphens.";
  if (RESERVED_SLUGS.includes(slug)) return `csc.mit.edu/${slug} is already a page on the site.`;
  if (taken.includes(slug)) return `Another link already uses csc.mit.edu/${slug}.`;
  return null;
}

// An http or https address. "example.com/x" gets https:// in front. Null when it is not a web address.
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const url = new URL(candidate);
      if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname.includes(".")) return url.href;
    } catch {
      // Try the next form.
    }
  }
  return null;
}

// A link works through the end of its last day in Boston. today is "YYYY-MM-DD" in Boston.
export function isActive(link: Pick<ShortLink, "expiresOn">, today: string) {
  return !link.expiresOn || link.expiresOn >= today;
}
