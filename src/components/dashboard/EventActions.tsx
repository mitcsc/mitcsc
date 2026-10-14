"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteEventAction, renameEvent } from "@/app/dashboard/actions";
import type { Result } from "@/lib/membership/result";

const FAILED = { ok: false as const, error: "Something went wrong. Please try again." };

// Rename and Delete for one row on the Events page.
export default function EventActions({ id, name, count, hasSheet }: { id: string; name: string; count: number; hasSheet: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"rename" | "delete" | null>(null);

  async function run(kind: "rename" | "delete", action: () => Promise<Result<null>>) {
    setBusy(kind);
    const result = await action().catch(() => FAILED);
    setBusy(null);
    if (!result.ok) window.alert(result.error);
    router.refresh();
  }

  function rename() {
    const next = window.prompt("Rename the event", name)?.trim();
    if (next && next !== name) run("rename", () => renameEvent(id, next));
  }

  function remove() {
    const people = count === 1 ? "1 check-in" : `${count} check-ins`;
    if (window.confirm(`Delete “${name}” and its ${people}?${hasSheet ? " The Google Sheet stays in Drive." : ""}`)) run("delete", () => deleteEventAction(id));
  }

  return (
    <>
      <button type="button" className="d-text-btn" onClick={rename} disabled={busy !== null}>{busy === "rename" ? "Renaming…" : "Rename"}</button>
      <button type="button" className="d-text-btn" onClick={remove} disabled={busy !== null}>{busy === "delete" ? "Deleting…" : "Delete"}</button>
    </>
  );
}
