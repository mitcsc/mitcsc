import NewEventForm from "@/components/dashboard/NewEventForm";
import NoYear from "@/components/dashboard/NoYear";
import { localDate } from "@/lib/membership/config";
import { itemPath } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear } from "@/lib/membership/store";

export default async function NewEventPage() {
  const [config, connection] = await Promise.all([currentYear(), clubConnection()]);
  if (!config) return <NoYear />;
  const googleReady = !!connection && !connection.brokenAt && !!config.folderId;
  // New event sheets go where the last one went, or next to the membership sheet.
  const folderId = config.eventsFolderId || config.folderId;
  const path = googleReady && folderId ? (await itemPath(folderId).catch(() => [])).map((p) => p.name) : [];
  return (
    <NewEventForm
      today={localDate(new Date())}
      googleReady={googleReady}
      eventsFolder={folderId ? { id: folderId, path } : null}
    />
  );
}
