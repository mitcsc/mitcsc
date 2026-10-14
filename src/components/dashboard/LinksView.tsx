"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { deleteLinkAction, reorderLinksAction, saveLinkAction } from "@/app/dashboard/links/actions";
import { isActive, normalizeSlug, slugProblem, type ShortLink } from "@/lib/link-rules";
import { formatDay } from "@/lib/membership/config";
import { Icon } from "@/components/membership/icons";
import Dialog from "./Dialog";
import { Switch, Toast } from "./MembersView";

const FAILED = { ok: false as const, error: "Something went wrong. Please try again." };

// A row being dragged: where it started and where it would land, the pointer's travel, and every row's middle on screen.
type Drag = { from: number; to: number; dy: number; startY: number; mids: number[]; height: number };

// The Links section: short links (csc.mit.edu/<slug>) and the list on the public Links page, in one ordered list.
export default function LinksView({ links, clicks, origin, today }: { links: ShortLink[]; clicks: Record<string, number>; origin: string; today: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ShortLink | "new" | null>(null);
  // The order on screen. It changes at once on a drop, before the server saves it.
  const [order, setOrder] = useState(links);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(""), []);
  const host = origin.replace(/^https?:\/\//, "");

  useEffect(() => { if (!dragRef.current) setOrder(links); }, [links]);

  async function saveOrder(next: ShortLink[]) {
    setOrder(next);
    const result = await reorderLinksAction(next.map((l) => l.id)).catch(() => FAILED);
    if (!result.ok) {
      setNotice(result.error);
      setOrder(links);
    }
    router.refresh();
  }

  function moved(from: number, to: number) {
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  }

  // Dragging follows the pointer (mouse or touch) from the handle. Other rows slide aside to show where it lands.
  function startDrag(event: PointerEvent<HTMLButtonElement>, from: number) {
    if (event.button !== 0 || !body.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rects = [...body.current.rows].map((row) => row.getBoundingClientRect());
    const start: Drag = { from, to: from, dy: 0, startY: event.clientY, mids: rects.map((r) => r.top + r.height / 2), height: rects[from].height };
    dragRef.current = start;
    setDrag(start);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const d = dragRef.current;
    if (!d) return;
    const dy = Math.min(Math.max(event.clientY - d.startY, d.mids[0] - d.mids[d.from]), d.mids[d.mids.length - 1] - d.mids[d.from]);
    const center = d.mids[d.from] + dy;
    const to = d.mids.filter((mid, i) => i !== d.from && mid < center).length;
    dragRef.current = { ...d, dy, to };
    setDrag(dragRef.current);
  }

  function endDrag() {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (d && d.to !== d.from) void saveOrder(moved(d.from, d.to));
  }

  // Arrow keys move the focused row by one place.
  function keyMove(event: KeyboardEvent<HTMLButtonElement>, from: number) {
    const to = event.key === "ArrowUp" ? from - 1 : event.key === "ArrowDown" ? from + 1 : -1;
    if (to < 0 || to >= order.length) return;
    event.preventDefault();
    void saveOrder(moved(from, to));
  }

  // How far a row slides while another is dragged.
  function shift(i: number) {
    if (!drag) return undefined;
    if (i === drag.from) return `translateY(${drag.dy}px)`;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return `translateY(${-drag.height}px)`;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) return `translateY(${drag.height}px)`;
    return undefined;
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
        <table className={`d-table is-roomy d-links${drag ? " is-sorting" : ""}`}>
          <thead>
            <tr><th className="d-drag-cell" aria-hidden="true" /><th>Link</th><th className="is-wide">Short link</th><th className="is-wide is-number">Clicks</th><th className="is-wide">Visibility</th><th className="is-end"><span className="d-sr">Actions</span></th></tr>
          </thead>
          <tbody ref={body}>
            {order.map((link, i) => {
              const active = isActive(link, today);
              return (
                <tr key={link.id} className={[active ? "" : "is-faded", drag?.from === i ? "is-dragging" : ""].join(" ").trim() || undefined} style={{ transform: shift(i) }}>
                  <td className="d-drag-cell">
                    <button
                      type="button" className="d-drag-handle" aria-label={`Reorder ${link.title}. Use the arrow keys to move it.`} data-tip="Drag to reorder"
                      onPointerDown={(e) => startDrag(e, i)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={(e) => keyMove(e, i)}
                    >
                      <Icon name="grip" size={16} />
                    </button>
                  </td>
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
                    <button type="button" className="d-more-btn" aria-label={`Edit ${link.title}`} onClick={() => setEditing(link)}><Icon name="more" size={18} /></button>
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
      {link.shown ? <span className="m-pill is-green" data-tip="Listed on the Links page">Active</span> : <span className="m-tag" data-tip="Not listed on the Links page">Inactive</span>}
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
