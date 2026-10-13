import Link from "next/link";
import { redirect } from "next/navigation";
import NewYearForm from "@/components/dashboard/NewYearForm";
import { canStartNextYear, membershipFolderPath, nextSchoolYear, schoolYearOn } from "@/lib/membership/config";
import { findFolderPath } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear, pastMemberCount } from "@/lib/membership/store";

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
  // Picks "MIT CSC/MIT CSC <year>/Membership" when it exists, or opens the picker as deep as it goes.
  const names = membershipFolderPath(year);
  const found = await findFolderPath(names).catch(() => []);
  const suggested = found.length === names.length ? { id: found.at(-1)!.id, path: found.map((f) => f.name) } : null;
  return (
    <NewYearForm
      year={year}
      previous={config?.year || null}
      prices={config?.prices || { new: 8, returning: 6 }}
      suggested={suggested}
      pickerStart={found.at(-1)?.id || "root"}
      pastMembers={pastMembers}
    />
  );
}
