"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, type FormEvent } from "react";
import { deleteLinkAction, moveLinkAction, saveLinkAction } from "@/app/dashboard/links/actions";
import { isActive, normalizeSlug, slugProblem, type ShortLink } from "@/lib/link-rules";
import { formatDay } from "@/lib/membership/config";
import { Icon } from "@/components/membership/icons";
import Dialog from "./Dialog";
import { Switch, Toast } from "./MembersView";

const FAILED = { ok: false as const, error: "Something went wrong. Please try again." };

// The Links section: short links (csc.mit.edu/<slug>) and the list on the public Links page, in one ordered list.
export default function LinksView({ links, clicks, origin, today }: { links: ShortLink[]; clicks: Record<string, number>; origin: string; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ShortLink | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(""), []);
  const host = origin.replace(/^https?:\/\//, "");

  async function move(id: string, step: -1 | 1) {
    setBusy(id);
    const result = await moveLinkAction(id, step).catch(() => FAILED);
    setBusy(null);
    if (!result.ok) setNotice(result.error);
    router.refresh();
  }

  async function copy(link: ShortLink) {
    await navigator.clipboard.writeText(`${origin}/${link.slug}`).catch(() => undefined);
    setCopied(link.id);
    window.setTimeout(() => setCopied((c) => (c === link.id ? null : c)), 1500);
  }

  return (
    <main className="d-page">
      <div className="d-section-head">
        <h1 className="d-h2">Links <span className="d-count">{links.length}</span></h1>
        <button type="button" className="d-icon-btn" aria-label="Add link" data-tip="Add link" data-tip-end onClick={() => setEditing("new")}><Icon name="plus" size={16} /></button>
      </div>
      <p className="d-section-note">{host}/<em className="d-link-em">name</em> sends people to any page. Links you show also list on {host}/links, in this order.</p>
      <div className="d-table-wrap">
        <table className="d-table is-roomy d-links">
          <thead>
            <tr><th>Link</th><th className="is-wide">Short link</th><th className="is-wide is-number">Clicks</th><th className="is-wide">Links page</th><th className="is-end"><span className="d-sr">Actions</span></th></tr>
          </thead>
          <tbody>
            {links.map((link, i) => {
              const active = isActive(link, today);
              return (
                <tr key={link.id} className={active ? undefined : "is-faded"}>
                  <td className={`d-link-cell${link.slug ? " has-slug" : ""}`}>
                    <button type="button" className="d-name-btn" onClick={() => setEditing(link)}>{link.title}</button>
                    <a className="d-link-url" href={link.url} target="_blank" rel="noreferrer">{link.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
                    {link.slug && <span className="d-link-meta">/{link.slug}{active ? "" : " · Expired"}</span>}
                  </td>
                  <td className="is-wide">
                    {link.slug ? (
                      <span className="d-slug">
                        <a href={`${origin}/${link.slug}`} target="_blank" rel="noreferrer">/{link.slug}</a>
                        <button type="button" className="d-slug-copy" aria-label={`Copy ${host}/${link.slug}`} data-tip={copied === link.id ? "Copied" : "Copy link"} onClick={() => copy(link)}>
                          <Icon name={copied === link.id ? "check" : "copy"} size={14} />
                        </button>
                      </span>
                    ) : <span className="is-faint">None</span>}
                  </td>
                  <td className="is-soft is-number is-wide">{link.slug ? clicks[link.id] || 0 : ""}</td>
                  <td className="is-wide"><LinkStatus link={link} active={active} /></td>
                  <td className="is-action">
                    <span className="d-row-actions">
                      <button type="button" className="d-more-btn" aria-label={`Move ${link.title} up`} disabled={i === 0 || busy === link.id} onClick={() => move(link.id, -1)}><Icon name="up" size={16} /></button>
                      <button type="button" className="d-more-btn" aria-label={`Move ${link.title} down`} disabled={i === links.length - 1 || busy === link.id} onClick={() => move(link.id, 1)}><Icon name="down" size={16} /></button>
                      <button type="button" className="d-more-btn" aria-label={`Edit ${link.title}`} onClick={() => setEditing(link)}><Icon name="more" size={18} /></button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {links.length === 0 && <p className="d-empty-row">No links yet.</p>}
      </div>
      <Toast message={notice} onDone={clearNotice} />
      {editing && (
        <LinkDialog
          link={editing === "new" ? null : editing} host={host}
          taken={links.filter((l) => l.slug && l.id !== (editing === "new" ? null : editing.id)).map((l) => l.slug!)}
          onClose={() => setEditing(null)}
          onDone={(message) => { setNotice(message); router.refresh(); }}
        />
      )}
    </main>
  );
}

function LinkStatus({ link, active }: { link: ShortLink; active: boolean }) {
  if (!active) return <span className="m-pill is-yellow">Expired {formatDay(link.expiresOn!)}</span>;
  return (
    <span className="d-link-status">
      {link.shown ? <span className="m-pill is-green">Shown</span> : <span className="m-tag">Hidden</span>}
      {link.expiresOn && <span className="is-faint">Until {formatDay(link.expiresOn)}</span>}
    </span>
  );
}

function LinkDialog({ link, host, taken, onClose, onDone }: { link: ShortLink | null; host: string; taken: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const [title, setTitle] = useState(link?.title || "");
  const [slug, setSlug] = useState(link?.slug || "");
  const [url, setUrl] = useState(link?.url || "");
  const [expiresOn, setExpiresOn] = useState(link?.expiresOn || "");
  const [shown, setShown] = useState(link?.shown ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clean = normalizeSlug(slug);
  const slugError = clean ? slugProblem(clean, taken) : null;

  async function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string, close: (then?: () => void) => void) {
    setBusy(true);
    setError("");
    const result = await work().catch(() => FAILED);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    close(() => { onClose(); onDone(message); });
  }

  function save(event: FormEvent, close: (then?: () => void) => void) {
    event.preventDefault();
    void run(() => saveLinkAction(link?.id ?? null, { title, slug, url, expiresOn, shown }), link ? "Saved the link." : "Added the link.", close);
  }

  function remove(close: (then?: () => void) => void) {
    if (!link || !window.confirm(`Delete “${link.title}”?${link.slug ? ` ${host}/${link.slug} stops working.` : ""}`)) return;
    void run(() => deleteLinkAction(link.id), "Deleted the link.", close);
  }

  return (
    <Dialog title={link ? "Edit link" : "Add link"} onClose={onClose}>
      {(close) => (
        <form className="d-dialog-form" onSubmit={(e) => save(e, close)}>
          <label className="d-field">
            <span className="m-label">Title</span>
            <input className="m-input is-compact" value={title} required maxLength={100} data-autofocus={link ? undefined : true} placeholder="Formal tickets" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="d-field">
            <span className="m-label">Goes to</span>
            <input className="m-input is-compact" value={url} required maxLength={2000} inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://" onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="d-field">
            <span className="m-label">Short link<span className="m-label-note">Optional</span></span>
            <span className={`d-prefix-input${slugError ? " is-invalid" : ""}`}>
              <span aria-hidden="true">{host}/</span>
              <input value={slug} maxLength={60} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="formal" aria-invalid={!!slugError} onChange={(e) => setSlug(e.target.value)} />
            </span>
            {slugError && <span className="d-field-error">{slugError}</span>}
          </label>
          <label className="d-field">
            <span className="m-label">Expires<span className="m-label-note">Optional</span></span>
            <input className="m-input is-compact" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            <span className="d-field-note">The link works through the end of this day.</span>
          </label>
          <div className="d-aside-switch">
            <span>Show on the Links page</span>
            <Switch checked={shown} label="Show on the Links page" onChange={setShown} />
          </div>
          {error && <p className="m-error" role="alert">{error}</p>}
          <button type="submit" className="m-btn is-medium" disabled={busy || !!slugError}>{busy ? "Saving…" : link ? "Save" : "Add link"}</button>
          {link && <button type="button" className="d-danger-link" disabled={busy} onClick={() => remove(close)}>Delete link</button>}
        </form>
      )}
    </Dialog>
  );
}
