import { randomUUID } from "node:crypto";
import { unstable_cache } from "next/cache";
import { alumni as alumniConfig, directory as alumniDirectory } from "../config/exec/alumni";
import { current as currentConfig, directory as currentDirectory } from "../config/exec/current";
import { fetchPlaceholder, findPhotoFolder, forEachLimited, listPhotoFolder, photoName } from "./drive-photos";
import { execPhotoUrl, type ExecPerson, type ExecPhoto, type ExecRoster, type PersonInput, type RosterList } from "./exec-roster";
import { MembershipError } from "./membership/errors";
import { listImages, uploadImage, type DriveImage } from "./membership/google/drive";
import { keys } from "./membership/keys";
import { getJson, redis, updateJson } from "./membership/redis";

export type { ExecPerson, ExecPhoto, ExecRoster, PersonInput, RosterList } from "./exec-roster";

// The Drive folder for exec photos, inside the club's "MIT CSC" folder.
export const EXEC_PHOTO_FOLDER_PATH = ["Website", "Exec Photos"];

// Public reads come from Next's data cache. Every change in the dashboard clears it through this tag.
export const EXEC_TAG = "exec";

export interface ExecPhotoLibrary {
  folderId: string | null;
  photos: (ExecPhoto & { createdAt: number })[];
  // Signed links to Drive's resized copies, by photo id, for the dashboard. They expire after a few hours.
  thumbnails?: Record<string, string>;
  checkedAt: number;
}

// Null until exec copy the people from the website code into the dashboard.
export async function execRoster() {
  return getJson<ExecRoster>(keys.execRoster);
}

const cachedRoster = unstable_cache(execRoster, ["exec-roster"], { tags: [EXEC_TAG], revalidate: 3600 });

// For /exec and /alumni. Null means the pages show the people from the website code.
export async function publicRoster() {
  return cachedRoster().catch(() => null);
}

export async function execPhotoLibrary() {
  return getJson<ExecPhotoLibrary>(keys.execPhotos);
}

// Whether anyone on /exec or /alumni uses this photo, which makes it public.
export async function isRosterPhoto(id: string) {
  const roster = await execRoster();
  return !!roster && [...roster.current, ...roster.alumni].some((p) => p.photo?.id === id);
}

async function changeRoster(change: (roster: ExecRoster) => ExecRoster) {
  const roster = await updateJson<ExecRoster>(keys.execRoster, change);
  if (!roster) throw new MembershipError("Copy the exec from the website first.", 409);
  return roster;
}

function field(value: unknown, label: string, max: number, required: boolean) {
  const clean = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (required && !clean) throw new MembershipError(`Enter the ${label}.`);
  if (clean.length > max) throw new MembershipError(`Keep the ${label} under ${max} characters.`);
  return clean;
}

function cleanPerson(input: PersonInput) {
  const classYear = field(input.classYear, "class year", 4, true);
  if (!/^\d{4}$/.test(classYear)) throw new MembershipError("Enter the class year as four digits, like 2028.");
  return {
    name: field(input.name, "name", 60, true),
    position: field(input.position, "position", 60, true),
    classYear,
    hometown: field(input.hometown, "hometown", 40, false),
  };
}

// A position must be one of the roles, or the one the person already has (an alumnus's old role, for example).
function checkRole(roster: ExecRoster, position: string, before: string | undefined) {
  if (position !== before && !roster.roles.includes(position)) throw new MembershipError(`“${position}” is not a role. Add it on the Roles tab first.`);
}

async function photoFor(photoId: string | null): Promise<ExecPhoto | null> {
  if (!photoId) return null;
  const photo = (await execPhotoLibrary())?.photos.find((p) => p.id === photoId);
  if (!photo) throw new MembershipError("That photo is no longer in the Exec Photos folder. Pick another one.", 404);
  const { id, version, name, placeholder } = photo;
  return { id, version, name, placeholder };
}

function where(roster: ExecRoster, id: string) {
  for (const list of ["current", "alumni"] as const) {
    const index = roster[list].findIndex((p) => p.id === id);
    if (index >= 0) return { list, index };
  }
  throw new MembershipError("This person is no longer on the list.", 404);
}

// Adds a person at the end of a list, or saves changes to one.
export async function savePerson(list: RosterList, id: string | null, input: PersonInput) {
  const fields = cleanPerson(input);
  const photo = await photoFor(input.photoId);
  let saved: ExecPerson | null = null;
  await changeRoster((roster) => {
    if (!id) {
      checkRole(roster, fields.position, undefined);
      saved = { id: randomUUID().slice(0, 8), ...fields, photo };
      return { ...roster, [list]: [...roster[list], saved] };
    }
    const at = where(roster, id);
    checkRole(roster, fields.position, roster[at.list][at.index].position);
    return { ...roster, [at.list]: roster[at.list].map((p) => (p.id === id ? (saved = { ...p, ...fields, photo }) : p)) };
  });
  return saved!;
}

export async function removePerson(id: string) {
  await changeRoster((roster) => {
    const at = where(roster, id);
    return { ...roster, [at.list]: roster[at.list].filter((p) => p.id !== id) };
  });
}

