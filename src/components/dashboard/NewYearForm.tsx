"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createSchoolYear } from "@/app/dashboard/actions";
import DrivePicker, { type DriveChoice } from "./DrivePicker";
import { MoneyInput } from "./YearSettings";

export default function NewYearForm({ year, previous, prices, pastMembers }: {
  year: string; previous: string | null; prices: { new: number; returning: number }; pastMembers: number;
}) {
  const router = useRouter();
  const [folder, setFolder] = useState<DriveChoice | null>(null);
  const [picking, setPicking] = useState(false);
  const [sheetName, setSheetName] = useState(`CSC ${year} Membership`);
  const [priceNew, setPriceNew] = useState(String(prices.new));
  const [priceReturning, setPriceReturning] = useState(String(prices.returning));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!folder) {
      setError("Pick the folder for the membership sheet.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await createSchoolYear({ year, folderId: folder.id, sheetName, prices: { new: Number(priceNew), returning: Number(priceReturning) } })
      .catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    router.push("/dashboard/membership/settings");
    router.refresh();
  }

  return (
    <main className="d-narrow">
      <form className="d-narrow-body" onSubmit={submit}>
        <Image src="/img/logo/logo-with-panda.png" alt="" width={64} height={64} className="d-narrow-logo" />
        <h1 className="d-narrow-title">Start {year}</h1>
        <p className="d-muted">{previous ? `Filled in from ${previous}. ` : ""}Members can’t see it until you open signups.</p>

        <div className="d-narrow-fields">
          <div className="d-field">
            <span className="m-label">Save the sheet in</span>
            <div className="d-location">
              <span className={`d-location-path${folder ? "" : " is-empty"}`}>
                {folder
                  ? (folder.path.length ? folder.path : ["My Drive"]).map((s, i) => <span key={i}>{i > 0 && <span className="d-crumb-sep" aria-hidden="true">/</span>}{s}</span>)
                  : "No folder picked"}
              </span>
              <button type="button" className="d-chip-btn" onClick={() => setPicking(true)}>{folder ? "Change" : "Pick folder"}</button>
            </div>
            <span className="d-field-note">The sheet goes straight into this folder.</span>
          </div>
          <label className="d-field">
            <span className="m-label">Sheet name</span>
            <input className="m-input is-compact" value={sheetName} onChange={(e) => setSheetName(e.target.value)} required maxLength={100} />
          </label>
          <div className="d-field-row is-tight">
            <label className="d-field">
              <span className="m-label">New member</span>
              <MoneyInput value={priceNew} onChange={setPriceNew} />
            </label>
            <label className="d-field">
              <span className="m-label">Returning</span>
              <MoneyInput value={priceReturning} onChange={setPriceReturning} />
            </label>
          </div>
          <p className="d-field-note is-large">
            {pastMembers > 0 ? `${pastMembers} past members get the returning price. ` : "Nobody gets the returning price yet. "}
            {previous ? "Payment details and signup questions carry over. You can change them later in Settings." : "You can set payment details and questions after this."}
          </p>
          {error && <p className="m-error" role="alert">{error}</p>}
        </div>

        <div className="d-narrow-actions">
          <Link className="m-btn is-outline is-medium" href={previous ? "/dashboard/membership/settings" : "/dashboard/membership"}>Back</Link>
          <button type="submit" className="m-btn is-medium" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
        </div>
      </form>
      {picking && (
        <DrivePicker
          title="Save the sheet in" start={folder?.id} pick="folder" onClose={() => setPicking(false)}
          onPick={(choice) => { setFolder(choice); setPicking(false); }}
        />
      )}
    </main>
  );
}
