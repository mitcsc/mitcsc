import EventDesk from "@/components/dashboard/EventDesk";
import LiveData from "@/components/dashboard/LiveData";
import NoYear from "@/components/dashboard/NoYear";
import NewEventForm from "@/components/dashboard/NewEventForm";
import { formatDay, localDate } from "@/lib/membership/config";
import { clubFolder } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear, eventOn, listEvents } from "@/lib/membership/store";

// The dashboard's home: check-in for today's event, or a way to start one.
export default async function CheckInPage() {
  const config = await currentYear();
  if (!config) return <NoYear />;
  const today = localDate(new Date());
  // Each day has at most one event (New event refuses a second one).
  const event = await eventOn(config.year, today);
  if (event) return <EventDesk event={event} back={null} />;

  // Nothing today: the New event form, set to today.
  const connection = await clubConnection();
  const root = connection && !connection.brokenAt ? await clubFolder().catch(() => null) : null;
  const taken = Object.fromEntries((await listEvents(config.year)).map(({ event }) => [event.date, { id: event.id, name: event.name }]));
  return (
    <>
      <LiveData renderedAt={Date.now()} />
      <NewEventForm variant="today" today={today} todayLabel={formatDay(today)} taken={taken} clubFolder={root ? { id: root.id, path: [root.name] } : null} />
    </>
  );
}
