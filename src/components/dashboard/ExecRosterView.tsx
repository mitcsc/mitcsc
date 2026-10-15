"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  movePersonAction, refreshExecPhotosAction, removePersonAction, reorderRosterAction, savePersonAction, uploadExecPhotoAction,
} from "@/app/dashboard/website/exec/actions";
import { Icon } from "@/components/membership/icons";
import { execPhotoUrl, type ExecPerson, type ExecPhoto, type RosterList } from "@/lib/exec-roster";
import { sizedThumbnail } from "@/lib/home-photo-urls";
import { shrinkImage } from "@/lib/shrink-image";
import Dialog from "./Dialog";
import { useSave } from "./Shell";
import { useGridReorder } from "./useGridReorder";

type LibraryPhoto = ExecPhoto & { createdAt: number };
type Close = (then?: () => void) => void;

const FAILED = { ok: false as const, error: "Something went wrong. Please try again." };
const THUMB_WIDTHS = [256, 384, 512];
const NAMES: Record<RosterList, { title: string; other: RosterList; move: string; site: string }> = {
  current: { title: "Active", other: "alumni", move: "Move to alumni", site: "/exec" },
  alumni: { title: "Alumni", other: "current", move: "Move to active", site: "/alumni" },
};

// A photo's URL at `width`: straight from Google while a fresh signed link is at hand, else through the site.
function photoSrc(photo: Pick<ExecPhoto, "id" | "version">, thumbnails: Record<string, string>) {
  const link = thumbnails[photo.id];
  return (width: number) => (link ? sizedThumbnail(link, width) : execPhotoUrl(photo, width));
}

