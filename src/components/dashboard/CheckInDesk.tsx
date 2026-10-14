"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { checkInPerson, setEventCheckIn, undoCheckInPerson, type CheckInResult, type Person } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import { money } from "@/lib/membership/config";
import { checkInState, formatCountdown, opensAt, startsSoon, type EventHours } from "@/lib/membership/event-times";
import type { Attendance } from "@/lib/membership/types";
import { CheckedInPill, oweNote, type Admit, type Undo } from "./checkin-parts";
import { shortEmail } from "./format";
import { useLiveData } from "./LiveData";
import Scanner from "./Scanner";

const REFRESH_MS = 15_000;
const MAX_RESULTS = 25;

// back is null on the Check in tab, where the sub-tabs already lead elsewhere.
export default function CheckInDesk({ event, records: initialRecords, people: initialPeople, renderedAt, back }: {
  event: { id: string; name: string; when: string; sheet: string | null; hours: EventHours };
  records: Attendance[];
  people: Person[];
  renderedAt: number;
  back: { href: string; label: string } | null;
}) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [people, setPeople] = useState(initialPeople);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [toggling, setToggling] = useState(false);
  // Check-in opens and closes on its own, so the state follows the clock. It starts from the server's time to match its render.
  // It ticks every second for the countdown to opening.
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const state = checkInState(event.hours, new Date(now));
  // Within a day of opening, a countdown replaces the opening time, which the line above already shows.
  const note = !state.open && !event.hours.checkIn && startsSoon(event.hours, now) ? `Opens in ${formatCountdown(opensAt(event.hours) - now)}` : state.note;

  // Other exec check people in at the same time, so reload every few seconds.
  useEffect(() => setRecords(initialRecords), [initialRecords]);
  useEffect(() => setPeople(initialPeople), [initialPeople]);
  useLiveData(renderedAt, REFRESH_MS);

  const byKerb = useMemo(() => new Map(records.map((r) => [r.kerb, r])), [records]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people.filter((p) => p.kerb.includes(q) || p.name.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  }, [people, query]);

  // Records the result locally so the list updates before the next reload.
  function apply(result: CheckInResult) {
    if (result.kind === "unknown") return;
    setPeople((list) => list.map((p) => (p.kerb === result.person.kerb ? result.person : p)));
    if (result.kind !== "unpaid") setRecords((list) => (list.some((r) => r.kerb === result.record.kerb) ? list : [...list, result.record]));
  }

  const admit: Admit = async (kerb, mode) => {
    setBusy(kerb);
    setError("");
    const result = await checkInPerson(event.id, kerb, mode).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    apply(result.value);
    return result.value;
  };

  const undo: Undo = async (kerb) => {
    setBusy(kerb);
    setError("");
    const result = await undoCheckInPerson(event.id, kerb).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setRecords((list) => list.filter((r) => r.kerb !== kerb));
    return true;
  };

  async function toggle() {
    setToggling(true);
    setError("");
    const result = await setEventCheckIn(event.id, !state.open).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    if (!result.ok) setError(result.error);
    else router.refresh();
    setToggling(false);
  }

  const recent = [...records].sort((a, b) => b.at - a.at);
  return (
    <main className="d-phone">
      <div className="d-phone-body">
        {back && <Link className="m-back" href={back.href}><Icon name="back" />{back.label}</Link>}
        <div className="d-checkin-head">
          <h1 className="d-phone-title">{event.name}</h1>
          <span className="d-checkin-meta">
            <span>{event.when}</span>
            <span>{records.length} checked in</span>
            {event.sheet && <a href={event.sheet} target="_blank" rel="noreferrer">Open sheet</a>}
          </span>
        </div>
        <div className={`d-checkin-state${state.open ? " is-open" : ""}`}>
          <span className="d-checkin-state-text">
            <span className="d-checkin-state-title">{state.open ? "Check-in is open" : "Check-in is closed"}</span>
            <span className="d-checkin-state-note" suppressHydrationWarning>{note}</span>
          </span>
          <button type="button" className="d-chip-btn" disabled={toggling} onClick={() => void toggle()}>{state.toggle}</button>
        </div>
        {state.open && (
          <>
            <button type="button" className="m-btn is-block" onClick={() => setScanning(true)}><Icon name="scan" size={18} />Scan card</button>
            <input className="m-input d-checkin-search" type="search" aria-label="Search name or kerb" placeholder="Search name or kerb" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </>
        )}
        {error && <p className="m-error" role="alert">{error}</p>}

        <div className="d-people">
          {state.open && query.trim() ? (
            matches.length ? matches.map((p) => <PersonRow key={p.kerb} person={p} record={byKerb.get(p.kerb) || null} busy={busy === p.kerb} admit={admit} undo={undo} />)
              : <p className="d-empty-row">Nobody signed up matches “{query.trim()}”. New members can sign up at csc.mit.edu/join.</p>
          ) : recent.length ? (
            recent.map((r) => {
              const p = people.find((x) => x.kerb === r.kerb) || { kerb: r.kerb, name: r.name, classYear: r.classYear, price: 0, method: "cash" as const, paid: r.paid, reportedAt: null };
              return <PersonRow key={r.kerb} person={p} record={r} busy={busy === r.kerb} admit={admit} undo={undo} />;
            })
          ) : (
            <p className="d-empty-row">Nobody is checked in yet.{state.open && " Scan a card or search for a name."}</p>
          )}
        </div>
        {/* On the Check In tab, today's event may not have started yet or may be over, so offer a way to another event. */}
        {!back && !state.open && <Link className="m-btn is-outline is-block d-phone-submit" href="/dashboard/events/new">Create a different event</Link>}
      </div>
      {scanning && state.open && <Scanner eventId={event.id} eventName={event.name} onClose={() => setScanning(false)} onResult={apply} admit={admit} undo={undo} />}
    </main>
  );
}

function PersonRow({ person: p, record, busy, admit, undo }: { person: Person; record: Attendance | null; busy: boolean; admit: Admit; undo: Undo }) {
  const unpaid = !record && !p.paid;
  const status = record
    ? <CheckedInPill at={record.at} />
    : p.paid ? <span className="m-pill is-green">Active</span> : <span className="m-pill is-yellow">Not paid</span>;
  return (
    <div className={`d-person${unpaid ? " is-unpaid" : ""}`}>
      <div className="d-person-top">
        <div className="d-person-who">
          <span className="d-person-name">{p.name}</span>
          <span className="d-tags">{status}<span className="m-tag">{p.kerb}</span>{p.classYear && <span className="m-tag">{p.classYear}</span>}</span>
        </div>
        {record && (
          <span className="d-person-side">
            <span className="d-person-by">by {shortEmail(record.by)}</span>
            <button type="button" className="d-undo" disabled={busy} onClick={() => undo(p.kerb)}>{busy ? "Undoing…" : "Undo"}</button>
          </span>
        )}
        {!record && p.paid && <button type="button" className="m-btn is-light is-medium" disabled={busy} onClick={() => admit(p.kerb, "check-in")}>{busy ? "Checking in…" : "Check in"}</button>}
      </div>
      {unpaid && (
        <>
          <p className="d-person-note" suppressHydrationWarning>{oweNote(p)}</p>
          <button type="button" className="m-btn is-block d-person-btn" disabled={busy} onClick={() => admit(p.kerb, "confirm")}>Confirm {money(p.price)} received</button>
          <button type="button" className="m-btn is-outline is-block d-person-btn" disabled={busy} onClick={() => admit(p.kerb, "anyway")}>Check in anyway</button>
        </>
      )}
    </div>
  );
}
