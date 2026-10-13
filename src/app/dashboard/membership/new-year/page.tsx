import Link from "next/link";
import NewYearForm from "@/components/dashboard/NewYearForm";
import { nextSchoolYear, schoolYearOn } from "@/lib/membership/config";
import { getItem, itemPath } from "@/lib/membership/google/drive";
import { clubConnection } from "@/lib/membership/google/oauth";
import { currentYear, pastMemberCount } from "@/lib/membership/store";

// The folder that holds every "MIT CSC <year>" folder, found from last year's folder.
async function baseFolder(folderId: string | null) {
  if (!folderId) return { id: "root", path: [] as string[] };
  try {
    const parent = (await getItem(folderId)).parents?.[0];
    if (!parent) return { id: "root", path: [] };
    return { id: parent, path: (await itemPath(parent)).map((p) => p.name) };
  } catch {
    return { id: "root", path: [] };
  }
}

export default async function NewYearPage() {
  const [config, connection, pastMembers] = await Promise.all([currentYear(), clubConnection(), pastMemberCount()]);
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
      base={await baseFolder(config?.folderId || null)}
      pastMembers={pastMembers}
    />
  );
}
