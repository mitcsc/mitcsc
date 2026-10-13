import Link from "next/link";
import { redirect } from "next/navigation";
import NewYearForm from "@/components/dashboard/NewYearForm";
import { canStartNextYear, nextSchoolYear, schoolYearOn } from "@/lib/membership/config";
import { getItem } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear, pastMemberCount } from "@/lib/membership/store";

// The folder picker opens one level above last year's sheet, where next year's folder usually is.
async function pickerStart(folderId: string | null) {
  if (!folderId) return "root";
  return (await getItem(folderId).catch(() => null))?.parents?.[0] || "root";
}

export default async function NewYearPage() {
  const [config, connection, pastMembers] = await Promise.all([currentYear(), clubConnection(), pastMemberCount()]);
  if (config && !canStartNextYear(config.year)) redirect("/dashboard/membership/settings");
  if (!connection || connection.brokenAt) {
    return (
      <main className="d-empty">
        <h1 className="d-empty-title">Connect Google first</h1>
        <p className="d-muted">A new school year needs the club Google account, which makes the folder and the sheet.</p>
        <Link className="m-btn is-medium" href="/dashboard/settings">Go to Settings</Link>
      </main>
    );
  }
  const year = config ? nextSchoolYear(config.year) : schoolYearOn(new Date());
  return (
    <NewYearForm
      year={year}
      previous={config?.year || null}
      prices={config?.prices || { new: 8, returning: 6 }}
      pickerStart={await pickerStart(config?.folderId || null)}
      pastMembers={pastMembers}
    />
  );
}
