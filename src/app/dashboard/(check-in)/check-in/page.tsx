import EventDesk from "@/components/dashboard/EventDesk";
import LiveData from "@/components/dashboard/LiveData";
import NoYear from "@/components/dashboard/NoYear";
import NewEventForm from "@/components/dashboard/NewEventForm";
import { localDate } from "@/lib/membership/config";
import { homeEvent, takenEvent } from "@/lib/membership/event-times";
import { clubFolder } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear, listEvents } from "@/lib/membership/store";

// The dashboard's home: check-in for the event that is open or opens within a day, or a way to start one.
export default async function CheckInPage() {
  const config = await currentYear();
  if (!config) return <NoYear />;
  const now = new Date();
  const events = (await listEvents(config.year)).map(({ event }) => event);
  const event = homeEvent(events, now);
  if (event) return <EventDesk event={event} back={null} />;

  // No event soon: the New event form, set to today.
  const connection = await clubConnection();
  const root = connection && !connection.brokenAt ? await clubFolder().catch(() => null) : null;
  return (
    <>
      <LiveData renderedAt={now.getTime()} />
      <NewEventForm variant="today" today={localDate(now)} taken={events.map(takenEvent)} clubFolder={root ? { id: root.id, path: [root.name] } : null} />
    </>
  );
}
