"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { setHomePhotos } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import { photoUrl, sizedThumbnail, type HomePhoto } from "@/lib/home-photo-urls";
import { Switch, Toast } from "./MembersView";
import PathText from "./PathText";

type Filter = "all" | "on" | "off" | "failed";

// The home page shows up to 16 photos at once, on tall tablets.
const FULL_HERO = 16;

const THUMB_WIDTHS = [256, 384, 512];

// failures maps a photo id to why the home page could not load it. missing lists photos that are on but left the folder.
export default function PhotoLibraryView({ photos, thumbnails, failures, missing, shown: initialShown, folder, folderPath, problem }: {
  photos: HomePhoto[];
  thumbnails: Record<string, string>;
  failures: Record<string, string>;
  missing: HomePhoto[];
  shown: string[];
  folder: string | null;
  folderPath: string[];
  problem: string | null;
}) {
  const [shown, setShown] = useState(() => new Set(initialShown));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // Previews that failed in this browser, with the reason.
  const [broken, setBroken] = useState<Record<string, string>>({});
  const clearNotice = useCallback(() => setNotice(""), []);

  const failed: Record<string, string> = { ...broken, ...failures };
  const failedCount = photos.filter((p) => failed[p.id]).length;
  const gone = missing.filter((p) => shown.has(p.id));
  const onCount = photos.filter((p) => shown.has(p.id)).length;
  const visible = photos.filter((p) => {
    if (filter === "failed") return !!failed[p.id];
    return filter === "all" || (filter === "on") === shown.has(p.id);
  });

  // Ctrl+A or Cmd+A selects every photo in view, and Escape clears the selection, unless a text field has focus.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest("input:not([type=checkbox]), textarea, select, [contenteditable=true]")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(new Set(visible.map((p) => p.id)));
      } else if (event.key === "Escape") {
        setSelected(new Set());
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible]);

  // Click, Ctrl-click, or Cmd-click adds or removes one photo. Shift-click selects every photo between it and the last one clicked.
  function pick(event: MouseEvent, id: string) {
    const next = new Set(selected);
    const ids = visible.map((p) => p.id);
    const from = anchor ? ids.indexOf(anchor) : -1;
    if (event.shiftKey && from >= 0) {
      const to = ids.indexOf(id);
      for (const between of ids.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(between);
    } else if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
    setAnchor(id);
  }

  async function apply(ids: string[], on: boolean) {
    const before = shown;
    const after = new Set(shown);
    for (const id of ids) {
      if (on) after.add(id);
      else after.delete(id);
    }
    setShown(after);
    setBusy(true);
    const result = await setHomePhotos(ids, on).catch(() => ({ ok: false as const, error: "Could not save. Check your connection." }));
    setBusy(false);
    if (!result.ok) {
      setShown(before);
      setNotice(result.error);
      return false;
    }
    setShown(new Set(result.value));
    return true;
  }

  async function applySelected(on: boolean) {
    const ids = [...selected];
    if (!(await apply(ids, on))) return;
    setSelected(new Set());
    setNotice(`${on ? "Turned on" : "Turned off"} ${ids.length} ${ids.length === 1 ? "photo" : "photos"}.`);
  }

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  return (
    <main className="d-page d-photos">
      <div className="d-section-head">
        <h1 className="d-h2">Home page photos</h1>
        {folder && <a className="d-chip-btn" href={folder} target="_blank" rel="noreferrer">Open folder in Drive</a>}
      </div>
      <p className="d-section-note">
        Photos come from the <PathText path={["MIT CSC", ...folderPath]} /> folder in Drive. Turn on the ones you want on the home page. Each visit shows a random set of them.
      </p>
      {problem && <p className="m-error" role="alert">{problem}</p>}
      {photos.length > 0 && onCount === 0 && <p className="d-photos-hint">No photos are currently active, so the home page is showing fallback photos.</p>}
      {onCount > 0 && onCount < FULL_HERO && <p className="d-photos-hint">Turn on at least {FULL_HERO} photos so the home page fills on every screen size.</p>}

      {gone.length > 0 && (
        <div className="d-photos-alert" role="alert">
          <Icon name="alert" size={18} />
          <div>
            <p>
              {gone.length === 1 ? "1 photo that is on is" : `${gone.length} photos that are on are`} no longer in the Drive folder, so the home page skips {gone.length === 1 ? "it" : "them"}:{" "}
              <span className="d-photos-alert-names">{gone.map((p) => p.name).join(", ")}</span>
            </p>
            <button type="button" className="d-chip-btn" disabled={busy} onClick={async () => {
              if (await apply(gone.map((p) => p.id), false)) setNotice(`Turned off ${gone.length} missing ${gone.length === 1 ? "photo" : "photos"}.`);
            }}>Turn {gone.length === 1 ? "it" : "them"} off</button>
          </div>
        </div>
      )}
      {failedCount > 0 && (
        <div className="d-photos-alert" role="alert">
          <Icon name="alert" size={18} />
          <div>
            <p>{failedCount === 1 ? "1 photo" : `${failedCount} photos`} could not load from Drive. Visitors don’t see {failedCount === 1 ? "it" : "them"}.</p>
            {filter !== "failed" && <button type="button" className="d-chip-btn" onClick={() => { setFilter("failed"); setSelected(new Set()); setAnchor(null); }}>Show {failedCount === 1 ? "it" : "them"}</button>}
          </div>
        </div>
      )}

      {!folder && !problem && (
        <p className="d-empty-row">No folder found. Create <PathText path={["MIT CSC", ...folderPath]} /> in Drive.</p>
      )}
      {folder && photos.length === 0 && <p className="d-empty-row">No photos in the folder yet. Add some in Drive, then come back to this page.</p>}

      {photos.length > 0 && (
        <>
          <div className="d-photos-bar">
            <div role="tablist" aria-label="Filter" className="d-filters">
              {([["all", `All ${photos.length}`], ["on", `On ${onCount}`], ["off", `Off ${photos.length - onCount}`], ...(failedCount || filter === "failed" ? [["failed", `Failed ${failedCount}`] as const] : [])] as const).map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => { setFilter(key); setSelected(new Set()); setAnchor(null); }}>{label}</button>
              ))}
            </div>
            <div className="d-photos-actions">
              {selected.size > 0 && (
                <>
                  <span className="d-photos-count">{selected.size} selected</span>
                  <button type="button" className="d-chip-btn" onClick={() => applySelected(true)} disabled={busy}>Turn on</button>
                  <button type="button" className="d-chip-btn" onClick={() => applySelected(false)} disabled={busy}>Turn off</button>
                </>
              )}
              {!allVisibleSelected && <button type="button" className="d-text-btn" title="Ctrl+A or ⌘A" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>Select all</button>}
              {selected.size > 0 && <button type="button" className="d-text-btn" onClick={() => setSelected(new Set())}>Clear</button>}
            </div>
          </div>

          <ul className={`d-photo-grid${selected.size ? " is-selecting" : ""}`}>
            {visible.map((photo) => {
              const on = shown.has(photo.id);
              const isSelected = selected.has(photo.id);
              const failure = failed[photo.id];
              // Straight from Google when a fresh link is at hand, which spares a server request per photo.
              const link = thumbnails[photo.id];
              const src = (width: number) => (link ? sizedThumbnail(link, width) : photoUrl(photo, width));
              return (
                <li key={photo.id} className={`d-photo${isSelected ? " is-selected" : ""}${on ? "" : " is-off"}${failure ? " is-failed" : ""}`}>
                  <button type="button" className="d-photo-pick" aria-pressed={isSelected} aria-label={`Select ${photo.name}`} onClick={(e) => pick(e, photo.id)}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- already resized by Google */}
                    <img
                      src={src(384)}
                      srcSet={THUMB_WIDTHS.map((w) => `${src(w)} ${w}w`).join(", ")}
                      sizes="(max-width: 640px) 50vw, 240px"
                      alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
                      onError={() => setBroken((b) => ({ ...b, [photo.id]: "Drive could not show a preview of this photo." }))}
                    />
                    {failure && <span className="d-photo-failed" title={failure}><Icon name="alert" size={14} />Couldn’t load</span>}
                    <span className="d-photo-check" aria-hidden><Icon name="check" size={14} strokeWidth={2.6} /></span>
                  </button>
                  <div className="d-photo-foot">
                    <span className="d-photo-name" title={photo.name}>{photo.name}</span>
                    <Switch checked={on} label={`Show ${photo.name} on the home page`} onChange={(value) => apply([photo.id], value)} />
                  </div>
                </li>
              );
            })}
          </ul>
          {visible.length === 0 && <p className="d-empty-row">{{ all: "", on: "No photos are on.", off: "Every photo is on.", failed: "Every photo loads." }[filter]}</p>}
        </>
      )}
      <Toast message={notice} onDone={clearNotice} />
    </main>
  );
}
