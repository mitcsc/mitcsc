"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { deleteEventAction, renameEvent } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import Dialog from "./Dialog";

const FAILED = { ok: false as const, error: "Something went wrong. Please try again." };

// One row's actions on the Events page: Check in up front, everything else behind the more button.
export default function EventActions({ id, name, count, sheet, today }: { id: string; name: string; count: number; sheet: string | null; today: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="d-row-actions">
      <Link className={`m-btn is-small${today ? "" : " is-outline"}`} href={`/dashboard/events/${id}`}>Check in</Link>
      <button type="button" className="d-more-btn" aria-label={`More for ${name}`} onClick={() => setOpen(true)}>
        <Icon name="more" size={18} />
      </button>
      {open && <EventDialog id={id} name={name} count={count} sheet={sheet} onClose={() => setOpen(false)} />}
    </span>
  );
}

function EventDialog({ id, name, count, sheet, onClose }: { id: string; name: string; count: number; sheet: string | null; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function rename(event: FormEvent, close: () => void) {
    event.preventDefault();
    const next = draft.trim();
    if (!next || next === name) return close();
    setBusy(true);
    setError("");
    const result = await renameEvent(id, next).catch(() => FAILED);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
    close();
  }

  async function remove(close: () => void) {
    const people = count === 1 ? "1 check-in" : `${count} check-ins`;
    if (!window.confirm(`Delete “${name}” and its ${people}?${sheet ? " Its Google Sheet moves to the Drive trash, where you can restore it for 30 days." : ""}`)) return;
    setBusy(true);
    setError("");
    const result = await deleteEventAction(id).catch(() => FAILED);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
    close();
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
          {sheet && <a className="m-btn is-outline is-medium" href={sheet} target="_blank" rel="noreferrer">Open Google Sheet</a>}
          {error && <p className="m-error" role="alert">{error}</p>}
          <button type="button" className="d-danger-link" disabled={busy} onClick={() => remove(() => close())}>Delete event</button>
        </>
      )}
    </Dialog>
  );
}
