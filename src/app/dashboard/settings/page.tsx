import { DashboardSettings } from "@/components/dashboard/DashboardSettings";
import { execAccess } from "@/lib/membership/exec-auth";
import { folderUrl } from "@/lib/membership/google/drive";
import { canSendEmail, clubConnection, clubEmail } from "@/lib/membership/google/oauth";
import { walletEnabled, walletPausedUntil, walletUsage } from "@/lib/membership/wallet";

export default async function DashboardSettingsPage() {
  const connection = await clubConnection();
  const access = await execAccess().catch(() => null);
  const [usage, pausedUntil] = await Promise.all([walletUsage(), walletPausedUntil().catch(() => null)]);
  return (
    <DashboardSettings
      folder={access?.folderId ? folderUrl(access.folderId) : null}
      people={access?.people || []}
      accessCheckedAt={access?.checkedAt || null}
      club={{
        email: connection?.email || clubEmail(),
        state: !connection ? "missing" : connection.brokenAt ? "broken" : canSendEmail(connection) ? "connected" : "no-email",
      }}
      wallet={walletEnabled() ? { usage, pausedUntil } : null}
    />
  );
}
