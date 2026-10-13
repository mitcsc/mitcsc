"use client";

import { useEffect, useState } from "react";
import { browseDrive, makeFolder, type DriveListing } from "@/app/dashboard/actions";
import { Icon } from "@/components/membership/icons";
import Dialog from "./Dialog";

export interface DriveChoice {
  id: string;
  path: string[];
}

// Browses the club account's Drive. Picks a folder, or a spreadsheet when `pick` is "sheet".
export default function DrivePicker({ title, start, pick, onPick, onClose }: {
  title: string; start: string; pick: "folder" | "sheet"; onPick: (choice: DriveChoice) => void; onClose: () => void;
}) {
  const [folder, setFolder] = useState(start || "root");
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [error, setError] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    setListing(null);
    setError("");
    browseDrive(folder, pick === "sheet").then((result) => {
      if (!current) return;
      if (result.ok) setListing(result.value);
      else setError(result.error);
    });
    return () => { current = false; };
  }, [folder, pick]);

  async function createFolder() {
    if (!naming?.trim()) return;
    setBusy(true);
    const result = await makeFolder(naming, folder);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setNaming(null);
    setFolder(result.value.id);
  }

  const path = listing?.path || [];
  return (
    <Dialog title={title} onClose={onClose} wide>
      <nav className="d-crumbs" aria-label="Folder">
        {!path.length ? (
          <span className="d-crumb-roots">
            <button type="button" onClick={() => setFolder("root")} aria-current={folder !== "shared" ? "page" : undefined}>My Drive</button>
            <button type="button" onClick={() => setFolder("shared")} aria-current={folder === "shared" ? "page" : undefined}>Shared with me</button>
          </span>
        ) : (
          <button type="button" onClick={() => setFolder("root")}>My Drive</button>
        )}
        {path.map((p, i) => (
          <span key={p.id}>
            <span className="d-crumb-sep" aria-hidden="true">/</span>
            <button type="button" onClick={() => setFolder(p.id)} aria-current={i === path.length - 1 ? "page" : undefined}>{p.name}</button>
          </span>
        ))}
      </nav>
      {error && <p className="m-error" role="alert">{error}</p>}
      <ul className="d-drive-list" aria-busy={!listing}>
        {!listing && !error && <li className="d-drive-empty">Loading…</li>}
        {listing && listing.items.length === 0 && <li className="d-drive-empty">{pick === "sheet" ? "No folders or sheets here." : "No folders here."}</li>}
        {listing?.items.map((item) => (
          <li key={item.id}>
            {item.kind === "folder" ? (
              <button type="button" onClick={() => setFolder(item.id)}>
                <Icon name="folder" />
                <span>{item.name}</span>
                <Icon name="right" className="d-drive-go" />
              </button>
            ) : (
              <button type="button" onClick={() => onPick({ id: item.id, path: [...path.map((p) => p.name), item.name] })}>
                <Icon name="sheet" />
                <span>{item.name}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
      {naming !== null && (
        <form className="d-new-folder" onSubmit={(e) => { e.preventDefault(); createFolder(); }}>
          <input className="m-input is-compact" aria-label="Folder name" placeholder="Folder name" value={naming} autoFocus onChange={(e) => setNaming(e.target.value)} />
          <button type="submit" className="m-btn is-light is-medium" disabled={busy || !naming.trim()}>Create</button>
        </form>
      )}
      <div className="d-dialog-foot">
        {naming === null && folder !== "shared" && <button type="button" className="d-chip-btn" onClick={() => setNaming("")}>New folder</button>}
        <span className="d-spacer" />
        <button type="button" className="m-btn is-outline is-medium" onClick={onClose}>Cancel</button>
        {pick === "folder" && (
          <button type="button" className="m-btn is-medium" disabled={!listing || folder === "shared"} onClick={() => onPick({ id: folder, path: path.map((p) => p.name) })}>Save here</button>
        )}
      </div>
    </Dialog>
  );
}
