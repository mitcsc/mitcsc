import EventDesk from "@/components/dashboard/EventDesk";
import LiveData from "@/components/dashboard/LiveData";
import NoYear from "@/components/dashboard/NoYear";
import NewEventForm from "@/components/dashboard/NewEventForm";
import { localDate } from "@/lib/membership/config";
import { homeEvent, takenEvent } from "@/lib/membership/event-times";
import { knownClubFolder } from "@/lib/membership/exec-auth";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear, eventsFrom, listMembers } from "@/lib/membership/store";

// The dashboard's home: check-in for the event that is open or opens within a day, or a way to start one.
// The check-in page reloads every few seconds on every exec's phone, so it reads only what it shows.
export default async function CheckInPage() {
  const config = await currentYear();
  if (!config) return <NoYear />;
  const now = new Date();
  const today = localDate(now);
  // The members load with the events, since an event usually shows. The event shown is always today's or later.
  const [upcoming, members] = await Promise.all([eventsFrom(config.year, today), listMembers(config.year)]);
  const event = homeEvent(upcoming, now);
  if (event) return <EventDesk event={event} members={members} back={null} />;

  // No event soon: the New event form, set to today. It warns about any event the picked hours overlap.
  const [events, connection] = await Promise.all([eventsFrom(config.year), clubConnection()]);
  const root = connection && !connection.brokenAt ? await knownClubFolder().catch(() => null) : null;
  return (
    <>
      <LiveData renderedAt={now.getTime()} />
      <NewEventForm variant="today" today={today} taken={events.map(takenEvent)} clubFolder={root ? { id: root.id, path: [root.name] } : null} />
    </>
  );
}
