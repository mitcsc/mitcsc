"use client";

import { useCallback, useState, type MouseEvent } from "react";
import { setHomePhotos } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import { photoUrl, sizedThumbnail, type HomePhoto } from "@/lib/home-photo-urls";
import { Switch, Toast } from "./MembersView";

type Filter = "all" | "on" | "off";

// The home page shows up to 16 photos at once, on tall tablets.
const FULL_HERO = 16;

const THUMB_WIDTHS = [256, 384, 512];

export default function PhotoLibraryView({ photos, thumbnails, shown: initialShown, folder, folderPath, problem }: {
  photos: HomePhoto[];
  thumbnails: Record<string, string>;
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
  const clearNotice = useCallback(() => setNotice(""), []);

  const onCount = photos.filter((p) => shown.has(p.id)).length;
  const visible = photos.filter((p) => filter === "all" || (filter === "on") === shown.has(p.id));
  const folderName = folderPath.at(-1);

  // Click selects one photo. Shift-click selects every photo between it and the last one clicked.
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
        Photos come from the “{folderName}” folder in Drive ({["MIT CSC", ...folderPath].join(" › ")}). Turn on the ones you want on the home page. Each visit shows a random set of them.
      </p>
      {problem && <p className="m-error" role="alert">{problem}</p>}
      {photos.length > 0 && onCount === 0 && <p className="d-photos-hint">No photos are on, so the home page shows its built-in photos.</p>}
      {onCount > 0 && onCount < FULL_HERO && <p className="d-photos-hint">Turn on at least {FULL_HERO} photos so the home page fills on every screen size.</p>}

      {!folder && !problem && (
        <p className="d-empty-row">No “{folderName}” folder found. Make it in Drive at {["MIT CSC", ...folderPath].join(" › ")}.</p>
      )}
      {folder && photos.length === 0 && <p className="d-empty-row">No photos in the folder yet. Add some in Drive, then come back to this page.</p>}

      {photos.length > 0 && (
        <>
          <div className="d-photos-bar">
            <div role="tablist" aria-label="Filter" className="d-filters">
              {([["all", `All ${photos.length}`], ["on", `On ${onCount}`], ["off", `Off ${photos.length - onCount}`]] as const).map(([key, label]) => (
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
              {!allVisibleSelected && <button type="button" className="d-text-btn" onClick={() => setSelected(new Set(visible.map((p) => p.id)))}>Select all</button>}
              {selected.size > 0 && <button type="button" className="d-text-btn" onClick={() => setSelected(new Set())}>Clear</button>}
            </div>
          </div>

          <ul className={`d-photo-grid${selected.size ? " is-selecting" : ""}`}>
            {visible.map((photo) => {
              const on = shown.has(photo.id);
              const isSelected = selected.has(photo.id);
              // Straight from Google when a fresh link is at hand, which spares a server request per photo.
              const link = thumbnails[photo.id];
              const src = (width: number) => (link ? sizedThumbnail(link, width) : photoUrl(photo, width));
              return (
                <li key={photo.id} className={`d-photo${isSelected ? " is-selected" : ""}${on ? "" : " is-off"}`}>
                  <button type="button" className="d-photo-pick" aria-pressed={isSelected} aria-label={`Select ${photo.name}`} onClick={(e) => pick(e, photo.id)}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- already resized by Google */}
                    <img
                      src={src(384)}
                      srcSet={THUMB_WIDTHS.map((w) => `${src(w)} ${w}w`).join(", ")}
                      sizes="(max-width: 640px) 50vw, 240px"
                      alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
                    />
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
          {visible.length === 0 && <p className="d-empty-row">{filter === "on" ? "No photos are on." : "Every photo is on."}</p>}
        </>
      )}
      <Toast message={notice} onDone={clearNotice} />
    </main>
  );
}
