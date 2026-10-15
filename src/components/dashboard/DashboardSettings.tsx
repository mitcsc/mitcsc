"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { refreshExecAccess } from "@/app/dashboard/actions";
import { CLUB_DRIVE_FOLDER, formatDay } from "@/lib/membership/config";
import type { WalletUsage } from "@/lib/membership/wallet";
import { ago } from "./format";
import { Setting } from "./YearSettings";

export function DashboardSettings({ folder, people, accessCheckedAt, club, wallet }: {
  folder: string | null;
  people: { email: string; role: "Owner" | "Editor" }[];
  accessCheckedAt: number | null;
  // "no-email": connected before card emails existed, so it can't send them yet.
  club: { email: string; state: "missing" | "broken" | "no-email" | "connected" };
  // null when WALLETWALLET_API_KEY isn't set. usage is null when WalletWallet can't be reached.
  wallet: { usage: WalletUsage | null; pausedUntil: string | null } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"access" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const connected = club.state === "connected" || club.state === "no-email";
  const query = search.trim().toLowerCase();
  const shownPeople = query ? people.filter((p) => p.email.toLowerCase().includes(query)) : people;

  async function refresh() {
    setBusy("access");
    const result = await refreshExecAccess().catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(null);
    setMessage(result.ok ? null : { text: result.error, error: true });
    router.refresh();
  }

  return (
    <main className="d-settings">
      <Setting
        title="Exec access"
        note={`Everyone who can edit the “${CLUB_DRIVE_FOLDER}” folder in ${club.email}’s Google Drive can use this dashboard. Change it in Drive.`}
      >
        {people.length > 0 ? (
          <div className="d-access">
            <input
              className="d-search is-wide" type="search" aria-label="Search people with access"
              placeholder={`Search ${people.length} ${people.length === 1 ? "person" : "people"}`}
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            <div className="d-access-list">
              {shownPeople.map((p) => (
                <div key={p.email}><span>{p.email}</span><span className="d-role">{p.role}</span></div>
              ))}
              {shownPeople.length === 0 && <p className="d-empty-row">Nobody matches.</p>}
            </div>
          </div>
        ) : (
          <p className="d-field-note is-large">{!connected ? "Connect the club Google account to see who has access." : folder ? "Nobody yet." : `No “${CLUB_DRIVE_FOLDER}” folder found in this Drive.`} {club.email} can always sign in.</p>
        )}
        <div className="d-inline-actions">
          {folder && <a className="d-quiet-link" href={folder} target="_blank" rel="noreferrer">Open sharing in Drive</a>}
          {connected && folder && (
            <button type="button" className="d-text-btn" onClick={refresh} disabled={busy === "access"} suppressHydrationWarning>
              {busy === "access" ? "Checking…" : `Checked ${accessCheckedAt ? ago(accessCheckedAt) : "never"}. Check again`}
            </button>
          )}
        </div>
        {message && <p className={message.error ? "m-error" : "d-success"} role="status">{message.text}</p>}
      </Setting>

      <Setting title="Club Google account" note="Writes the Google Sheets, reads Venmo emails, and sends card emails." center>
        <div className="d-account-row">
          <span className="d-account-name">
            {club.email}
            {club.state === "connected" && <span className="m-pill is-green">Connected</span>}
            {club.state === "broken" && <span className="m-pill is-yellow">Needs reconnecting</span>}
            {club.state === "no-email" && <span className="m-pill is-yellow">Card emails off</span>}
            {club.state === "missing" && <span className="m-pill is-yellow">Not connected</span>}
          </span>
          <form action="/api/auth/google/connect" method="get">
            <input type="hidden" name="next" value="/dashboard/settings" />
            <button type="submit" className={connected ? "d-chip-btn" : "m-btn is-medium"}>{connected ? "Reconnect" : "Connect"}</button>
          </form>
        </div>
        {!connected && <p className="d-field-note is-large">Sign in as {club.email} on the Google screen and allow every permission.</p>}
      </Setting>

      <Setting title="Wallet cards" note="Apple and Google Wallet membership cards, made by WalletWallet. Making or cancelling a card counts toward the monthly limit." center>
        <WalletStatus wallet={wallet} />
      </Setting>
    </main>
  );
}

function WalletStatus({ wallet }: { wallet: { usage: WalletUsage | null; pausedUntil: string | null } | null }) {
  if (!wallet) return <p className="d-field-note is-large">Not set up. Add <code>WALLETWALLET_API_KEY</code> in Vercel to turn on Wallet cards.</p>;
  const { usage, pausedUntil } = wallet;
  const full = !!pausedUntil || (!!usage && usage.count >= usage.limit);
  const close = !full && !!usage && usage.count >= usage.limit * 0.9;
  const resets = pausedUntil || usage?.resetDate;
  return (
    <>
      <div className="d-account-row">
        <span className="d-account-name">
          {usage ? `${usage.count.toLocaleString()} of ${usage.limit.toLocaleString()} this month` : "This month’s count is unavailable"}
          {full && <span className="m-pill is-yellow">Limit reached</span>}
          {close && <span className="m-pill is-yellow">Almost at the limit</span>}
          {!full && !close && usage && <span className="m-pill is-green">Working</span>}
        </span>
      </div>
      {full && <p className="d-field-note is-large">Members don’t see the Wallet option until {resets ? formatDay(resets) : "the 1st"}. Cards they already have still work, and check-in by name or kerb works as usual.</p>}
      {!full && resets && <p className="d-field-note is-large">Resets {formatDay(resets)}.</p>}
    </>
  );
}
