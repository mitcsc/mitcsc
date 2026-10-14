"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { checkVenmoNow, confirmPayment, markUnpaid, removeSignup, syncSheetNow, updateSettings } from "@/app/dashboard/actions";
import { formatDay, formatStamp, money, venmoNote } from "@/lib/membership/config";
import type { SyncStatus } from "@/lib/membership/sync";
import type { Member, PaymentMethod, Question } from "@/lib/membership/types";
import { Icon } from "@/components/membership/icons";
import Dialog from "./Dialog";
import { ago, confirmLabel, METHOD_NAMES, paidLabel, shortEmail } from "./format";

export type MemberRow = Omit<Member, "year" | "wallet" | "venmoMessageId">;

interface YearInfo {
  year: string;
  signupsOpen: boolean;
  closesOn: string | null;
  questions: Question[];
}

const PENDING_PREVIEW = 5;
const PENDING_COLLAPSED_KEY = "csc-dashboard-pending-collapsed";

export function Switch({ checked, label, onChange, disabled }: { checked: boolean; label: string; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="d-switch" onClick={() => onChange(!checked)} disabled={disabled}>
      <span />
    </button>
  );
}

// A message at the bottom of the screen, so results never shift the page.
export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDone, 6000);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);
  return <p className={`d-toast${message ? " is-shown" : ""}`} role="status" aria-live="polite">{message}</p>;
}

function StatusPill({ member }: { member: MemberRow }) {
  return member.status === "paid"
    ? <span className="m-pill is-green">{paidLabel(member.paidVia, member.method)}</span>
    : <span className="m-pill is-yellow">{confirmLabel(member.method)}</span>;
}

function payDetail(member: MemberRow, year: string) {
  if (member.method === "cash") return "Paying at an event";
  if (!member.reportedAt) return `Signed up ${formatStamp(member.createdAt)}. Hasn't said they paid yet.`;
  if (member.method === "zelle") return `Look for ${member.name.toUpperCase()} in the Zelle account`;
  return `No Venmo payment with the note “${venmoNote(year, member.kerb)}” yet`;
}

