"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createEventAction } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import { schoolYearOn } from "@/lib/membership/config";
import { checkInState, clashes, clashNote, type TakenEvent } from "@/lib/membership/event-times";
import DrivePicker, { type DriveChoice } from "./DrivePicker";
import PathText from "./PathText";

// The event's start and end times, which open and close check-in. Shared with the Events dialog.
export function EventHoursFields({ starts, ends, onStarts, onEnds, invalid = false, compact = false }: {
  starts: string; ends: string; onStarts: (v: string) => void; onEnds: (v: string) => void; invalid?: boolean; compact?: boolean;
}) {
  const input = `m-input${compact ? " is-compact" : ""}`;
  return (
    <div className="m-field">
      <span className="m-label">Event hours<span className="m-label-note">Optional</span></span>
      <div className="d-hours">
        <input className={input} type="time" aria-label="Event starts" value={starts} aria-invalid={invalid || undefined} onChange={(e) => onStarts(e.target.value)} />
        <span aria-hidden="true">to</span>
        <input className={input} type="time" aria-label="Event ends" value={ends} aria-invalid={invalid || undefined} onChange={(e) => onEnds(e.target.value)} />
      </div>
      <span className="d-field-note">Check-in opens and closes on its own at these times. Without them, it opens on the event’s day and stays open until someone closes it.</span>
    </div>
  );
}

// The New event page, and the Check in tab on a day with no event ("today"), where it explains why it shows.
// clubFolder is the "MIT CSC" folder, or null when the club Google account is not connected; then attendance stays on this site only.
// taken lists every event, so the form can warn about hours that overlap one.
export default function NewEventForm({ today, taken, clubFolder, variant = "page" }: {
  today: string; taken: TakenEvent[]; clubFolder: DriveChoice | null; variant?: "page" | "today";
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [folder, setFolder] = useState(clubFolder);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, startOpening] = useTransition();
  // Half-entered hours are not checked yet. Saving asks for both.
  const clash = !starts === !ends ? taken.find((t) => clashes(t, { date, starts, ends })) : undefined;
  // An event whose hours have not started yet is only created now; its check-in opens on its own later.
  const opensNow = checkInState({ date, starts, ends }, new Date()).open;
  const starting = busy || opening;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await createEventAction({ name, date, starts, ends, folderId: folder?.id ?? null }).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    // On the Check in tab, today's new event opens in place.
    if (variant === "today" && date === today) startOpening(() => router.refresh());
    else router.push(`/dashboard/events/${result.value}`);
    setBusy(false);
  }

  const fields = (
    <>
      <label className="m-field">
        <span className="m-label">Name</span>
        <input className="m-input" value={name} required maxLength={100} placeholder="Event name" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="m-field">
        <span className="m-label">Date</span>
        <input className="m-input" type="date" value={date} required aria-invalid={!!clash || undefined} aria-describedby={clash ? "date-taken" : undefined} onChange={(e) => setDate(e.target.value)} />
      </label>
      <EventHoursFields starts={starts} ends={ends} onStarts={setStarts} onEnds={setEnds} invalid={!!clash} />
      {clash && (
        <p id="date-taken" className="m-error" role="alert">
          {clashNote(clash)} Pick other hours or another date, or <Link href={`/dashboard/events/${clash.id}`}>open “{clash.name}”</Link>.
        </p>
      )}
      {folder ? (
        <div className="m-field">
          <span className="m-label">Save attendance in</span>
          <div className="d-location is-large">
            <span className="d-location-path">
              {folder.path.map((s, i) => <span key={i}>{i > 0 && <span className="d-crumb-sep" aria-hidden="true">›</span>}{s}</span>)}
            </span>
            <button type="button" className="d-chip-btn" onClick={() => setPicking(true)}>Change</button>
          </div>
          <span className="d-field-note is-large">
            {name.trim() ? `Creates a new Google Sheet named “${name.trim()}” in this folder.` : "Creates a new Google Sheet named after the event in this folder."}{" "}
            <span className="d-nowrap">For example, <PathText path={[`MIT CSC ${schoolYearOn(new Date(`${date || today}T12:00:00Z`))}`, "9/4 Midway"]} />.</span>{" "}
            No folder yet? Select <PathText path={["Change", "New folder"]} />.
          </span>
        </div>
      ) : (
        <p className="d-field-note is-large">Attendance is saved here only. Connect the club Google account in Settings to also save it to a Google Sheet.</p>
      )}
    </>
  );
  const button = (
    <>
      {error && <p className="m-error" role="alert">{error}</p>}
      <button type="submit" className="m-btn is-block d-phone-submit" disabled={starting || !!clash}>{opensNow ? (starting ? "Starting…" : "Start check-in") : (starting ? "Creating…" : "Create event")}</button>
    </>
  );

  return (
    <main className="d-phone">
      <form className="d-phone-body" onSubmit={submit}>
        {variant === "page" ? (
          <>
            <Link className="m-back" href="/dashboard/events"><Icon name="back" />Events</Link>
            <h1 className="d-phone-title">New event</h1>
          </>
        ) : (
          <div className="d-start-head">
            <h1 className="d-phone-title">No event today</h1>
            <p className="d-start-text">
              There is no active event created yet. If there is an event today and you are checking people in, fill in the details below to create an event and start checking people in.
            </p>
          </div>
        )}
        {fields}
        {button}
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

