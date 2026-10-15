import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/membership/icons";
import PastResults from "@/components/voting/PastResults";
import { requireExecPerson } from "@/lib/membership/exec-auth";
import { exportToken } from "@/lib/voting/export-link";
import { allElections, electionResults } from "@/lib/voting/redis-service";

export const dynamic = "force-dynamic";

// A finished delib's full results. Only its host can see them.
export default async function PastDelibPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, delibs] = await Promise.all([requireExecPerson(), allElections()]);
  const delib = delibs.find((d) => d.sessionId === id);
  if (delib?.open) redirect("/dashboard/delibs/live");
  if (!delib || delib.host !== me.email) {
    return (
      <main className="d-page">
        <Link className="m-back" href="/dashboard/delibs/history"><Icon name="back" />History</Link>
        <h1 className="d-h2">{delib ? delib.name : "Delib not found"}</h1>
        <p className="d-section-note">{delib ? `Only ${delib.hostName}, the host, can see these results.` : "This delib does not exist."}</p>
      </main>
    );
  }
  const results = await electionResults(id, me);
  return (
    <main className="voting-root d-delibs">
      <PastResults results={{ ...results, exportToken: exportToken(id, me.email) }} />
    </main>
  );
}
