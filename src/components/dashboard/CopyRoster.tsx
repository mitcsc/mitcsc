"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { copyRosterAction } from "@/app/dashboard/exec/actions";

const FAILED = { ok: false as const, error: "Something went wrong. Please try again." };

// Shown until the people in the website code are copied into the dashboard. It runs once.
export default function CopyRoster({ local }: { local: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function copy() {
    setBusy(true);
    setError("");
    const result = await copyRosterAction().catch(() => FAILED);
    if (!result.ok) {
      setBusy(false);
      return setError(result.error);
    }
    router.refresh();
  }

  return (
    <main className="d-empty">
      <h1 className="d-empty-title">Edit the exec here</h1>
      <p className="d-muted">
        The Exec and Alumni pages still show the people in the website code. Copy them here once, in the same order, to edit them from the dashboard.
        {local ? " Local mode has no Google, so they come without photos." : " Their photos go into the MIT CSC › Website › Exec Photos folder in Drive. This takes up to a minute."}
      </p>
      {error && <p className="m-error" role="alert">{error}</p>}
      <button type="button" className="m-btn is-medium" disabled={busy} onClick={() => void copy()}>{busy ? "Copying…" : "Copy from the website"}</button>
    </main>
  );
}
