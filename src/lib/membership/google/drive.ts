import { CLUB_DRIVE_FOLDER } from "../config";
import { MembershipError } from "../errors";
import { sizedThumbnail } from "../../home-photo-urls";
import { DRIVE, DRIVE_UPLOAD, google, googleBytes, GoogleApiError } from "./api";
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
  return google<DriveItem & { parents?: string[]; trashed?: boolean }>(`${DRIVE}/files/${encodeURIComponent(id)}`, {
    query: { fields: "id,name,mimeType,parents,trashed", supportsAllDrives: true },
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

export interface DriveImage {
  id: string;
  name: string;
  mimeType: string;
  // Changes whenever the file changes, so it can key cached copies.
  version: string;
  createdTime: string;
  // A signed link to Google's resized copy. It expires after a few hours.
  thumbnailLink?: string;
}

const IMAGE_FIELDS = "id,name,mimeType,version,createdTime,thumbnailLink";

// Image files directly inside a folder, newest first.
export async function listImages(folderId: string) {
  const images: DriveImage[] = [];
  let pageToken: string | undefined;
  do {
    const page = await google<{ files: DriveImage[]; nextPageToken?: string }>(`${DRIVE}/files`, {
      query: {
        q: `${quote(folderId)} in parents and mimeType contains 'image/' and trashed = false`, orderBy: "createdTime desc", pageSize: 1000, pageToken,
        fields: `nextPageToken,files(${IMAGE_FIELDS})`, supportsAllDrives: true, includeItemsFromAllDrives: true,
      },
    });
    images.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken && images.length < 5000);
  return images;
}

// Google's resized WebP copy of an image, `width` px wide. Google reads HEIC and applies the photo's rotation,
// so the download is a small fraction of a phone original (about 200 KB instead of 6 MB at 1080 px).
export async function imageThumbnail(id: string, width: number) {
  const { thumbnailLink } = await google<{ thumbnailLink?: string }>(`${DRIVE}/files/${encodeURIComponent(id)}`, {
    query: { fields: "thumbnailLink", supportsAllDrives: true },
  });
  if (!thumbnailLink) throw new GoogleApiError(404, "Drive has no preview of that file yet.");
  const image = await googleBytes(sizedThumbnail(thumbnailLink, width), { auth: false });
  if (!image.type.startsWith("image/")) throw new GoogleApiError(502, "Drive did not return an image.");
  return image;
}

// Uploads an image file into a folder, in one request with its name and its bytes (a Drive "multipart" upload).
export async function uploadImage(name: string, type: string, bytes: Uint8Array, parentId: string) {
  const boundary = `csc-${crypto.randomUUID()}`;
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`;
  const body = Buffer.concat([Buffer.from(head), bytes, Buffer.from(`\r\n--${boundary}--`)]);
  return google<DriveImage>(`${DRIVE_UPLOAD}/files`, {
    method: "POST",
    query: { uploadType: "multipart", fields: IMAGE_FIELDS, supportsAllDrives: true },
    upload: { bytes: body, type: `multipart/related; boundary=${boundary}` },
    timeoutMs: 60_000,
  });
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

export async function renameFile(id: string, name: string) {
  await google(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: "PATCH", query: { fields: "id", supportsAllDrives: true }, body: { name } });
}

// Drive keeps trashed files for 30 days, so a deleted event's sheet can still be restored from the trash.
export async function trashFile(id: string) {
  await google(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: "PATCH", query: { fields: "id", supportsAllDrives: true }, body: { trashed: true } });
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
