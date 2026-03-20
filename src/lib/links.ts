import { GoogleAuth } from "google-auth-library";

export interface LinkItem {
  title: string;
  shortlink: string;
  url: string;
}

function resolveUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    return null;
  } catch {
    // no protocol — try prepending https://
  }

  try {
    const url = new URL(`https://${trimmed}`);
    if (url.hostname.includes(".")) return url.href;
    return null;
  } catch {
    return null;
  }
}

async function fetchRows(): Promise<string[][]> {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!clientEmail || !privateKey || !sheetId) return [];

  const auth = new GoogleAuth({
    credentials: { client_email: clientEmail, private_key: privateKey },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:D`,
    {
      headers: { Authorization: `Bearer ${token.token}` },
      next: { revalidate: 60 },
    },
  );

  if (!res.ok) return [];

  const data = await res.json();
  return data.values ?? [];
}

function parseRows(rows: string[][]): LinkItem[] {
  const now = new Date();

  return rows
    .slice(1)
    .filter((row) => row[0] && row[2])
    .filter((row) => {
      const expiry = row[3]?.trim();
      if (!expiry) return true;
      const expiryDate = new Date(expiry);
      return isNaN(expiryDate.getTime()) || expiryDate > now;
    })
    .map((row) => ({
      title: row[0],
      shortlink: row[1]?.trim().toLowerCase() || "",
      url: resolveUrl(row[2]),
    }))
    .filter((link): link is LinkItem => link.url !== null);
}

export async function getLinks(): Promise<LinkItem[]> {
  try {
    const rows = await fetchRows();
    return parseRows(rows);
  } catch {
    return [];
  }
}

export async function resolveShortlink(slug: string): Promise<string | null> {
  try {
    const links = await getLinks();
    const match = links.find((link) => link.shortlink === slug.toLowerCase());
    return match?.url ?? null;
  } catch {
    return null;
  }
}
