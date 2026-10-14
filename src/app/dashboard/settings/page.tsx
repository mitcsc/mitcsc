import { DashboardSettings } from "@/components/dashboard/DashboardSettings";
import { execAccess } from "@/lib/membership/exec-auth";
import { folderUrl } from "@/lib/membership/google/drive";
import { clubConnection, clubEmail } from "@/lib/membership/google/oauth";
import { pastMemberCount } from "@/lib/membership/store";

export default async function DashboardSettingsPage() {
  const [connection, pastMembers] = await Promise.all([clubConnection(), pastMemberCount()]);
  const access = await execAccess().catch(() => null);
  return (
    <DashboardSettings
      folder={access?.folderId ? folderUrl(access.folderId) : null}
      people={access?.people || []}
      accessCheckedAt={access?.checkedAt || null}
      club={{
        email: connection?.email || clubEmail(),
        state: !connection ? "missing" : connection.brokenAt ? "broken" : "connected",
      }}
      pastMembers={pastMembers}
    />
  );
}
