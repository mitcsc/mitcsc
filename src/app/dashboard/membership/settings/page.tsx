import NoYear from "@/components/dashboard/NoYear";
import YearSettings from "@/components/dashboard/YearSettings";
import { nextSchoolYear } from "@/lib/membership/config";
import { currentYear } from "@/lib/membership/store";

export default async function MembershipSettingsPage() {
  const config = await currentYear();
  if (!config) return <NoYear />;
  return <YearSettings config={config} nextYear={nextSchoolYear(config.year)} />;
}
