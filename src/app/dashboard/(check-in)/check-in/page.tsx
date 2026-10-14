import EventDesk from "@/components/dashboard/EventDesk";
import LiveData from "@/components/dashboard/LiveData";
import NoYear from "@/components/dashboard/NoYear";
import NewEventForm from "@/components/dashboard/NewEventForm";
import { formatDay, localDate } from "@/lib/membership/config";
import { checkInState, formatHours, localNow, opensAt, startsSoon, takenEvent } from "@/lib/membership/event-times";
import { clubFolder } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear, eventsOn, listEvents } from "@/lib/membership/store";
import type { EventInfo } from "@/lib/membership/types";

// Of today's events (earliest first): the one open now, else the next to open, else the last one.
function pick(events: EventInfo[], now: Date) {
  const time = localNow(now).time;
  return events.find((e) => checkInState(e, now).open) || events.find((e) => e.starts && e.starts > time) || events.at(-1) || null;
}

// The dashboard's home: check-in for today's event, or a way to start one.
export default async function CheckInPage() {
  const config = await currentYear();
  if (!config) return <NoYear />;
  const now = new Date();
  const today = localDate(now);
  const event = pick(await eventsOn(config.year, today), now);
  if (event) return <EventDesk event={event} back={null} />;

  // Nothing today: the New event form, set to today, under any event that starts within a day, so nobody makes it twice.
  const connection = await clubConnection();
  const root = connection && !connection.brokenAt ? await clubFolder().catch(() => null) : null;
  const events = (await listEvents(config.year)).map(({ event }) => event);
  const upcoming = events
    .filter((e) => startsSoon(e, now.getTime()))
    .map((e) => ({ id: e.id, name: e.name, when: [formatDay(e.date), formatHours(e)].filter(Boolean).join(", "), opensAt: opensAt(e) }))
    .sort((a, b) => a.opensAt - b.opensAt);
  return (
    <>
      <LiveData renderedAt={now.getTime()} />
      <NewEventForm variant="today" today={today} taken={events.map(takenEvent)} upcoming={upcoming} renderedAt={now.getTime()} clubFolder={root ? { id: root.id, path: [root.name] } : null} />
    </>
  );
}
