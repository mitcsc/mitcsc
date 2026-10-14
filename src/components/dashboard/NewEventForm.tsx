"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createEventAction } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import DrivePicker, { type DriveChoice } from "./DrivePicker";

// clubFolder is the "MIT CSC" folder, or null when the club Google account is not connected; then attendance stays on this site only.
// taken maps each date that already has an event to that event.
export default function NewEventForm({ today, taken, clubFolder }: {
  today: string; taken: Record<string, { id: string; name: string }>; clubFolder: DriveChoice | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [folder, setFolder] = useState(clubFolder);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const clash = taken[date];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await createEventAction({ name, date, folderId: folder?.id ?? null }).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    router.push(`/dashboard/events/${result.value}`);
  }

  return (
    <main className="d-phone">
      <form className="d-phone-body" onSubmit={submit}>
        <Link className="m-back" href="/dashboard/events"><Icon name="back" />Events</Link>
        <h1 className="d-phone-title">New event</h1>
        <label className="m-field">
          <span className="m-label">Name</span>
          <input className="m-input" value={name} required maxLength={100} placeholder="Event name" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="m-field">
          <span className="m-label">Date</span>
          <input className="m-input" type="date" value={date} required aria-invalid={!!clash || undefined} aria-describedby={clash ? "date-taken" : undefined} onChange={(e) => setDate(e.target.value)} />
          {clash && (
            <span id="date-taken" className="m-error" role="alert">
              “{clash.name}” is already on this day, and each day has one event. Pick another date, or <Link href={`/dashboard/events/${clash.id}`}>open “{clash.name}”</Link>.
            </span>
          )}
        </label>
        {folder ? (
          <div className="m-field">
            <span className="m-label">Save attendance in</span>
            <div className="d-location is-large">
              <span className="d-location-path">
                {folder.path.map((s, i) => <span key={i}>{i > 0 && <span className="d-crumb-sep" aria-hidden="true">/</span>}{s}</span>)}
              </span>
              <button type="button" className="d-chip-btn" onClick={() => setPicking(true)}>Change</button>
            </div>
            <span className="d-field-note is-large">Creates a new sheet named “{name.trim() || "the event name"}”.</span>
          </div>
        ) : (
          <p className="d-field-note is-large">Attendance is saved here only. Connect the club Google account in Settings to also save it to a Google Sheet.</p>
        )}
        {error && <p className="m-error" role="alert">{error}</p>}
        <button type="submit" className="m-btn is-block d-phone-submit" disabled={busy || !!clash}>{busy ? "Creating…" : "Start check-in"}</button>
      </form>
      {picking && folder && (
        <DrivePicker
          title="Save attendance in"
          start={folder.id}
          pick="folder"
          onClose={() => setPicking(false)}
          onPick={(choice) => { setFolder(choice); setPicking(false); }}
        />
      )}
    </main>
  );
}
