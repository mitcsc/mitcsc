import { DashboardSettings } from "@/components/dashboard/DashboardSettings";
import { CLUB_DRIVE_FOLDER } from "@/lib/membership/config";
import { execAccess } from "@/lib/membership/exec-auth";
import { findFolder, folderUrl } from "@/lib/membership/google/drive";
import { clubConnection, clubEmail } from "@/lib/membership/google/oauth";
import { currentYear, pastMemberCount } from "@/lib/membership/store";

export default async function DashboardSettingsPage() {
  const [config, connection, pastMembers] = await Promise.all([currentYear(), clubConnection(), pastMemberCount()]);
  const access = await execAccess().catch(() => null);
  const connected = !!connection && !connection.brokenAt;
  const clubFolder = connected ? await findFolder(CLUB_DRIVE_FOLDER).catch(() => null) : null;
  return (
    <DashboardSettings
      year={config?.year || null}
      folder={config?.folderId ? folderUrl(config.folderId) : null}
      people={access?.people || []}
      accessCheckedAt={access?.checkedAt || null}
      club={{
        email: connection?.email || clubEmail(),
        state: !connection ? "missing" : connection.brokenAt ? "broken" : "connected",
      }}
      pastMembers={pastMembers}
      pickerStart={clubFolder?.id || "root"}
    />
  );
}
