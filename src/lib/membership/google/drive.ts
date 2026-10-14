import { CLUB_DRIVE_FOLDER } from "../config";
import { MembershipError } from "../errors";
import { DRIVE, google } from "./api";
import { clubEmail } from "./oauth";

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

export async function findFolder(name: string, parentId = "root") {
  const [match] = await listAll(`${quote(parentId)} in parents and mimeType = '${FOLDER}' and name = ${quote(name)} and trashed = false`);
  return match || null;
}

export async function getItem(id: string) {
  return google<DriveItem & { parents?: string[] }>(`${DRIVE}/files/${encodeURIComponent(id)}`, {
    query: { fields: "id,name,mimeType,parents", supportsAllDrives: true },
  });
}

// The "MIT CSC" folder in the club account's My Drive. The dashboard only reads and writes inside it,
// and its editors are the exec who can use the dashboard.
export async function clubFolder() {
  const folder = await findFolder(CLUB_DRIVE_FOLDER);
  if (!folder) throw new MembershipError(`Make a folder named “${CLUB_DRIVE_FOLDER}” in ${clubEmail()}’s Google Drive first.`, 409);
  return folder;
}

// Folders from the club folder down to the item, for example ["MIT CSC", "MIT CSC 2026-2027"].
// Throws for anything outside the club folder.
export async function clubPath(id: string, root?: DriveItem) {
  const top = root || await clubFolder();
  const path: { id: string; name: string }[] = [];
  let current: string | undefined = id;
  while (current && path.length < 12) {
    if (current === top.id) return [{ id: top.id, name: top.name }, ...path];
    const item: (DriveItem & { parents?: string[] }) | null = await getItem(current).catch(() => null);
    if (!item?.parents?.length) break;
    path.unshift({ id: item.id, name: item.name });
    current = item.parents[0];
  }
  throw new MembershipError(`Pick something inside the “${CLUB_DRIVE_FOLDER}” folder.`, 403);
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
