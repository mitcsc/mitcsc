import Link from "next/link";
import EventActions from "@/components/dashboard/EventActions";
import LiveData from "@/components/dashboard/LiveData";
import NoYear from "@/components/dashboard/NoYear";
import { formatDay, localDate } from "@/lib/membership/config";
import { sheetUrl } from "@/lib/membership/google/drive";
import { currentYear, listEvents } from "@/lib/membership/store";

export default async function EventsPage() {
  const config = await currentYear();
  if (!config) return <NoYear />;
  const events = await listEvents(config.year);
  const today = localDate(new Date());
  return (
    <main className="d-page">
      <LiveData renderedAt={Date.now()} />
      <div className="d-section-head">
        <h1 className="d-h2">Events</h1>
        <Link className="m-btn is-medium" href="/dashboard/events/new">New event</Link>
      </div>
      <p className="d-section-note">Each event saves its attendance to its own Google Sheet. Open an event on your phone to scan cards.</p>
      <div className="d-table-wrap">
        <table className="d-table is-roomy d-events">
          <thead>
            <tr><th>Event</th><th className="is-wide">Date</th><th className="is-wide">Checked in</th><th className="is-end"><span className="d-sr">Actions</span></th></tr>
          </thead>
          <tbody>
            {events.map(({ event, count }) => (
              <tr key={event.id}>
                <td>
                  <Link className="d-event-link" href={`/dashboard/events/${event.id}`}>
                    {event.name}
                    {event.date === today && <span className="m-tag">Today</span>}
                  </Link>
                  <span className="d-event-meta">{formatDay(event.date)} · {count} checked in</span>
                </td>
                <td className="is-soft is-wide">{formatDay(event.date)}</td>
                <td className="is-soft is-number is-wide">{count}</td>
                <td className="is-action">
                  <EventActions id={event.id} name={event.name} count={count} sheet={event.sheetId ? sheetUrl(event.sheetId) : null} today={event.date === today} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 && <p className="d-empty-row">No events yet. Make one to start checking people in.</p>}
      </div>
    </main>
  );
}
