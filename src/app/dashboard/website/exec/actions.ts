"use server";

import { revalidateTag } from "next/cache";
import {
  addRole, EXEC_TAG, movePerson, refreshExecPhotoLibrary, removePerson, removeRole, renameRole, reorderRoles,
  reorderRoster, savePerson, uploadExecPhoto, type ExecPhotoLibrary, type PersonInput, type RosterList,
} from "@/lib/exec";
import { localMode } from "@/lib/local-mode";
import { MembershipError } from "@/lib/membership/errors";
import { requireExec } from "@/lib/membership/exec-auth";
import { attempt, type Result } from "@/lib/membership/result";

// Each change clears the cached roster, so /exec and /alumni update within seconds.

const LISTS: RosterList[] = ["current", "alumni"];
const list = (value: unknown) => {
  if (!LISTS.includes(value as RosterList)) throw new MembershipError("Pick active or alumni.");
  return value as RosterList;
};

async function change<T>(work: () => Promise<T>): Promise<Result<T>> {
  return attempt(async () => {
    await requireExec();
    const value = await work();
    revalidateTag(EXEC_TAG);
    return value;
  });
}

export async function savePersonAction(to: RosterList, id: string | null, input: PersonInput) {
  return change(() => savePerson(list(to), id, input));
}

export async function removePersonAction(id: string) {
  return change(async () => { await removePerson(id); return null; });
}

export async function movePersonAction(id: string, to: RosterList, index?: number) {
  return change(() => movePerson(id, list(to), index));
}

export async function reorderRosterAction(of: RosterList, ids: string[]) {
  return change(async () => { await reorderRoster(list(of), ids); return null; });
}

export async function addRoleAction(name: string) {
  return change(() => addRole(name));
}

export async function renameRoleAction(from: string, to: string) {
  return change(() => renameRole(from, to));
}

export async function removeRoleAction(name: string) {
  return change(async () => { await removeRole(name); return null; });
}

export async function reorderRolesAction(names: string[]) {
  return change(async () => { await reorderRoles(names); return null; });
}

// The browser shrinks a photo before sending it, so it stays well under the request size limit.
// The photo goes into the folder for the list of the person being edited.
export async function uploadExecPhotoAction(form: FormData) {
  return change(async () => {
    if (localMode()) throw new MembershipError("Local mode has no Google, so photos can’t be uploaded.", 503);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new MembershipError("Pick a photo.");
    if (file.size > 4 * 1024 * 1024) throw new MembershipError("This photo is too large. Pick one under 4 MB.");
    return uploadExecPhoto(file.name || "photo.jpg", file.type, new Uint8Array(await file.arrayBuffer()), list(form.get("list")));
  });
}

export async function refreshExecPhotosAction(): Promise<Result<ExecPhotoLibrary>> {
  return change(() => refreshExecPhotoLibrary());
}
