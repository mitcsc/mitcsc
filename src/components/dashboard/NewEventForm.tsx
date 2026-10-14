"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createEventAction } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import DrivePicker, { type DriveChoice } from "./DrivePicker";

type Target = { kind: "default" } | { kind: "folder"; choice: DriveChoice } | { kind: "sheet"; choice: DriveChoice };

// eventsFolder is null when the club Google account is not connected; then attendance stays on this site only.
export default function NewEventForm({ today, eventsFolder }: { today: string; eventsFolder: DriveChoice | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [target, setTarget] = useState<Target>({ kind: "default" });
  const [picking, setPicking] = useState<"folder" | "sheet" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await createEventAction({
      name, date,
      folderId: target.kind === "folder" ? target.choice.id : target.kind === "default" ? eventsFolder?.id ?? null : null,
      sheetId: target.kind === "sheet" ? target.choice.id : null,
    }).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    router.push(`/dashboard/events/${result.value}`);
  }

  const path = target.kind === "default" ? eventsFolder?.path || [] : target.choice.path;
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
          <input className="m-input" type="date" value={date} required onChange={(e) => setDate(e.target.value)} />
        </label>
        {eventsFolder ? (
          <div className="m-field">
            <span className="m-label">Save attendance in</span>
            <div className="d-location is-large">
              <span className="d-location-path">
                {path.map((s, i) => <span key={i}>{i > 0 && <span className="d-crumb-sep" aria-hidden="true">/</span>}{s}</span>)}
              </span>
              <button type="button" className="d-chip-btn" onClick={() => setPicking("folder")}>Change</button>
            </div>
            <span className="d-field-note is-large">
              {target.kind === "sheet" ? `Adds a tab named “${name.trim() || "the event name"}” to this sheet.` : `Creates a new sheet named “${name.trim() || "the event name"}”.`}
            </span>
            {target.kind === "sheet"
              ? <button type="button" className="d-text-btn" onClick={() => setTarget({ kind: "default" })}>Make a new sheet instead</button>
              : <button type="button" className="d-text-btn" onClick={() => setPicking("sheet")}>Add to an existing sheet instead</button>}
          </div>
        ) : (
          <p className="d-field-note is-large">Attendance is saved here only. Connect the club Google account in Settings to also save it to a Google Sheet.</p>
        )}
        {error && <p className="m-error" role="alert">{error}</p>}
        <button type="submit" className="m-btn is-block d-phone-submit" disabled={busy}>{busy ? "Creating…" : "Start check-in"}</button>
      </form>
      {picking && (
        <DrivePicker
          title={picking === "sheet" ? "Pick a sheet" : "Save attendance in"}
          start={target.kind === "default" ? eventsFolder?.id : target.choice.id}
          pick={picking}
          onClose={() => setPicking(null)}
          onPick={(choice) => { setTarget({ kind: picking, choice }); setPicking(null); }}
        />
      )}
    </main>
  );
}
