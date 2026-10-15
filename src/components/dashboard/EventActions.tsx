"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { deleteEventAction, saveEvent } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import Dialog from "./Dialog";
import { EventHoursFields } from "./NewEventForm";

const FAILED = { ok: false as const, error: "Something went wrong. Please try again." };

// One row's actions on the Events page: Check in up front, everything else behind the more button.
type Hours = { starts: string | null; ends: string | null };

export default function EventActions({ id, name, hours, count, sheet, today }: { id: string; name: string; hours: Hours; count: number; sheet: string | null; today: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="d-row-actions">
      <Link className={`m-btn is-small${today ? "" : " is-outline"}`} href={`/dashboard/check-in/events/${id}`}>Check in</Link>
      <button type="button" className="d-more-btn" aria-label={`More for ${name}`} onClick={() => setOpen(true)}>
        <Icon name="more" size={18} />
      </button>
      {open && <EventDialog id={id} name={name} hours={hours} count={count} sheet={sheet} onClose={() => setOpen(false)} />}
    </span>
  );
}

function EventDialog({ id, name, hours, count, sheet, onClose }: { id: string; name: string; hours: Hours; count: number; sheet: string | null; onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState(name);
  const [starts, setStarts] = useState(hours.starts || "");
  const [ends, setEnds] = useState(hours.ends || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent, close: () => void) {
    event.preventDefault();
    const next = draft.trim();
    if (!next) return;
    if (next === name && starts === (hours.starts || "") && ends === (hours.ends || "")) return close();
    setBusy(true);
    setError("");
    const result = await saveEvent(id, { name: next, starts, ends }).catch(() => FAILED);
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
          <form className="d-dialog-actions" onSubmit={(e) => save(e, () => close())}>
            <label className="d-field">
              <span className="m-label">Name</span>
              <input className="m-input is-compact" value={draft} required maxLength={100} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <EventHoursFields starts={starts} ends={ends} onStarts={setStarts} onEnds={setEnds} compact />
            <button type="submit" className="m-btn is-light is-medium" disabled={busy || !draft.trim()}>Save</button>
          </form>
          {sheet && <a className="m-btn is-outline is-medium" href={sheet} target="_blank" rel="noreferrer">Open Google Sheet</a>}
          {error && <p className="m-error" role="alert">{error}</p>}
          <button type="button" className="d-danger-link" disabled={busy} onClick={() => remove(() => close())}>Delete event</button>
        </>
      )}
    </Dialog>
  );
}