// Moves a person to the other list: to the top of the alumni (newest first), or to the end of the current exec.
// `index` puts them at an exact place instead, which is how Undo returns someone to where they were.
// Returns where they were, for Undo.
export async function movePerson(id: string, to: RosterList, index?: number) {
  let from: { list: RosterList; index: number } | null = null;
  await changeRoster((roster) => {
    const at = (from = where(roster, id));
    if (at.list === to) return roster;
    const person = roster[at.list][at.index];
    const target = roster[to].filter((p) => p.id !== id);
    const place = index === undefined ? (to === "alumni" ? 0 : target.length) : Math.max(0, Math.min(index, target.length));
    target.splice(place, 0, person);
    return { ...roster, [at.list]: roster[at.list].filter((p) => p.id !== id), [to]: target };
  });
  return from!;
}

// Puts a list in the order of ids, as dragged in the dashboard.
// A person missing from ids, for example one added meanwhile in another tab, keeps a place at the end.
export async function reorderRoster(list: RosterList, ids: string[]) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new MembershipError("Invalid order.");
  await changeRoster((roster) => {
    const place = new Map(ids.map((id, i) => [id, i]));
    return { ...roster, [list]: [...roster[list]].sort((a, b) => (place.get(a.id) ?? ids.length) - (place.get(b.id) ?? ids.length)) };
  });
}

function roleName(value: unknown) {
  return field(value, "role", 60, true);
}

export async function addRole(name: string) {
  const role = roleName(name);
  await changeRoster((roster) => {
    if (roster.roles.includes(role)) throw new MembershipError(`“${role}” is already a role.`, 409);
    return { ...roster, roles: [...roster.roles, role] };
  });
  return role;
}

// Renames a role, and the position of every current exec who has it. Alumni keep the name they held it under.
export async function renameRole(from: string, to: string) {
  const role = roleName(to);
  await changeRoster((roster) => {
    if (!roster.roles.includes(from)) throw new MembershipError(`“${from}” is no longer a role.`, 404);
    if (role !== from && roster.roles.includes(role)) throw new MembershipError(`“${role}” is already a role.`, 409);
    return {
      ...roster,
      roles: roster.roles.map((r) => (r === from ? role : r)),
      current: roster.current.map((p) => (p.position === from ? { ...p, position: role } : p)),
    };
  });
  return role;
}

// A role that a current exec still has cannot be removed. Alumni keep it as their old position.
export async function removeRole(name: string) {
  await changeRoster((roster) => {
    const holders = roster.current.filter((p) => p.position === name);
    if (holders.length) throw new MembershipError(`${holders.map((p) => p.name).join(", ")} ${holders.length === 1 ? "has" : "have"} this role. Change their position first.`, 409);
    return { ...roster, roles: roster.roles.filter((r) => r !== name) };
  });
}

export async function reorderRoles(names: string[]) {
  if (!Array.isArray(names) || names.some((n) => typeof n !== "string")) throw new MembershipError("Invalid order.");
  await changeRoster((roster) => {
    const place = new Map(names.map((n, i) => [n, i]));
    return { ...roster, roles: [...roster.roles].sort((a, b) => (place.get(a) ?? names.length) - (place.get(b) ?? names.length)) };
  });
}

// Lists the Drive folder again and saves the list. People whose photo changed in Drive get the new version.
export async function refreshExecPhotoLibrary(): Promise<ExecPhotoLibrary> {
  const previous = await execPhotoLibrary();
  const { folder, files } = await listPhotoFolder(EXEC_PHOTO_FOLDER_PATH, previous?.folderId);
  return saveLibrary(folder?.id || null, files, previous);
}

async function saveLibrary(folderId: string | null, files: DriveImage[], previous: ExecPhotoLibrary | null) {
  const before = new Map((previous?.photos || []).map((p) => [p.id, p]));
  const photos: ExecPhotoLibrary["photos"] = files.map((f) => ({ id: f.id, version: f.version, name: photoName(f.name), createdAt: Date.parse(f.createdTime) }));
  await forEachLimited(photos, 8, async (photo) => {
    const old = before.get(photo.id);
    const link = files.find((f) => f.id === photo.id)?.thumbnailLink;
    photo.placeholder = old?.version === photo.version && old.placeholder ? old.placeholder : await fetchPlaceholder(link);
  });
  const library: ExecPhotoLibrary = {
    folderId,
    photos,
    thumbnails: Object.fromEntries(files.filter((f) => f.thumbnailLink).map((f) => [f.id, f.thumbnailLink!])),
    checkedAt: Date.now(),
  };
  await redis("SET", keys.execPhotos, JSON.stringify(library));
  const latest = new Map(photos.map((p) => [p.id, p]));
  const stale = (p: ExecPerson) => {
    const now = p.photo && latest.get(p.photo.id);
    return !!now && (now.version !== p.photo!.version || now.name !== p.photo!.name || (!!now.placeholder && !p.photo!.placeholder));
  };
  const roster = await execRoster();
  if (roster && [...roster.current, ...roster.alumni].some(stale)) {
    const update = (p: ExecPerson): ExecPerson => {
      if (!stale(p)) return p;
      const { id, version, name, placeholder } = latest.get(p.photo!.id)!;
      return { ...p, photo: { id, version, name, placeholder } };
    };
    await changeRoster((r) => ({ ...r, current: r.current.map(update), alumni: r.alumni.map(update) }));
  }
  return library;
}

