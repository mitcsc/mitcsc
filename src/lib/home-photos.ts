import { unstable_cache } from "next/cache";
import type { HomePhoto } from "./home-photo-urls";
import { clubFolder, findFolder, listImages } from "./membership/google/drive";
import { keys } from "./membership/keys";
import { getJson, redis } from "./membership/redis";

// The Drive folder for home page photos, inside the club's "MIT CSC" folder.
export const PHOTO_FOLDER_PATH = ["Website", "Front Page Photos"];

export const HOME_PHOTOS_TAG = "home-photos";

export interface PhotoLibrary {
  folderId: string | null;
  photos: HomePhoto[];
  checkedAt: number;
}

async function findPhotoFolder() {
  let folder = await clubFolder();
  for (const name of PHOTO_FOLDER_PATH) {
    const child = await findFolder(name, folder.id);
    if (!child) return null;
    folder = child;
  }
  return folder;
}

// Lists the Drive folder again and saves the list.
export async function refreshPhotoLibrary(): Promise<PhotoLibrary> {
  const folder = await findPhotoFolder();
  const files = folder ? await listImages(folder.id) : [];
  const library: PhotoLibrary = {
    folderId: folder?.id || null,
    photos: files.map((f) => ({ id: f.id, name: f.name, version: f.version, createdAt: Date.parse(f.createdTime) })),
    checkedAt: Date.now(),
  };
  await redis("SET", keys.homePhotos, JSON.stringify(library));
  return library;
}

// The list from the last refresh. Reads only Redis.
export async function photoLibrary() {
  return getJson<PhotoLibrary>(keys.homePhotos);
}

// Ids stay in this set when a file leaves Drive, so a photo moved out and back keeps its setting.
export async function shownPhotoIds() {
  return redis<string[]>("SMEMBERS", keys.homePhotosShown);
}

export async function isPhotoShown(id: string) {
  return (await redis<number>("SISMEMBER", keys.homePhotosShown, id)) === 1;
}

export async function setPhotosShown(ids: string[], shown: boolean) {
  if (ids.length) await redis(shown ? "SADD" : "SREM", keys.homePhotosShown, ...ids);
}

// The photos turned on for the home page. Cached like the home page, and cleared when exec change the set.
export const homePagePhotos = unstable_cache(async () => {
  const [library, shown] = await Promise.all([photoLibrary(), shownPhotoIds()]);
  const on = new Set(shown);
  return (library?.photos || []).filter((photo) => on.has(photo.id));
}, ["home-page-photos"], { revalidate: 60, tags: [HOME_PHOTOS_TAG] });
