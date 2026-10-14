import Link from "next/link";
import EventDesk from "@/components/dashboard/EventDesk";
import LiveData from "@/components/dashboard/LiveData";
import NoYear from "@/components/dashboard/NoYear";
import StartEvent from "@/components/dashboard/StartEvent";
import { Icon } from "@/components/membership/icons";
import { formatDay, localDate } from "@/lib/membership/config";
import { clubFolder } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear, listEvents } from "@/lib/membership/store";

// The dashboard's home: check-in for today's event, or a way to start one.
export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const config = await currentYear();
  if (!config) return <NoYear />;
  const today = localDate(new Date());
  const todays = (await listEvents(config.year)).filter(({ event }) => event.date === today);
  const picked = (await searchParams).event;

  if (todays.length === 1) return <EventDesk event={todays[0].event} back={null} />;
  const chosen = todays.find(({ event }) => event.id === picked);
  if (chosen) return <EventDesk event={chosen.event} back={{ href: "/dashboard/check-in", label: "Today’s events" }} />;

  if (todays.length > 1) {
    return (
      <main className="d-phone">
        <LiveData renderedAt={Date.now()} />
        <div className="d-phone-body">
          <h1 className="d-phone-title">Pick today’s event</h1>
          <p className="d-start-text">There is more than one event today. Pick the one you are checking people in for.</p>
          <div className="d-today-list">
            {todays.map(({ event, count }) => (
              <Link key={event.id} className="d-today-event" href={`/dashboard/check-in?event=${event.id}`}>
                <span className="d-today-name">{event.name}</span>
                <span className="d-today-count">{count} checked in</span>
                <Icon name="right" />
              </Link>
            ))}
          </div>
        </div>
      </main>
    );
  }

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
