"use server";

import { revalidateTag } from "next/cache";
import { requireExec } from "@/lib/membership/exec-auth";
import { attempt, type Result } from "@/lib/membership/result";
import { deleteLink, LINKS_TAG, reorderLinks, saveLink, type LinkInput, type ShortLink } from "@/lib/links";

// Each change clears the cached public links, so the Links page and redirects update at once.

export async function saveLinkAction(id: string | null, input: LinkInput): Promise<Result<ShortLink>> {
  return attempt(async () => {
    await requireExec();
    const link = await saveLink(id, input);
    revalidateTag(LINKS_TAG);
    return link;
  });
}

export async function deleteLinkAction(id: string): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    await deleteLink(id);
    revalidateTag(LINKS_TAG);
    return null;
  });
}

export async function reorderLinksAction(ids: string[]): Promise<Result<null>> {
  return attempt(async () => {
    await requireExec();
    await reorderLinks(ids);
    revalidateTag(LINKS_TAG);
    return null;
  });
}
