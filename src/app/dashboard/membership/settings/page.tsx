import NoYear from "@/components/dashboard/NoYear";
import YearSettings from "@/components/dashboard/YearSettings";
import { canStartNextYear, nextSchoolYear } from "@/lib/membership/config";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear, listPastSheets, returningCounts } from "@/lib/membership/store";

export default async function MembershipSettingsPage() {
  const [config, connection] = await Promise.all([currentYear(), clubConnection()]);
  if (!config) return <NoYear />;
  // Listing first moves any untracked earlier imports, so the count matches the list.
  const pastSheets = await listPastSheets();
  return (
    <YearSettings
      config={config}
      nextYear={canStartNextYear(config.year) ? nextSchoolYear(config.year) : null}
      connected={!!connection && !connection.brokenAt}
      past={{ ...(await returningCounts(config.year)), sheets: pastSheets }}
    />
  );
}
