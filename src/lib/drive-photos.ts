import { sizedThumbnail } from "./home-photo-urls";
import { googleBytes } from "./membership/google/api";
import { clubFolder, createFolder, findFolder, getItem, listImages } from "./membership/google/drive";

// Helpers for a photo folder in Drive, inside the club's "MIT CSC" folder: the home page photos and the exec photos.

// The folder at `path` below "MIT CSC", or null. With `create`, missing folders on the way are made.
export async function findPhotoFolder(path: string[], create = false) {
  let folder = await clubFolder();
  for (const name of path) {
    const child = (await findFolder(name, folder.id)) || (create ? await createFolder(name, folder.id) : null);
    if (!child) return null;
    folder = child;
  }
  return folder;
}

// The folder and its photos. The saved folder id skips the lookups from "MIT CSC" down, which run one after another,
// and the folder is checked in the same round trip as the listing. A renamed, moved to trash, or deleted folder is looked up again.
export async function listPhotoFolder(path: string[], savedId: string | null | undefined) {
  if (savedId) {
    const [item, files] = await Promise.all([getItem(savedId).catch(() => null), listImages(savedId).catch(() => null)]);
    if (item && files && !item.trashed && item.name === path.at(-1)) return { folder: item, files };
  }
  const folder = await findPhotoFolder(path);
  return { folder, files: folder ? await listImages(folder.id) : [] };
}

// Drive names a copied file "Copy of IMG_5946.jpeg". Show just the original file name.
export function photoName(fileName: string) {
  return fileName.replace(/^(copy of\s+)+/i, "").trim() || fileName;
}

// Runs `task` on every item, at most `limit` at a time.
export async function forEachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  }));
}

// Placeholders are this wide, so 16 of them add about 5 KB to a page.
const PLACEHOLDER_WIDTH = 16;
const PLACEHOLDER_MAX_BYTES = 1024;

// Drive's tiny copy of a photo as a data URL, or undefined if Drive has none yet. The next refresh tries again.
export async function fetchPlaceholder(thumbnailLink: string | undefined) {
  if (!thumbnailLink) return undefined;
  try {
    const image = await googleBytes(sizedThumbnail(thumbnailLink, PLACEHOLDER_WIDTH), { auth: false });
    if (!image.type.startsWith("image/") || image.bytes.length > PLACEHOLDER_MAX_BYTES) return undefined;
    return `data:${image.type};base64,${image.bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}