export default function MembersView({ year, members, sheet, venmoCheckedAt, signup }: {
  year: YearInfo;
  members: MemberRow[];
  sheet: { url: string; sync: SyncStatus | null } | null;
  venmoCheckedAt: number | null;
  signup: { url: string; label: string; qr: string };
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "paid" | "pending">("all");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(true);
  // Animate only after the first click, so a saved collapsed state does not animate on load.
  const [collapseMoved, setCollapseMoved] = useState(false);
  const clearNotice = useCallback(() => setNotice(""), []);

  const paid = members.filter((m) => m.status === "paid");
  // People who said they paid come first.
  const pending = members.filter((m) => m.status === "unpaid").sort((a, b) => (b.reportedAt ? 1 : 0) - (a.reportedAt ? 1 : 0));
  const collected = paid.reduce((sum, m) => sum + m.price, 0);
  const shown = useMemo(() => {
    const query = search.trim().toLowerCase();
    return members.filter((m) => (filter === "all" || (filter === "paid" ? m.status === "paid" : m.status === "unpaid"))
      && (!query || m.name.toLowerCase().includes(query) || m.kerb.includes(query)));
  }, [members, filter, search]);
  const selected = members.find((m) => m.kerb === open) || null;

  async function run(key: string, work: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) {
    setBusy(key);
    setNotice("");
    const result = await work().catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(null);
    if (!result.ok) setNotice(result.error);
    else if (done) setNotice(done);
    router.refresh();
    return result.ok;
  }

  // Remember a collapsed pending section on this device only.
  useEffect(() => {
    try { if (localStorage.getItem(PENDING_COLLAPSED_KEY) === "1") setPendingOpen(false); } catch {}
  }, []);

  function togglePending() {
    const next = !pendingOpen;
    setCollapseMoved(true);
    setPendingOpen(next);
    try { localStorage.setItem(PENDING_COLLAPSED_KEY, next ? "0" : "1"); } catch {}
  }

  async function remove(m: MemberRow) {
    if (!window.confirm(`Remove ${m.name}'s signup? Their Wallet card stops working.`)) return false;
    return run(m.kerb, () => removeSignup(m.kerb), `Removed ${m.name}'s signup.`);
  }

  async function checkVenmo() {
    setBusy("venmo");
    setNotice("");
    const result = await checkVenmoNow().catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(null);
    if (!result.ok) setNotice(result.error);
    else {
      const n = result.value.confirmed.length;
      setNotice(n ? `Confirmed ${n} Venmo payment${n === 1 ? "" : "s"}.` : "No new Venmo payments.");
    }
    router.refresh();
  }

  async function copyLink() {
    await navigator.clipboard.writeText(signup.url).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const example = pending.find((m) => m.method === "venmo")?.kerb || "panda";
  return (
    <div className="d-body">
      <aside className="d-aside">
        <h2 className="d-aside-title">{year.year}</h2>
        <div className="d-aside-switch">
          <span>Accepting signups</span>
          <Switch checked={year.signupsOpen} label="Accepting signups" disabled={busy === "open"} onChange={(value) => run("open", () => updateSettings({ signupsOpen: value }))} />
        </div>
        <dl className="d-facts">
          <div><dt>Paid</dt><dd>{paid.length}</dd></div>
          <div><dt>Pending confirmation</dt><dd>{pending.length}</dd></div>
          <div><dt>Collected</dt><dd>{money(collected)}</dd></div>
          <div><dt>Closes</dt><dd>{year.closesOn ? formatDay(year.closesOn) : "Not set"}</dd></div>
        </dl>
        <div className="d-aside-line" />
        <div className="d-aside-links">
          {sheet ? (
            <a className="d-aside-link" href={sheet.url} target="_blank" rel="noreferrer">
              <Icon name="sheet" size={18} className="d-aside-icon" />
              <span className="d-aside-text">
                <span>Google Sheet</span>
                <span className={`d-aside-sub${sheet.sync && !sheet.sync.ok ? " is-error" : ""}`} suppressHydrationWarning>
                  {!sheet.sync ? "Not synced yet" : sheet.sync.ok ? `Synced ${ago(sheet.sync.at)}` : `Sync failed ${ago(sheet.sync.at)}`}
                </span>
              </span>
            </a>
          ) : (
            <div className="d-aside-link is-static">
              <Icon name="sheet" size={18} className="d-aside-icon" />
              <span className="d-aside-text"><span>Google Sheet</span><span className="d-aside-sub">Not set up</span></span>
            </div>
          )}
          {sheet?.sync && !sheet.sync.ok && (
            <button type="button" className="d-aside-link is-wide" onClick={() => run("sync", syncSheetNow, "The Google Sheet is up to date.")} disabled={busy === "sync"}>
              <Icon name="sheet" size={18} className="d-aside-icon" />
              <span className="d-aside-text">
                <span>{busy === "sync" ? "Syncing…" : "Sync again"}</span>
                <span className="d-aside-sub">{sheet.sync.error}</span>
              </span>
            </button>
          )}
          <button type="button" className="d-aside-link" onClick={copyLink}>
            <Icon name={copied ? "check" : "link"} size={18} className="d-aside-icon" />
            <span className="d-aside-text">
              <span>{copied ? "Copied" : "Copy signup link"}</span>
              <span className="d-aside-sub">{signup.label}</span>
            </span>
          </button>
          <button type="button" className="d-aside-link" onClick={() => setShowQr(true)}>
            <Icon name="qr" size={18} className="d-aside-icon" />
            <span className="d-aside-text"><span>Show QR code</span></span>
          </button>
        </div>
      </aside>

      <main className="d-main">
        <section className="d-section">
          <div className="d-section-head">
            <h2 className="d-h2">
              <button type="button" className="d-collapse" aria-expanded={pendingOpen} aria-controls="pending-list" onClick={togglePending}>
                Pending confirmation <span className="d-count">{pending.length}</span>
                <Icon name="chevron" size={18} className="d-collapse-icon" />
              </button>
            </h2>
          </div>
          <div id="pending-list" className={`d-collapsible${pendingOpen ? " is-open" : ""}${collapseMoved ? " is-animated" : ""}`} inert={!pendingOpen}>
            <div className="d-collapsible-inner">
              <p className="d-section-note" suppressHydrationWarning>
                The Venmo check confirms a payment only when its note matches exactly, like <span className="d-nowrap"><span className="d-code">{venmoNote(year.year, example)}</span>.</span>
                {" "}All other payments need manual confirmation.
              </p>
              <div className="d-venmo-row">
                <span suppressHydrationWarning>{venmoCheckedAt ? `Venmo last checked ${ago(venmoCheckedAt)}.` : "Venmo not checked yet."}</span>
                <button type="button" className="d-chip-btn" onClick={checkVenmo} disabled={busy === "venmo"}>{busy === "venmo" ? "Checking…" : "Check Venmo"}</button>
              </div>
              {pending.length === 0 && <p className="d-empty-row">Nobody is waiting.</p>}
              {(showAll ? pending : pending.slice(0, PENDING_PREVIEW)).map((m) => (
                <div className="d-pending" key={m.kerb}>
                  <div className="d-pending-who">
                    <button type="button" className="d-name-btn" onClick={() => setOpen(m.kerb)}>{m.name}</button>
                    <span className="d-tags"><span className="m-tag">{m.kerb}</span><span className="m-tag">{m.classYear}</span><span className="m-tag">{m.type === "returning" ? "Returning" : "New"}</span></span>
                  </div>
                  <div className="d-pending-pay">
                    <span>{money(m.price)} {m.method === "cash" ? "in cash" : `by ${METHOD_NAMES[m.method]}`}</span>
                    <span className="d-pending-detail">{payDetail(m, year.year)}</span>
                  </div>
                  <div className="d-pending-action">
                    <button type="button" className="m-btn is-light is-small" disabled={busy === m.kerb} onClick={() => run(m.kerb, () => confirmPayment(m.kerb, m.method), `${m.name} is marked paid.`)}>
                      {busy === m.kerb ? "Confirming…" : "Confirm payment"}
                    </button>
                    <MoreButton name={m.name} onClick={() => setOpen(m.kerb)} />
                  </div>
                </div>
              ))}
              {pending.length > PENDING_PREVIEW && (
                <button type="button" className="d-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${pending.length}`}</button>
              )}
            </div>
          </div>
        </section>

        <section className="d-section">
          <div className="d-section-head is-table">
            <h2 className="d-h2">All members</h2>
            <div className="d-table-tools">
              <div role="tablist" aria-label="Filter" className="d-filters">
                {([["all", `All ${members.length}`], ["paid", `Paid ${paid.length}`], ["pending", `Pending ${pending.length}`]] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>{label}</button>
                ))}
              </div>
              <input className="d-search" aria-label="Search members" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="d-table-wrap">
            <table className="d-table d-members">
              <thead>
                <tr><th>Name</th><th className="is-wide">Kerb</th><th className="is-wide">Year</th><th className="is-wide">Type</th><th>Payment</th><th className="is-wide">Signed up</th><th className="is-action" aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.kerb}>
                    <td>
                      <button type="button" className="d-name-btn" onClick={() => setOpen(m.kerb)}>{m.name}</button>
                      <span className="d-member-meta">{m.kerb}</span>
                    </td>
                    <td className="is-soft is-wide">{m.kerb}</td>
                    <td className="is-soft is-wide">{m.classYear}</td>
                    <td className="is-soft is-wide">{m.type === "returning" ? "Returning" : "New"}</td>
                    <td><StatusPill member={m} /></td>
                    <td className="is-faint is-wide">{formatStamp(m.createdAt)}</td>
                    <td className="is-action"><MoreButton name={m.name} onClick={() => setOpen(m.kerb)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="d-empty-row">{members.length ? "No members match." : "Nobody has signed up yet."}</p>}
          </div>
        </section>
      </main>

      <Toast message={notice} onDone={clearNotice} />
      {selected && <MemberDialog member={selected} year={year} onClose={() => setOpen(null)} run={run} remove={remove} busy={busy} />}
      {showQr && (
        <Dialog title="Signup QR code" onClose={() => setShowQr(false)}>
          <div className="d-qr" dangerouslySetInnerHTML={{ __html: signup.qr }} />
          <p className="d-qr-label">{signup.label}</p>
        </Dialog>
      )}
    </div>
  );
}

function MoreButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" className="d-more-btn" aria-label={`Actions for ${name}`} onClick={onClick}>
      <Icon name="more" size={18} />
    </button>
  );
}

function MemberDialog({ member: m, year, onClose, run, remove, busy }: {
  member: MemberRow; year: YearInfo; onClose: () => void; busy: string | null; remove: (m: MemberRow) => Promise<boolean>;
  run: (key: string, work: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) => Promise<boolean>;
}) {
  const [method, setMethod] = useState<PaymentMethod>(m.method);
  const answers = year.questions.map((q) => {
    const value = m.answers[q.id];
    return { label: q.label, value: Array.isArray(value) ? value.join(", ") : value || "" };
  }).filter((a) => a.value);
  return (
    <Dialog title={m.name} onClose={onClose}>
      {(close) => (
        <>
          <span className="d-tags"><span className="m-tag">{m.kerb}</span><span className="m-tag">{m.classYear}</span><span className="m-tag">{m.type === "returning" ? "Returning" : "New"}</span><StatusPill member={m} /></span>
          <dl className="d-detail">
            <div><dt>Lives in</dt><dd>{m.dorm}</dd></div>
            {answers.map((a) => <div key={a.label}><dt>{a.label}</dt><dd>{a.value}</dd></div>)}
            <div><dt>Price</dt><dd>{money(m.price)}</dd></div>
            <div><dt>Signed up</dt><dd>{formatStamp(m.createdAt)}</dd></div>
            {m.paidAt && <div><dt>Paid on</dt><dd>{formatStamp(m.paidAt)}</dd></div>}
            {m.confirmedBy && <div><dt>Confirmed by</dt><dd>{m.confirmedBy.includes("@") ? shortEmail(m.confirmedBy) : m.confirmedBy}</dd></div>}
          </dl>
          {m.status === "unpaid" ? (
            <div className="d-dialog-actions">
              <div className="m-segments" role="radiogroup" aria-label="Paid by">
                {(["venmo", "zelle", "cash"] as const).map((x) => (
                  <button key={x} type="button" role="radio" aria-checked={method === x} onClick={() => setMethod(x)}>{METHOD_NAMES[x]}</button>
                ))}
              </div>
              <button type="button" className="m-btn is-medium" disabled={busy === m.kerb} onClick={async () => { if (await run(m.kerb, () => confirmPayment(m.kerb, method), `${m.name} is marked paid.`)) close(); }}>
                Confirm {money(m.price)} received
              </button>
            </div>
          ) : (
            <div className="d-dialog-actions">
              <button type="button" className="m-btn is-outline is-medium" disabled={busy === m.kerb} onClick={() => run(m.kerb, () => markUnpaid(m.kerb), `${m.name} is marked not paid.`)}>Mark as not paid</button>
            </div>
          )}
          <button
            type="button" className="d-danger-link" disabled={busy === m.kerb}
            onClick={async () => { if (await remove(m)) close(); }}
          >
            Remove signup
          </button>
        </>
      )}
    </Dialog>
  );
}
