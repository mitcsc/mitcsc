import Link from "next/link";
import { schoolYearOn } from "@/lib/membership/config";
import { clubConnection } from "@/lib/membership/google/oauth";

// Shown on membership and event pages before the first school year exists.
export default async function NoYear() {
  const connection = await clubConnection();
  const ready = !!connection && !connection.brokenAt;
  return (
    <main className="d-empty">
      <h1 className="d-empty-title">Set up {schoolYearOn(new Date())}</h1>
      {ready ? (
        <>
          <p className="d-muted">Create the Drive folder and Google Sheet for this school year. Members can’t sign up until you open signups.</p>
          <Link className="m-btn is-medium" href="/dashboard/membership/new-year">Start {schoolYearOn(new Date())}</Link>
        </>
      ) : (
        <>
          <p className="d-muted">First connect the club Google account. It writes the Google Sheets and reads Venmo emails.</p>
          <Link className="m-btn is-medium" href="/dashboard/settings">Go to Settings</Link>
        </>
      )}
    </main>
  );
}
