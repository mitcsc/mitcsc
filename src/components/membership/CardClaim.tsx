"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { emailMyCard } from "@/app/join/actions";
import { CLUB_EMAIL } from "@/lib/membership/config";
import WalletButtons from "./WalletButtons";

const FAILED = { ok: false as const, error: "Something went wrong. Please try again." };

function Email() {
  return <a href={`mailto:${CLUB_EMAIL}`}>{CLUB_EMAIL}</a>;
}

// /join/pass: members get a one-time link at kerb@mit.edu, and the link opens their card in that browser.
export default function CardClaim({ year, link, deadLink, buttons, kerb: initialKerb }: {
  year: string | null; link: string | null; deadLink: boolean; buttons: ("apple" | "google")[]; kerb: string;
}) {
  const [kerb, setKerb] = useState(initialKerb);
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await emailMyCard(kerb).catch(() => FAILED);
    setBusy(false);
    if (result.ok) setSentTo(result.value.email);
    else setError(result.error);
  }

  const showLink = !!link;
  return (
    <main className="m-root mp-center">
      <div className="mp-center-body mp-card">
        <Image src="/img/logo/logo-with-panda.png" alt="CSC at MIT" width={88} height={88} className="mp-logo" priority />
        {showLink ? (
          <>
            <h1 className="mp-title">Add to your digital wallet</h1>
            <p className="mp-muted">Your {year ? `${year} ` : ""}MIT CSC membership card is ready. Tap below to add it.</p>
            <div className="mp-card-action">
              <WalletButtons wallet={{ buttons, problem: null }} link={link} />
            </div>
          </>
        ) : sentTo ? (
          <div className="mp-card-sent" role="status">
            <h1 className="mp-title">Check your email</h1>
            <p className="mp-muted">We sent a link to <strong className="mp-strong">{sentTo}</strong>. It works once and expires in 15 minutes.</p>
            <button type="button" className="mp-soft-link" onClick={() => setSentTo("")}>Use a different kerb</button>
          </div>
        ) : (
          <>
            <h1 className="mp-title">Add to your digital wallet</h1>
            {deadLink
              ? <p className="m-error" role="alert">This link was already used or has expired. Get a new one below.</p>
              : <p className="mp-muted">You’ll receive a link in your email to add the pass to your digital wallet.</p>}
            <form className="mp-form mp-card-form" onSubmit={send}>
              <div className="m-field">
                <label htmlFor="card-kerb" className="m-label">Kerberos</label>
                <div className={`mp-kerb${error ? " is-invalid" : ""}`}>
                  <input
                    id="card-kerb" name="kerb" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required
                    value={kerb} onChange={(e) => setKerb(e.target.value)} aria-invalid={!!error || undefined} aria-describedby={error ? "card-error" : undefined}
                  />
                  <span>@mit.edu</span>
                </div>
              </div>
              {error && <p id="card-error" className="m-error" role="alert">{error}</p>}
              <div className="mp-card-buttons">
                <button type="submit" className="m-btn is-block" disabled={busy}>{busy ? "Sending…" : "Email my card link"}</button>
                <Link href="/join" className="m-btn is-outline is-block">Not a member yet? Sign up</Link>
              </div>
            </form>
          </>
        )}
      </div>
      <p className="mp-footnote"><span>Questions? <Email /></span></p>
    </main>
  );
}
