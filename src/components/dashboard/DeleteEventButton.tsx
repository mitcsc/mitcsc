"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteEventAction } from "@/app/dashboard/actions";

export default function DeleteEventButton({ id, name, count, hasSheet }: { id: string; name: string; count: number; hasSheet: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    const people = count === 1 ? "1 check-in" : `${count} check-ins`;
    if (!window.confirm(`Delete “${name}” and its ${people}?${hasSheet ? " The Google Sheet stays in Drive." : ""}`)) return;
    setBusy(true);
    const result = await deleteEventAction(id).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    if (!result.ok) {
      setBusy(false);
      window.alert(result.error);
    }
    router.refresh();
  }

  return (
    <button type="button" className="d-text-btn" onClick={remove} disabled={busy}>
      {busy ? "Deleting…" : "Delete"}
    </button>
  );
}
