"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { checkInPerson, type CheckInResult, type Person } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import { money } from "@/lib/membership/config";
import type { Attendance } from "@/lib/membership/types";
import { CheckedInPill, oweNote, type Admit } from "./checkin-parts";
import { shortEmail } from "./format";
import Scanner from "./Scanner";

const REFRESH_MS = 15_000;
const MAX_RESULTS = 25;

export default function CheckInDesk({ event, records: initialRecords, people: initialPeople }: {
  event: { id: string; name: string; date: string; sheet: string | null };
  records: Attendance[];
  people: Person[];
}) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [people, setPeople] = useState(initialPeople);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);

  // Other exec check people in at the same time, so reload every few seconds.
  useEffect(() => setRecords(initialRecords), [initialRecords]);
  useEffect(() => setPeople(initialPeople), [initialPeople]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

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

  const recent = [...records].sort((a, b) => b.at - a.at);
  return (
    <main className="d-phone">
      <div className="d-phone-body">
        <Link className="m-back" href="/dashboard/events"><Icon name="back" />Events</Link>
        <div className="d-checkin-head">
          <h1 className="d-phone-title">{event.name}</h1>
          <span className="d-checkin-meta">
            <span>{event.date}</span>
            <span>{records.length} checked in</span>
            {event.sheet && <a href={event.sheet} target="_blank" rel="noreferrer">Open sheet</a>}
          </span>
        </div>
        <button type="button" className="m-btn is-block" onClick={() => setScanning(true)}><Icon name="scan" size={18} />Scan card</button>
        <input className="m-input d-checkin-search" type="search" aria-label="Search name or kerb" placeholder="Search name or kerb" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        {error && <p className="m-error" role="alert">{error}</p>}

        <div className="d-people">
          {query.trim() ? (
            matches.length ? matches.map((p) => <PersonRow key={p.kerb} person={p} record={byKerb.get(p.kerb) || null} busy={busy === p.kerb} admit={admit} />)
              : <p className="d-empty-row">Nobody signed up matches “{query.trim()}”. New members can sign up at csc.mit.edu/join.</p>
          ) : recent.length ? (
            recent.map((r) => {
              const p = people.find((x) => x.kerb === r.kerb) || { kerb: r.kerb, name: r.name, classYear: r.classYear, price: 0, method: "cash" as const, paid: r.paid, reportedAt: null };
              return <PersonRow key={r.kerb} person={p} record={r} busy={false} admit={admit} />;
            })
          ) : (
            <p className="d-empty-row">Nobody is checked in yet. Scan a card or search for a name.</p>
          )}
        </div>
      </div>
      {scanning && <Scanner eventId={event.id} eventName={event.name} onClose={() => setScanning(false)} onResult={apply} admit={admit} />}
    </main>
  );
}

function PersonRow({ person: p, record, busy, admit }: { person: Person; record: Attendance | null; busy: boolean; admit: Admit }) {
  const unpaid = !record && !p.paid;
  const status = record
    ? <CheckedInPill at={record.at} />
    : p.paid ? <span className="m-pill is-green">Active</span> : <span className="m-pill is-yellow">Not paid</span>;
  return (
    <div className={`d-person${unpaid ? " is-unpaid" : ""}`}>
      <div className="d-person-top">
        <div className="d-person-who">
          <span className="d-person-name">{p.name}</span>
          <span className="d-tags">{status}<span className="m-tag">{p.kerb}</span><span className="m-tag">{p.classYear}</span></span>
        </div>
        {record && <span className="d-person-by">by {shortEmail(record.by)}</span>}
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
