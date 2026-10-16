import NewEventForm from "@/components/dashboard/NewEventForm";
import NoYear from "@/components/dashboard/NoYear";
import { localDate } from "@/lib/membership/config";
import { knownClubFolder } from "@/lib/membership/exec-auth";
import { clubConnection } from "@/lib/membership/google/oauth";
import { takenEvent } from "@/lib/membership/event-times";
import { currentYear, eventsFrom } from "@/lib/membership/store";

export default async function NewEventPage() {
  const [config, connection] = await Promise.all([currentYear(), clubConnection()]);
  if (!config) return <NoYear />;
  // New event sheets start in the club folder. Exec pick a folder inside it for each event.
  // Events on the same day cannot overlap, so the form warns before someone picks taken hours.
  const [root, events] = await Promise.all([
    connection && !connection.brokenAt ? knownClubFolder().catch(() => null) : null,
    eventsFrom(config.year),
  ]);
  const taken = events.map(takenEvent);
  return (
    <NewEventForm
      today={localDate(new Date())}
      taken={taken}
      clubFolder={root ? { id: root.id, path: [root.name] } : null}
    />
  );
}
