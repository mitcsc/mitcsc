import EventDesk from "@/components/dashboard/EventDesk";
import LiveData from "@/components/dashboard/LiveData";
import NoYear from "@/components/dashboard/NoYear";
import StartEvent from "@/components/dashboard/StartEvent";
import { formatDay, localDate } from "@/lib/membership/config";
import { clubFolder } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear, eventOn } from "@/lib/membership/store";

// The dashboard's home: check-in for today's event, or a way to start one.
export default async function CheckInPage() {
  const config = await currentYear();
  if (!config) return <NoYear />;
  const today = localDate(new Date());
  // Each day has at most one event (New event refuses a second one).
  const event = await eventOn(config.year, today);
  if (event) return <EventDesk event={event} back={null} />;

  // Nothing today: start the event here. Its sheet goes in the club folder, like on New event.
  const connection = await clubConnection();
  const root = connection && !connection.brokenAt ? await clubFolder().catch(() => null) : null;
  return (
    <>
      <LiveData renderedAt={Date.now()} />
      <StartEvent today={today} todayLabel={formatDay(today)} folder={root ? { id: root.id, name: root.name } : null} />
    </>
  );
}