// Saves an image into the Exec Photos folder, making the folder if needed, and returns it.
export async function uploadExecPhoto(name: string, type: string, bytes: Uint8Array) {
  if (!type.startsWith("image/")) throw new MembershipError("Pick an image file.");
  const folder = await findPhotoFolder(EXEC_PHOTO_FOLDER_PATH, true);
  if (!folder) throw new MembershipError("Could not make the Exec Photos folder in Drive.", 502);
  const file = await uploadImage(name, type, bytes, folder.id);
  const library = await saveLibrary(folder.id, await listImages(folder.id), await execPhotoLibrary());
  return library.photos.find((p) => p.id === file.id) || { id: file.id, version: file.version, name: photoName(file.name), createdAt: Date.now() };
}

const CONFIG_LISTS = [
  { list: "current" as const, people: currentConfig, directory: currentDirectory },
  { list: "alumni" as const, people: alumniConfig, directory: alumniDirectory },
];

// One time: copies the people in src/config/exec into the dashboard, in the same order.
// With photos, each photo file from the website goes into the Exec Photos folder. A file already there by that name is
// reused, so a copy that stopped partway can run again. Without photos (local mode has no Google), people get none.
export async function copyRosterFromWebsite(origin: string, withPhotos: boolean) {
  if (await execRoster()) throw new MembershipError("The exec are already in the dashboard.", 409);
  const fileIds = new Map<string, string>();
  if (withPhotos) {
    const folder = await findPhotoFolder(EXEC_PHOTO_FOLDER_PATH, true);
    if (!folder) throw new MembershipError("Could not make the Exec Photos folder in Drive.", 502);
    const existing = new Map((await listImages(folder.id)).map((f) => [f.name, f.id]));
    const files = CONFIG_LISTS.flatMap(({ people, directory }) => people.map((p) => ({ file: p.image, path: `/${directory}/${p.image}` })));
    await forEachLimited(files, 6, async ({ file, path }) => {
      if (existing.has(file)) return void fileIds.set(path, existing.get(file)!);
      const response = await fetch(`${origin}${path}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (!response?.ok) throw new MembershipError(`Could not read ${file} from the website.`, 502);
      const type = response.headers.get("content-type") || "image/jpeg";
      const uploaded = await uploadImage(file, type, new Uint8Array(await response.arrayBuffer()), folder.id);
      fileIds.set(path, uploaded.id);
    });
    await saveLibrary(folder.id, await listImages(folder.id), await execPhotoLibrary());
  }
  const library = new Map(((await execPhotoLibrary())?.photos || []).map((p) => [p.id, p]));
  const roster = Object.fromEntries(CONFIG_LISTS.map(({ list, people, directory }) => [list, people.map((p): ExecPerson => {
    const photo = library.get(fileIds.get(`/${directory}/${p.image}`) || "");
    return {
      id: randomUUID().slice(0, 8), name: p.name, position: p.position, classYear: p.classYear, hometown: p.hometown,
      photo: photo ? { id: photo.id, version: photo.version, name: photo.name, placeholder: photo.placeholder } : null,
    };
  })])) as Pick<ExecRoster, "current" | "alumni">;
  // The roles start as every position on the website, current exec first, in their order there.
  const roles = [...new Set([...roster.current, ...roster.alumni].map((p) => p.position))];
  const full: ExecRoster = { ...roster, roles };
  if ((await redis<string | null>("SET", keys.execRoster, JSON.stringify(full), "NX")) !== "OK") {
    throw new MembershipError("The exec are already in the dashboard.", 409);
  }
  return { current: full.current.length, alumni: full.alumni.length };
}

// On Vercel, the pages load photos through Vercel's image optimizer from production's route, so every deploy
// shares one cached copy of each size (as homePhotoSrc does for the home page).
const OPTIMIZER_SOURCE = process.env.VERCEL ? "https://csc.mit.edu" : "";
// The largest size the route serves. The optimizer makes the smaller sizes from it.
const SOURCE_WIDTH = 1080;

// The cards for /exec or /alumni, in order. Until exec copy the people into the dashboard, they come from src/config/exec.
export async function publicCards(list: RosterList) {
  const roster = await publicRoster();
  const alumni = list === "alumni";
  if (!roster) {
    const { people, directory } = CONFIG_LISTS.find((c) => c.list === list)!;
    return people.map((p) => ({ id: p.image, name: p.name, position: p.position, classYear: p.classYear, hometown: p.hometown, src: `/${directory}/${p.image}`, alumni }));
  }
  return roster[list].map((p) => ({
    id: p.id, name: p.name, position: p.position, classYear: p.classYear, hometown: p.hometown, alumni,
    src: p.photo ? `${OPTIMIZER_SOURCE}${execPhotoUrl(p.photo, SOURCE_WIDTH)}` : null,
    placeholder: p.photo?.placeholder,
  }));
}
