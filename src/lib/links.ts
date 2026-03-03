import { GoogleAuth } from "google-auth-library";

export interface LinkItem {
  title: string;
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

export async function getLinks(): Promise<LinkItem[]> {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.GOOGLE_SHEET_ID;

  if (!clientEmail || !privateKey || !sheetId) return [];

  try {
    const auth = new GoogleAuth({
      credentials: { client_email: clientEmail, private_key: privateKey },
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const client = await auth.getClient();
    const token = await client.getAccessToken();

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:C`,
      {
        headers: { Authorization: `Bearer ${token.token}` },
        next: { revalidate: 60 },
      },
    );

    if (!res.ok) return [];

    const data = await res.json();
    const rows: string[][] = data.values ?? [];
    const now = new Date();

    return rows
      .slice(1)
      .filter((row) => row[0] && row[1])
      .filter((row) => {
        const expiry = row[2]?.trim();
        if (!expiry) return true;
        const expiryDate = new Date(expiry);
        return isNaN(expiryDate.getTime()) || expiryDate > now;
      })
      .map((row) => ({ title: row[0], url: resolveUrl(row[1]) }))
      .filter((link): link is LinkItem => link.url !== null);
  } catch {
    return [];
  }
}