function PhotoImage({ photo, thumbnails, sizes }: { photo: Pick<ExecPhoto, "id" | "version">; thumbnails: Record<string, string>; sizes: string }) {
  const src = photoSrc(photo, thumbnails);
  // eslint-disable-next-line @next/next/no-img-element -- already resized by Google
  return <img src={src(384)} srcSet={THUMB_WIDTHS.map((w) => `${src(w)} ${w}w`).join(", ")} sizes={sizes} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" draggable={false} />;
}

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// The Current and Alumni tabs: a grid of cards in the order of the public page.
export default function ExecRosterView({ list, people, roles, photos: initialPhotos, thumbnails: initialThumbnails, folder, checkDrive, local }: {
  list: RosterList; people: ExecPerson[]; roles: string[]; photos: LibraryPhoto[]; thumbnails: Record<string, string>; folder: string | null; checkDrive: boolean; local: boolean;
}) {
  const router = useRouter();
  const save = useSave();
  const names = NAMES[list];
  const [order, setOrder] = useState(people);
  const [editing, setEditing] = useState<ExecPerson | "new" | null>(null);
  const [photos, setPhotos] = useState(initialPhotos);
  const [thumbnails, setThumbnails] = useState(initialThumbnails);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const reorder = useGridReorder<HTMLUListElement>({ count: order.length, onMove: (from, to) => void saveOrder(from, to) });

  useEffect(() => setOrder(people), [people]);
  useEffect(() => setPhotos(initialPhotos), [initialPhotos]);
  useEffect(() => setThumbnails(initialThumbnails), [initialThumbnails]);

  async function saveOrder(from: number, to: number) {
    const next = [...order];
    next.splice(to, 0, next.splice(from, 1)[0]);
    setOrder(next);
    const result = await save(() => reorderRosterAction(list, next.map((p) => p.id)));
    if (!result.ok) setOrder(people);
    router.refresh();
  }

  // Moves someone to the other list, with Undo in the message to put them back where they were.
  async function move(person: ExecPerson) {
    const result = await save(() => movePersonAction(person.id, names.other));
    router.refresh();
    if (!result.ok) return;
    const from = result.value;
    setNotice({
      text: `Moved ${person.name} to ${names.other === "alumni" ? "alumni" : "active"}.`,
      undo: async () => {
        setNotice(null);
        const back = await save(() => movePersonAction(person.id, from.list, from.index));
        if (back.ok) setNotice({ text: `${person.name} is back in ${from.list === "alumni" ? "alumni" : "active"}.` });
        router.refresh();
      },
    });
  }

  const known = new Set(photos.map((p) => p.id));
  return (
    <main className="d-page">
      <div className="d-section-head">
        <h1 className="d-h2">{names.title} <span className="d-count">{order.length}</span></h1>
        <div className="d-head-actions">
          {folder && <a className="d-chip-btn" href={folder} target="_blank" rel="noreferrer">Open folder in Drive</a>}
          <button type="button" className="d-icon-btn" aria-label="Add person" data-tip="Add person" onClick={() => setEditing("new")}><Icon name="plus" size={16} /></button>
        </div>
      </div>
      <p className="d-section-note">
        This is what is displayed on <a className="d-quiet-link" href={names.site} target="_blank" rel="noreferrer">csc.mit.edu{names.site}</a>. Click a card to edit everything. Drag a card to change the display order.
      </p>
      <ul ref={reorder.listRef} className={`d-exec-grid${reorder.sorting ? " is-sorting" : ""}`}>
        {order.map((person, i) => {
          const { className, ...item } = reorder.itemProps(i);
          const missing = !!person.photo && photos.length > 0 && !known.has(person.photo.id);
          return (
            <li key={person.id} {...item} className={["d-exec-card", className].join(" ").trim()}>
              <button type="button" className="d-exec-open" onClick={() => setEditing(person)} aria-label={`Edit ${person.name}`}>
                <span className="d-exec-photo">
                  {person.photo ? <PhotoImage photo={person.photo} thumbnails={thumbnails} sizes="(max-width: 640px) 45vw, 200px" /> : <span className="d-exec-initials">{initials(person.name)}</span>}
                  {missing && <span className="d-photo-failed"><Icon name="alert" size={14} />Not in Drive</span>}
                </span>
                <span className="d-exec-name">{person.name}</span>
                <span className="d-exec-role">{person.position}</span>
                <span className="d-exec-meta">Class of {person.classYear}{person.hometown ? ` · ${person.hometown}` : ""}</span>
              </button>
              <button type="button" className="d-drag-handle d-exec-handle" aria-label={`Reorder ${person.name}`} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown" {...reorder.handleProps(i)}>
                <Icon name="grip" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      {order.length === 0 && <p className="d-empty-row">Nobody here yet.</p>}
      <NoticeToast notice={notice} onDone={clearNotice} />
      {editing && (
        <PersonDialog
          list={list} person={editing === "new" ? null : editing} roles={roles} photos={photos} thumbnails={thumbnails} checkDrive={checkDrive} local={local}
          onPhotos={(library, links) => { setPhotos(library); if (links) setThumbnails(links); }}
          onClose={() => setEditing(null)}
          onSaved={(text) => { setNotice({ text }); router.refresh(); }}
          onMove={(person) => void move(person)}
        />
      )}
    </main>
  );
}

// A message at the bottom of the screen, with an Undo button when the change can be undone.
function NoticeToast({ notice, onDone }: { notice: { text: string; undo?: () => void } | null; onDone: () => void }) {
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onDone, notice.undo ? 10_000 : 6000);
    return () => window.clearTimeout(timer);
  }, [notice, onDone]);
  return (
    <div className={`d-toast${notice ? " is-shown" : ""}${notice?.undo ? " has-action" : ""}`} role="status" aria-live="polite">
      {notice && <><span>{notice.text}</span>{notice.undo && <button type="button" className="d-toast-action" onClick={notice.undo}>Undo</button>}</>}
    </div>
  );
}

function PersonDialog({ list, person, roles, photos, thumbnails, checkDrive, local, onPhotos, onClose, onSaved, onMove }: {
  list: RosterList; person: ExecPerson | null; roles: string[]; photos: LibraryPhoto[]; thumbnails: Record<string, string>; checkDrive: boolean; local: boolean;
  onPhotos: (photos: LibraryPhoto[], thumbnails?: Record<string, string>) => void;
  onClose: () => void; onSaved: (message: string) => void; onMove: (person: ExecPerson) => void;
}) {
  const [name, setName] = useState(person?.name || "");
  const [position, setPosition] = useState(person?.position || (list === "current" ? roles[0] : "") || "");
  const [classYear, setClassYear] = useState(person?.classYear || "");
  const [hometown, setHometown] = useState(person?.hometown || "");
  const [photo, setPhoto] = useState<ExecPhoto | null>(person?.photo || null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Someone moved back from alumni keeps their old position until it is changed, even if it is no longer a role.
  const options = person && !roles.includes(person.position) ? [...roles, person.position] : roles;

  async function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string, close: Close) {
    setBusy(true);
    setError("");
    const result = await work().catch(() => FAILED);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    close(() => { onClose(); onSaved(message); });
  }

  function submit(event: FormEvent, close: Close) {
    event.preventDefault();
    void run(() => savePersonAction(list, person?.id ?? null, { name, position, classYear, hometown, photoId: photo?.id ?? null }), person ? `Saved ${name.trim()}.` : `Added ${name.trim()}.`, close);
  }

  function remove(close: Close) {
    if (!person || !window.confirm(`Remove ${person.name} from the site? Their photo stays in Drive.`)) return;
    void run(() => removePersonAction(person.id), `Removed ${person.name}.`, close);
  }

  return (
    <Dialog title={picking ? "Choose a photo" : person ? `Edit ${person.name}` : "Add person"} wide={picking} onClose={onClose}>
      {(close) => picking ? (
        <PhotoPicker
          list={list} photos={photos} thumbnails={thumbnails} selected={photo?.id ?? null} checkDrive={checkDrive} local={local} uploadName={name}
          onPhotos={onPhotos}
          onPick={(picked) => { setPhoto(picked); setPicking(false); }}
          onBack={() => setPicking(false)}
        />
      ) : (
        <form className="d-dialog-form" onSubmit={(e) => submit(e, close)}>
          <div className="d-exec-form-grid">
            <div className="d-field">
              <span className="m-label">Photo</span>
              <button type="button" className="d-exec-photo is-edit" title={photo?.name} onClick={() => setPicking(true)}>
                {photo ? <PhotoImage photo={photo} thumbnails={thumbnails} sizes="136px" /> : <span className="d-exec-initials">{initials(name) || "?"}</span>}
                <span className="d-exec-photo-label">{photo ? "Change photo" : "Choose photo"}</span>
              </button>
            </div>
            <div className="d-exec-form-fields">
              <label className="d-field">
                <span className="m-label">Name</span>
                <input className="m-input is-compact" value={name} required maxLength={60} data-autofocus={person ? undefined : true} onChange={(e) => setName(e.target.value)} />
              </label>
              {list === "alumni" ? (
                <label className="d-field">
                  <span className="m-label">Position</span>
                  <input className="m-input is-compact" value={position} required maxLength={60} list="exec-roles" placeholder="Their title on exec" onChange={(e) => setPosition(e.target.value)} />
                  <datalist id="exec-roles">{roles.map((role) => <option key={role} value={role} />)}</datalist>
                </label>
              ) : (
                <label className="d-field">
                  <span className="m-label">Position<Link className="d-quiet-link" href="/dashboard/website/roles">Edit roles</Link></span>
                  <span className="m-select-wrap">
                    <select className="m-select is-compact" value={position} required onChange={(e) => setPosition(e.target.value)}>
                      {options.length === 0 && <option value="">No roles yet</option>}
                      {options.map((role) => <option key={role} value={role}>{role}</option>)}
                    </select>
                    <Icon name="chevron" />
                  </span>
                </label>
              )}
            </div>
            <label className="d-field">
              <span className="m-label">Class year</span>
              <input className="m-input is-compact" value={classYear} required inputMode="numeric" pattern="\d{4}" maxLength={4} placeholder="2028" onChange={(e) => setClassYear(e.target.value)} />
            </label>
            <label className="d-field">
              <span className="m-label">Hometown<span className="m-label-note">Optional</span></span>
              <input className="m-input is-compact" value={hometown} maxLength={40} placeholder="Boston, MA" onChange={(e) => setHometown(e.target.value)} />
            </label>
          </div>
          {error && <p className="m-error" role="alert">{error}</p>}
          <button type="submit" className="m-btn is-medium" disabled={busy}>{busy ? "Saving…" : person ? "Save" : "Add person"}</button>
          {person && (
            <div className="d-dialog-foot is-split">
              <button type="button" className="d-quiet-btn" disabled={busy} onClick={() => close(() => { onClose(); onMove(person); })}>{NAMES[list].move}</button>
              <button type="button" className="d-danger-link" disabled={busy} onClick={() => remove(close)}>Remove from the site</button>
            </div>
          )}
        </form>
      )}
    </Dialog>
  );
}

function PhotoPicker({ list, photos, thumbnails, selected, checkDrive, local, uploadName, onPhotos, onPick, onBack }: {
  list: RosterList; photos: LibraryPhoto[]; thumbnails: Record<string, string>; selected: string | null; checkDrive: boolean; local: boolean; uploadName: string;
  onPhotos: (photos: LibraryPhoto[], thumbnails?: Record<string, string>) => void; onPick: (photo: ExecPhoto | null) => void; onBack: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(checkDrive);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  // Opening the picker checks Drive for photos added there since the last look.
  useEffect(() => {
    if (!checkDrive) return;
    let live = true;
    refreshExecPhotosAction().catch(() => FAILED).then((result) => {
      if (!live) return;
      setChecking(false);
      if (result.ok) onPhotos(result.value.photos, result.value.thumbnails);
      else setError(result.error);
    });
    return () => { live = false; };
    // Runs once, when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const base = uploadName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || file.name.replace(/\.[^.]+$/, "");
      const form = new FormData();
      form.set("file", await shrinkImage(file, base));
      form.set("list", list);
      const result = await uploadExecPhotoAction(form).catch(() => FAILED);
      if (!result.ok) return setError(result.error);
      onPhotos([result.value, ...photos.filter((p) => p.id !== result.value.id)]);
      onPick(result.value);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : FAILED.error);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="d-dialog-form">
      <p className="d-muted d-picker-note">
        {local ? "Local mode has no Google, so there are no photos to pick." : `Photos come from the MIT CSC › Website › Exec Photos folder in Drive. Each photo on the site is kept in its person’s Active or Alumni folder, and moves with them. An upload goes into the ${list === "alumni" ? "Alumni" : "Active"} folder.`}
      </p>
      <div className="d-picker-bar">
        <button type="button" className="d-chip-btn" onClick={onBack}>Back</button>
        {!local && (
          <>
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} />
            <button type="button" className="m-btn is-small" disabled={uploading} onClick={() => input.current?.click()}>
              <Icon name="upload" size={16} />{uploading ? "Uploading…" : "Upload photo"}
            </button>
          </>
        )}
      </div>
      {checking && <p className="d-photos-hint" role="status">Checking Drive for new photos…</p>}
      {error && <p className="m-error" role="alert">{error}</p>}
      <ul className="d-photo-grid is-picker">
        <li className={`d-photo${selected === null ? " is-selected" : ""}`}>
          <button type="button" className="d-photo-pick d-photo-none" aria-pressed={selected === null} onClick={() => onPick(null)}>No photo</button>
          <div className="d-photo-foot"><span className="d-photo-name">No photo</span></div>
        </li>
        {photos.map((photo) => (
          <li key={photo.id} className={`d-photo${selected === photo.id ? " is-selected" : ""}`}>
            <button type="button" className="d-photo-pick" aria-pressed={selected === photo.id} aria-label={`Use ${photo.name}`} onClick={() => onPick(photo)}>
              <PhotoImage photo={photo} thumbnails={thumbnails} sizes="(max-width: 640px) 45vw, 160px" />
            </button>
            <div className="d-photo-foot"><span className="d-photo-name" title={photo.name}>{photo.name}</span></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
