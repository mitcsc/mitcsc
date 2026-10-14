import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/membership/icons";
import { requireExecPerson } from "@/lib/membership/exec-auth";
import { allElections } from "@/lib/voting/redis-service";

export const dynamic = "force-dynamic";

// The link a host shares. Signing in comes first (the dashboard layout handles it).
// While the delib runs, the link opens it on the Live tab, where the exec joins.
export default async function DelibLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, delibs] = await Promise.all([requireExecPerson(), allElections()]);
  const delib = delibs.find((d) => d.sessionId === id);
  if (delib?.open) redirect("/dashboard/delibs");
  if (delib && delib.host === me.email) redirect(`/dashboard/delibs/history/${id}`);
  return (
    <main className="d-page">
      <Link className="m-back" href="/dashboard/delibs"><Icon name="back" />Live</Link>
      <h1 className="d-h2">{delib ? delib.name : "Delib not found"}</h1>
      <p className="d-section-note">{delib ? `This delib has ended. Only ${delib.hostName}, the host, can see the results.` : "This delib does not exist."}</p>
    </main>
  );
}
