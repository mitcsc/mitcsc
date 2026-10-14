"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Dialog from "@/components/dashboard/Dialog";
import { Icon } from "@/components/membership/icons";

// One row's actions on the History page, for the host of an ended delib: Results up front, everything else behind the more button.
// The dialog follows the Events page's.
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

async function post(data: object) {
  const response = await fetch("/api/voting/delibs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).catch(() => null);
  const result = await response?.json().catch(() => ({})) as { error?: string } | undefined;
  return response?.ok ? null : result?.error || "Something went wrong. Please try again.";
}

function DelibDialog({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<string | null>, close: () => void) {
    setBusy(true);
    setError("");
    const problem = await action();
    setBusy(false);
    if (problem) return setError(problem);
    router.refresh();
    close();
  }

  function rename(event: FormEvent, close: () => void) {
    event.preventDefault();
    const next = draft.trim();
    if (!next || next === name) return close();
    void run(() => post({ action: "rename", sessionId: id, name: next }), close);
  }

  function remove(close: () => void) {
    if (!window.confirm(`Delete “${name}” and all of its votes? You cannot undo this.`)) return;
    void run(() => post({ action: "delete", sessionId: id }), close);
  }

  return (
    <Dialog title={name} onClose={onClose}>
      {(close) => (
        <>
          <form className="d-dialog-actions" onSubmit={(e) => rename(e, () => close())}>
            <label className="d-field">
              <span className="m-label">Name</span>
              <input className="m-input is-compact" value={draft} required maxLength={100} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <button type="submit" className="m-btn is-light is-medium" disabled={busy || !draft.trim()}>Save name</button>
          </form>
          <a className="m-btn is-outline is-medium" href={`/api/voting/delibs/export?id=${encodeURIComponent(id)}`} download>Download CSV</a>
          {error && <p className="m-error" role="alert">{error}</p>}
          <button type="button" className="d-danger-link" disabled={busy} onClick={() => remove(() => close())}>Delete delib</button>
        </>
      )}
    </Dialog>
  );
}
