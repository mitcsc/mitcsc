import NewEventForm from "@/components/dashboard/NewEventForm";
import NoYear from "@/components/dashboard/NoYear";
import { localDate } from "@/lib/membership/config";
import { clubFolder, clubPath } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear } from "@/lib/membership/store";

export default async function NewEventPage() {
  const [config, connection] = await Promise.all([currentYear(), clubConnection()]);
  if (!config) return <NoYear />;
  const root = connection && !connection.brokenAt ? await clubFolder().catch(() => null) : null;
  // New event sheets go where the last one went, or in the club folder.
  const last = root && config.eventsFolderId ? await clubPath(config.eventsFolderId, root).catch(() => null) : null;
  const folder = last || (root && [{ id: root.id, name: root.name }]);
  return (
    <NewEventForm
      today={localDate(new Date())}
      eventsFolder={folder ? { id: folder.at(-1)!.id, path: folder.map((p) => p.name) } : null}
    />
  );
}
