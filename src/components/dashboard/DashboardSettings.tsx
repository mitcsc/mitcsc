"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { importPastMembers, refreshExecAccess } from "@/app/dashboard/actions";
import DrivePicker from "./DrivePicker";
import { ago } from "./format";
import { Setting } from "./YearSettings";

export function DashboardSettings({ year, folder, people, accessCheckedAt, club, pastMembers, pickerStart }: {
  year: string | null;
  folder: string | null;
  people: { email: string; role: "Owner" | "Editor" }[];
  accessCheckedAt: number | null;
  club: { email: string; state: "missing" | "broken" | "connected" };
  pastMembers: number;
  pickerStart: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"access" | "import" | null>(null);
  const [picking, setPicking] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const connected = club.state === "connected";

  async function refresh() {
    setBusy("access");
    const result = await refreshExecAccess().catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(null);
    setMessage(result.ok ? null : { text: result.error, error: true });
    router.refresh();
  }

  async function importSheet(sheetId: string, name: string) {
    setPicking(false);
    setBusy("import");
    setMessage(null);
    const result = await importPastMembers(sheetId).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(null);
    setMessage(result.ok
      ? { text: `Read ${result.value.found} kerbs from “${name}”. They get the returning price.`, error: false }
      : { text: result.error, error: true });
    router.refresh();
  }

  return (
    <main className="d-settings">
      <Setting
        title="Exec access"
        note={year ? `Everyone who can edit the Drive folder with the ${year} membership sheet can use this dashboard. Change it in Drive.` : "After you start a school year, everyone who can edit the folder with its membership sheet can use this dashboard."}
      >
        {people.length > 0 ? (
          <div className="d-people-list">
            {people.map((p) => (
              <div key={p.email}><span>{p.email}</span><span className="d-role">{p.role}</span></div>
            ))}
          </div>
        ) : (
          <p className="d-field-note is-large">{connected ? "Nobody yet." : "Connect the club Google account to see who has access."} {club.email} can always sign in.</p>
        )}
        <div className="d-inline-actions">
          {folder && <a className="d-quiet-link" href={folder} target="_blank" rel="noreferrer">Open sharing in Drive</a>}
          {connected && year && (
            <button type="button" className="d-text-btn" onClick={refresh} disabled={busy === "access"} suppressHydrationWarning>
              {busy === "access" ? "Checking…" : `Checked ${accessCheckedAt ? ago(accessCheckedAt) : "never"}. Check again`}
            </button>
          )}
        </div>
      </Setting>

      <Setting title="Club Google account" note="Writes the Google Sheets and reads Venmo emails." center>
        <div className="d-account-row">
          <span className="d-account-name">
            {club.email}
            {club.state === "connected" && <span className="m-pill is-green">Connected</span>}
            {club.state === "broken" && <span className="m-pill is-yellow">Needs reconnecting</span>}
            {club.state === "missing" && <span className="m-pill is-yellow">Not connected</span>}
          </span>
          <form action="/api/auth/google/connect" method="get">
            <input type="hidden" name="next" value="/dashboard/settings" />
            <button type="submit" className={connected ? "d-chip-btn" : "m-btn is-medium"}>{connected ? "Reconnect" : "Connect"}</button>
          </form>
        </div>
        {!connected && <p className="d-field-note is-large">Sign in as {club.email} on the Google screen and allow every permission.</p>}
      </Setting>

      <Setting title="Past members" note="People who paid in an earlier year get the returning price.">
        <p className="d-field-note is-large">{pastMembers === 1 ? "1 person is" : `${pastMembers} people are`} on the list. Every confirmed payment adds the member automatically.</p>
        <div className="d-inline-actions">
          <button type="button" className="d-chip-btn" onClick={() => setPicking(true)} disabled={!connected || busy === "import"}>
            {busy === "import" ? "Reading the sheet…" : "Import from an old sheet"}
          </button>
          {!connected && <span className="d-field-note">Connect the club Google account first.</span>}
        </div>
        <p className="d-field-note">Reads the Kerberos or email column on the sheet’s first tab. The sheet must be shared with {club.email}.</p>
        {message && <p className={message.error ? "m-error" : "d-success"} role="status">{message.text}</p>}
      </Setting>

      {picking && (
        <DrivePicker title="Pick an old membership sheet" start={pickerStart} pick="sheet" onClose={() => setPicking(false)} onPick={(choice) => importSheet(choice.id, choice.path.at(-1) || "the sheet")} />
      )}
    </main>
  );
}
