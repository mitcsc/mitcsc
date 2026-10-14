import Link from "next/link";
import DelibActions from "@/components/voting/DelibActions";
import { formatDay, localDate } from "@/lib/membership/config";
import { requireExecPerson } from "@/lib/membership/exec-auth";
import { allElections } from "@/lib/voting/redis-service";

export const dynamic = "force-dynamic";

// Every delib, for every exec. Only a delib's host can open its results, once it has ended.
export default async function PastDelibsPage() {
  const [me, delibs] = await Promise.all([requireExecPerson(), allElections()]);
  return (
    <main className="d-page">
      <div className="d-section-head">
        <h1 className="d-h2">History</h1>
      </div>
      <p className="d-section-note">Every delib shows up here. Only the host can see a delib&apos;s results, or delete it, after it ends.</p>
      <div className="d-table-wrap">
        <table className="d-table is-roomy d-events d-delib-history">
          <thead>
            <tr><th>Delib</th><th className="is-wide">Date</th><th className="is-wide">Host</th><th className="is-end"><span className="d-sr">Results</span></th></tr>
          </thead>
          <tbody>
            {delibs.map((delib) => {
              const day = formatDay(localDate(new Date(delib.createdAt)), true);
              const canOpen = !delib.open && delib.host === me.email;
              const href = `/dashboard/delibs/history/${delib.sessionId}`;
              return (
                <tr key={delib.sessionId}>
                  <td>
                    {canOpen ? <Link className="d-event-link" href={href}>{delib.name}</Link> : <span className="d-event-link">{delib.name}{delib.open && <span className="m-tag">Running</span>}</span>}
                    <span className="d-event-meta">{day} · {delib.hostName}</span>
                  </td>
                  <td className="is-soft is-wide">{day}</td>
                  <td className="is-soft is-wide">{delib.hostName}</td>
                  <td className="is-action">{canOpen && <DelibActions id={delib.sessionId} name={delib.name} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {delibs.length === 0 && <p className="d-empty-row">No delibs yet. Start one from the Live tab.</p>}
      </div>
    </main>
  );
}
