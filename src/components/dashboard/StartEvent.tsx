"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { createEventAction } from "@/app/dashboard/actions";

// The Check in tab when no event is on today's date.
export default function StartEvent({ today, todayLabel, folder }: { today: string; todayLabel: string; folder: { id: string; name: string } | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, startOpening] = useTransition();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await createEventAction({ name, date: today, folderId: folder?.id ?? null })
      .catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // The page now finds today's event and opens its check-in.
    startOpening(() => router.refresh());
  }

  return (
    <main className="d-phone">
      <form className="d-phone-body" onSubmit={submit}>
        <h1 className="d-phone-title">No event today</h1>
        <p className="d-start-text">To check people in, first start today’s event. Name it below, and check-in opens on this page.</p>
        <label className="m-field">
          <span className="m-label">Event name</span>
          <input className="m-input" value={name} required maxLength={100} placeholder="Event name" onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="d-field-note is-large">
          {folder
            ? `Dated today, ${todayLabel}. Attendance saves to a new Google Sheet in the “${folder.name}” folder.`
            : `Dated today, ${todayLabel}. Attendance is saved here only. Connect the club Google account in Settings to also save it to a Google Sheet.`}
        </p>
        {error && <p className="m-error" role="alert">{error}</p>}
        <button type="submit" className="m-btn is-block" disabled={busy || opening}>{busy || opening ? "Starting…" : "Start check-in"}</button>
        <p className="d-field-note is-large">Planning an event for another day, or want another folder? Use <Link href="/dashboard/events/new">New event</Link> instead.</p>
      </form>
    </main>
  );
}
