import { unstable_cache } from "next/cache";
import { photoUrl, sizedThumbnail, type HomePhoto } from "./home-photo-urls";
import { HERO_PHOTO_WIDTHS, optimizerUrl } from "./images";
import { googleBytes } from "./membership/google/api";
import { clubFolder, findFolder, listImages } from "./membership/google/drive";
import { keys } from "./membership/keys";
import { getJson, redis } from "./membership/redis";

// The Drive folder for home page photos, inside the club's "MIT CSC" folder.
export const PHOTO_FOLDER_PATH = ["Website", "Front Page Photos"];

export const HOME_PHOTOS_TAG = "home-photos";

export interface PhotoLibrary {
  folderId: string | null;
  photos: HomePhoto[];
  // Photos that are on but are no longer in the folder, for example deleted in Drive. The home page skips them.
  missing?: HomePhoto[];
  // Signed links to Drive's resized copies, by photo id, for the dashboard. They expire after a few hours.
  thumbnails?: Record<string, string>;
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

// Drive names a copied file "Copy of IMG_5946.jpeg". Show just the original file name.
export function photoName(fileName: string) {
  return fileName.replace(/^(copy of\s+)+/i, "").trim() || fileName;
}

// Runs `task` on every item, at most `limit` at a time.
async function forEachLimited<T>(items: T[], limit: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  }));
}

// Placeholders are this wide, so 16 of them add about 5 KB to the home page.
const PLACEHOLDER_WIDTH = 16;
const PLACEHOLDER_MAX_BYTES = 1024;

// Drive's tiny copy of a photo as a data URL, or undefined if Drive has none yet. The next refresh tries again.
async function fetchPlaceholder(thumbnailLink: string | undefined) {
  if (!thumbnailLink) return undefined;
  try {
    const image = await googleBytes(sizedThumbnail(thumbnailLink, PLACEHOLDER_WIDTH), { auth: false });
    if (!image.type.startsWith("image/") || image.bytes.length > PLACEHOLDER_MAX_BYTES) return undefined;
    return `data:${image.type};base64,${image.bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

// Lists the Drive folder again and saves the list.
export async function refreshPhotoLibrary(): Promise<PhotoLibrary> {
  const [folder, previous, shown] = await Promise.all([findPhotoFolder(), photoLibrary(), shownPhotoIds()]);
  const files = folder ? await listImages(folder.id) : [];
  const photos: HomePhoto[] = files.map((f) => ({ id: f.id, name: photoName(f.name), version: f.version, createdAt: Date.parse(f.createdTime) }));
  // A photo keeps its placeholder until the file changes in Drive.
  const before = new Map((previous?.photos || []).map((p) => [p.id, p]));
  const links = new Map(files.map((f) => [f.id, f.thumbnailLink]));
  await forEachLimited(photos, 8, async (photo) => {
    const old = before.get(photo.id);
    photo.placeholder = old?.version === photo.version && old.placeholder ? old.placeholder : await fetchPlaceholder(links.get(photo.id));
  });
  const present = new Set(photos.map((p) => p.id));
  const on = new Set(shown);
  const missing = new Map<string, HomePhoto>();
  for (const photo of [...(previous?.missing || []), ...(previous?.photos || [])]) {
    if (on.has(photo.id) && !present.has(photo.id)) missing.set(photo.id, photo);
  }
  const library: PhotoLibrary = {
    folderId: folder?.id || null,
    photos,
    missing: [...missing.values()],
    thumbnails: Object.fromEntries(files.filter((f) => f.thumbnailLink).map((f) => [f.id, f.thumbnailLink!])),
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

export interface PhotoFailure {
  // The file version that failed. A new version gets a fresh try.
  version: string;
  message: string;
  at: number;
}

export async function recordPhotoFailure(id: string, failure: PhotoFailure) {
  await redis("HSET", keys.homePhotoFailures, id, JSON.stringify(failure));
}

export async function clearPhotoFailure(id: string) {
  await redis("HDEL", keys.homePhotoFailures, id);
}

// Failures of the current version of each photo in the library, by id.
export async function photoFailures(photos: HomePhoto[]) {
  const flat = await redis<string[]>("HGETALL", keys.homePhotoFailures);
  const versions = new Map(photos.map((p) => [p.id, p.version]));
  const failures: Record<string, PhotoFailure> = {};
  for (let i = 0; i < flat.length; i += 2) {
    const failure = JSON.parse(flat[i + 1]) as PhotoFailure;
    if (versions.get(flat[i]) === failure.version) failures[flat[i]] = failure;
  }
  return failures;
}

export async function setPhotosShown(ids: string[], shown: boolean) {
  if (ids.length) await redis(shown ? "SADD" : "SREM", keys.homePhotosShown, ...ids);
}

// On Vercel, the home page loads photos through Vercel's image optimizer, whose cache outlives deploys.
// The cache of a route's own responses starts empty after every deploy, so each visit then waited on Drive.
// Every deploy names the production route as the source, so they all share one cached copy of each size.
const OPTIMIZER_SOURCE = process.env.VERCEL ? "https://csc.mit.edu" : null;
// The largest size /api/home-photos serves. The optimizer makes the smaller sizes from it.
const SOURCE_WIDTH = 1080;

// The URL of a home page photo at `width`.
export function homePhotoSrc(photo: HomePhoto, width: number) {
  return OPTIMIZER_SOURCE ? optimizerUrl(`${OPTIMIZER_SOURCE}${photoUrl(photo, SOURCE_WIDTH)}`, width) : photoUrl(photo, width);
}

// Asks the optimizer for every size of these photos, so the first visitor gets cached copies instead of waiting on Drive.
export async function warmHomePhotos(photos: HomePhoto[]) {
  if (!OPTIMIZER_SOURCE) return;
  const urls = photos.flatMap((photo) => HERO_PHOTO_WIDTHS.map((width) => `${OPTIMIZER_SOURCE}${homePhotoSrc(photo, width)}`));
  await forEachLimited(urls, 6, async (url) => {
    // Browsers ask for WebP, so the optimizer caches the WebP copy.
    await fetch(url, { headers: { Accept: "image/webp,*/*" } }).then((response) => response.arrayBuffer()).catch(() => undefined);
  });
}

// The photos turned on for the home page. Cached like the home page, and cleared when exec change the set.
export const homePagePhotos = unstable_cache(async () => {
  const [library, shown] = await Promise.all([photoLibrary(), shownPhotoIds()]);
  const on = new Set(shown);
  return (library?.photos || []).filter((photo) => on.has(photo.id));
}, ["home-page-photos"], { revalidate: 60, tags: [HOME_PHOTOS_TAG] });
