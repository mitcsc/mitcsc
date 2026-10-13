import NewEventForm from "@/components/dashboard/NewEventForm";
import NoYear from "@/components/dashboard/NoYear";
import { localDate } from "@/lib/membership/config";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear } from "@/lib/membership/store";

export default async function NewEventPage() {
  const [config, connection] = await Promise.all([currentYear(), clubConnection()]);
  if (!config) return <NoYear />;
  return (
    <NewEventForm
      year={config.year}
      today={localDate(new Date())}
      googleReady={!!connection && !connection.brokenAt && !!config.folderId}
      eventsFolder={config.eventsFolderId || config.folderId}
    />
  );
}
