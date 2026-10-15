import NewEventForm from "@/components/dashboard/NewEventForm";
import NoYear from "@/components/dashboard/NoYear";
import { localDate } from "@/lib/membership/config";
import { clubFolder } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { takenEvent } from "@/lib/membership/event-times";
import { currentYear, listEvents } from "@/lib/membership/store";

export default async function NewEventPage() {
  const [config, connection] = await Promise.all([currentYear(), clubConnection()]);
  if (!config) return <NoYear />;
  // New event sheets start in the club folder. Exec pick a folder inside it for each event.
  const root = connection && !connection.brokenAt ? await clubFolder().catch(() => null) : null;
  // Events on the same day cannot overlap, so the form warns before someone picks taken hours.
  const taken = (await listEvents(config.year)).map(({ event }) => takenEvent(event));
  return (
    <NewEventForm
      today={localDate(new Date())}
      taken={taken}
      clubFolder={root ? { id: root.id, path: [root.name] } : null}
    />
  );
}
