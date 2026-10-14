"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Dialog from "@/components/dashboard/Dialog";
import { Icon } from "@/components/membership/icons";

// One row's actions on the History page, for the host of an ended delib: Results up front, the rest behind the more button.
export default function DelibActions({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="d-row-actions">
      <Link className="m-btn is-small is-outline" href={`/dashboard/delibs/history/${id}`}>Results</Link>
      <button type="button" className="d-more-btn" aria-label={`More for ${name}`} onClick={() => setOpen(true)}>
        <Icon name="more" size={18} />
      </button>
      {open && <DelibDialog id={id} name={name} onClose={() => setOpen(false)} />}
    </span>
  );
}

function DelibDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove(close: () => void) {
    if (!window.confirm(`Delete “${name}” and all of its votes? You cannot undo this.`)) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/voting/delibs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", sessionId: id }) }).catch(() => null);
    const result = await response?.json().catch(() => ({})) as { error?: string } | undefined;
    setBusy(false);
    if (!response?.ok) return setError(result?.error || "Something went wrong. Please try again.");
    router.refresh();
    close();
  }

  return (
    <Dialog title={name} onClose={onClose}>
      {(close) => (
        <>
          <div className="d-dialog-actions">
            <a className="m-btn is-outline is-medium" href={`/api/voting/delibs/export?id=${encodeURIComponent(id)}`} download>Download CSV</a>
          </div>
          {error && <p className="m-error" role="alert">{error}</p>}
          <button type="button" className="d-danger-link" disabled={busy} onClick={() => remove(() => close())}>{busy ? "Deleting…" : "Delete delib"}</button>
        </>
      )}
    </Dialog>
  );
}
