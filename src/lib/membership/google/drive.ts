import { DRIVE, google } from "./api";

export const FOLDER = "application/vnd.google-apps.folder";
export const SPREADSHEET = "application/vnd.google-apps.spreadsheet";

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
}

function quote(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

async function listAll(q: string, orderBy = "folder,name") {
  const items: DriveItem[] = [];
  let pageToken: string | undefined;
  do {
    const page = await google<{ files: DriveItem[]; nextPageToken?: string }>(`${DRIVE}/files`, {
      query: { q, orderBy, pageSize: 200, pageToken, fields: "nextPageToken,files(id,name,mimeType)", supportsAllDrives: true, includeItemsFromAllDrives: true },
    });
    items.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken && items.length < 1000);
  return items;
}

// Folders (and optionally spreadsheets) directly inside a folder. "root" is My Drive.
export async function listChildren(parentId: string, includeSheets: boolean) {
  const types = includeSheets ? `(mimeType = '${FOLDER}' or mimeType = '${SPREADSHEET}')` : `mimeType = '${FOLDER}'`;
  return listAll(`${quote(parentId)} in parents and ${types} and trashed = false`);
}

// Folders and spreadsheets other people shared with the club account.
export async function listShared(includeSheets: boolean) {
  const types = includeSheets ? `(mimeType = '${FOLDER}' or mimeType = '${SPREADSHEET}')` : `mimeType = '${FOLDER}'`;
  return listAll(`sharedWithMe and ${types} and trashed = false`);
}

export async function getItem(id: string) {
  return google<DriveItem & { parents?: string[] }>(`${DRIVE}/files/${encodeURIComponent(id)}`, {
    query: { fields: "id,name,mimeType,parents", supportsAllDrives: true },
  });
}

// Names from My Drive down to the item, for example ["MIT CSC", "MIT CSC 2026-2027"].
export async function itemPath(id: string) {
  const names: { id: string; name: string }[] = [];
  let current: string | undefined = id;
  while (current && names.length < 8) {
    // A folder shared with the club account can have a parent it cannot see.
    const item: (DriveItem & { parents?: string[] }) | null = await getItem(current).catch(() => null);
    if (!item) break;
    if (!item.parents?.length) break; // My Drive itself
    names.unshift({ id: item.id, name: item.name });
    current = item.parents[0];
  }
  return names;
}

export async function createFolder(name: string, parentId: string) {
  return google<DriveItem>(`${DRIVE}/files`, {
    method: "POST",
    query: { fields: "id,name,mimeType", supportsAllDrives: true },
    body: { name, mimeType: FOLDER, parents: [parentId] },
  });
}

export async function createSpreadsheetFile(name: string, parentId: string) {
  return google<DriveItem>(`${DRIVE}/files`, {
    method: "POST",
    query: { fields: "id,name,mimeType", supportsAllDrives: true },
    body: { name, mimeType: SPREADSHEET, parents: [parentId] },
  });
}

interface Permission {
  emailAddress?: string;
  role: string;
  type: string;
  deleted?: boolean;
}

// Everyone who can edit the folder, including access shared on a parent folder.
export async function folderEditors(folderId: string) {
  const people: { email: string; role: "Owner" | "Editor" }[] = [];
  let pageToken: string | undefined;
  do {
    const page = await google<{ permissions: Permission[]; nextPageToken?: string }>(`${DRIVE}/files/${encodeURIComponent(folderId)}/permissions`, {
      query: { fields: "nextPageToken,permissions(emailAddress,role,type,deleted)", pageSize: 100, pageToken, supportsAllDrives: true },
    });
    for (const p of page.permissions) {
      if (p.type !== "user" || p.deleted || !p.emailAddress) continue;
      if (!["owner", "organizer", "fileOrganizer", "writer"].includes(p.role)) continue;
      people.push({ email: p.emailAddress.toLowerCase(), role: p.role === "owner" || p.role === "organizer" ? "Owner" : "Editor" });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return people.sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === "Owner" ? -1 : 1));
}

export function folderUrl(id: string) {
  return `https://drive.google.com/drive/folders/${id}`;
}

export function sheetUrl(id: string) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}
