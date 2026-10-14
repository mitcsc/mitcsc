"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { lookUpKerb, refreshStatus, reportPayment, signUp, type KerbStatus } from "@/app/join/actions";
import WaitingPanda from "@/components/voting/WaitingPanda";
import { CLUB_EMAIL, formTitle, isKerb, money, normalizeKerb, questionOptions, venmoNote } from "@/lib/membership/config";
import type { MemberView } from "@/lib/membership/members";
import type { FormConfig, PaymentMethod, Question } from "@/lib/membership/types";
import CardButton from "./CardButton";
import { Icon } from "./icons";
import WalletButtons, { type WalletInfo } from "./WalletButtons";

export interface PublicYear {
  year: string;
  open: boolean;
  prices: { new: number; returning: number };
  venmo: string;
  zelle: string;
  cashAllowed: boolean;
  form: FormConfig;
  wallet: boolean;
}

interface VenmoInfo {
  kerb: string;
  url: string;
  qr: string;
}

type Step = "form" | "pay" | "status";

const METHOD_NAMES: Record<PaymentMethod, string> = { venmo: "Venmo", zelle: "Zelle", cash: "cash" };
const POLL_MS = 8000;
const POLL_TIMES = 15;

function Email() {
  return <a href={`mailto:${CLUB_EMAIL}`}>{CLUB_EMAIL}</a>;
}

export default function MembershipFlow({ year, member: initial, venmo, wallet }: { year: PublicYear | null; member: MemberView | null; venmo: VenmoInfo | null; wallet: WalletInfo }) {
  const [member, setMember] = useState(initial);
  const [step, setStep] = useState<Step>(() => firstStep(initial));
  // "See your signup" loads this browser's signup into the open page.
  const [loaded, setLoaded] = useState(initial?.kerb);
  if (initial?.kerb !== loaded) {
    setLoaded(initial?.kerb);
    if (initial && !member) {
      setMember(initial);
      setStep(firstStep(initial));
    }
  }

  if (!year || (!member && !year.open)) return <Closed year={year?.year} cards={year?.wallet ? wallet.buttons : null} />;
  if (!member || step === "form") {
    return <SignupForm year={year} member={member} cards={year.wallet ? wallet.buttons : null} onDone={(view) => { setMember(view); setStep("pay"); }} />;
  }
  if (step === "pay") {
    return (
      <PayScreen
        year={year}
        member={member}
        venmo={venmo?.kerb === member.kerb ? venmo : null}
        onBack={year.open ? () => setStep("form") : null}
        onReported={(view) => { setMember(view); setStep("status"); }}
      />
    );
  }
  return <StatusScreen year={year} member={member} wallet={wallet} onChange={setMember} onPayAgain={() => setStep("pay")} />;
}

function firstStep(member: MemberView | null): Step {
  return !member ? "form" : member.status === "paid" || member.reported ? "status" : "pay";
}

// cards: the wallets to offer, or null when membership cards are not set up.
function Closed({ year, cards }: { year?: string; cards: WalletInfo["buttons"] | null }) {
  return (
    <main className="m-root mp-center">
      <div className="mp-center-body">
        <Image src="/img/logo/logo-with-panda.png" alt="CSC at MIT" width={88} height={88} className="mp-logo" priority />
        <h1 className="mp-title">Signups are closed</h1>
        <p className="mp-muted">{year ? `Membership signups for ${year} are closed right now.` : "Membership signups are not open yet."} Check back soon.</p>
        {cards && <CardButton wallets={cards} />}
      </div>
      <p className="mp-footnote">Questions? <Email /></p>
    </main>
  );
}

// The signup form

function initialAnswers(form: FormConfig, year: string, member: MemberView | null) {
  const answers: Record<string, string | string[]> = {};
  const other: Record<string, string> = {};
  if (!member) return { answers, other };
  for (const q of form.questions) {
    if (q.builtin === "kerb") answers[q.id] = member.kerb;
    else if (q.builtin === "name") answers[q.id] = member.name;
    else if (q.builtin === "classYear" || q.builtin === "dorm") {
      const value = q.builtin === "classYear" ? member.classYear : member.dorm;
      if (questionOptions(q, year).includes(value)) answers[q.id] = value;
      else {
        answers[q.id] = "Other";
        other[q.id] = value;
      }
    } else if (member.answers[q.id] !== undefined) answers[q.id] = member.answers[q.id];
  }
  return { answers, other };
}

function SignupForm({ year, member, cards, onDone }: {
  year: PublicYear; member: MemberView | null; cards: WalletInfo["buttons"] | null; onDone: (view: MemberView) => void;
}) {
  const router = useRouter();
  const [{ answers, other }, setState] = useState(() => initialAnswers(year.form, year.year, member));
  const [lookup, setLookup] = useState<KerbStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lookupId = useRef(0);
  const kerbQuestion = year.form.questions.find((q) => q.builtin === "kerb");
  const kerb = normalizeKerb(String((kerbQuestion && answers[kerbQuestion.id]) || ""));

  useEffect(() => {
    const id = ++lookupId.current;
    if (!isKerb(kerb)) {
      setLookup(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      const result = await lookUpKerb(kerb).catch(() => null);
      if (id === lookupId.current && result?.ok) setLookup(result.value);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [kerb]);

  const setAnswer = (id: string, value: string | string[]) => setState((s) => ({ ...s, answers: { ...s.answers, [id]: value } }));
  const setOther = (id: string, value: string) => setState((s) => ({ ...s, other: { ...s.other, [id]: value } }));
  const taken = lookup?.kerb === kerb && lookup.status === "taken";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (taken) return;
    setBusy(true);
    setError("");
    const result = await signUp({ answers, other, edit: !!member }).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone(result.value);
    // Loads the Venmo QR code, which needs the kerb. The URL keeps this signup on the screen after a reload.
    router.replace("/join?view=signup", { scroll: false });
  }

  const discount = year.prices.new - year.prices.returning;
  return (
    <main className="m-root mp-page">
      <header className="mp-hero">
        <Image src="/img/logo/logo-with-panda.png" alt="CSC at MIT" width={88} height={88} className="mp-logo" priority />
        <h1 className="mp-title is-large">{formTitle(year.form, year.year)}</h1>
        {year.form.intro && <p className="mp-muted">{year.form.intro}</p>}
        {cards && <CardButton wallets={cards} />}
      </header>

      <form className="mp-form" onSubmit={submit}>
        {year.form.questions.map((q) => {
          if (q.builtin === "kerb") {
            return (
              <div className="m-field" key={q.id}>
                <label htmlFor={`q-${q.id}`} className="m-label">{q.label}</label>
                <div className={`mp-kerb${taken ? " is-invalid" : ""}`}>
                  <input
                    id={`q-${q.id}`} name="kerb" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required
                    value={String(answers[q.id] || "")} onChange={(e) => setAnswer(q.id, e.target.value)}
                    aria-invalid={taken || undefined} aria-describedby={taken ? "kerb-note" : undefined}
                  />
                  <span>@mit.edu</span>
                </div>
                {taken && (
                  <div id="kerb-note" role="alert" className="mp-kerb-note">
                    <span className="mp-bad">{kerb} is already signed up for {year.year}.</span>
                    <span className="mp-muted">Is this you? <Link href={`/join/pass?kerb=${encodeURIComponent(kerb)}`}>Get your card by email</Link>. Not you? Email <Email />.</span>
                  </div>
                )}
                {!member && lookup?.kerb === kerb && lookup.status === "yours" && (
                  <p className="m-hint">You already signed up on this device. <Link href="/join?view=signup">{lookup.paying ? "Continue to payment" : "View your confirmation"}</Link></p>
                )}
                {!taken && lookup?.kerb === kerb && lookup.status === "returning" && discount > 0 && (
                  <p className="m-hint">
                    Welcome back, and thanks for being a returning member! Since you’ve been with us before, you pay{" "}
                    <span className="mp-nowrap"><strong className="mp-price-now">{money(year.prices.returning)}</strong> <s className="m-strike">{money(year.prices.new)}</s> for the year.</span>
                  </p>
                )}
              </div>
            );
          }
          return <QuestionField key={q.id} question={q} year={year.year} value={answers[q.id]} other={other[q.id] || ""} onChange={(v) => setAnswer(q.id, v)} onOther={(v) => setOther(q.id, v)} />;
        })}
        {error && <p className="m-error" role="alert">{error}</p>}
        <button type="submit" className="m-btn is-block mp-continue" disabled={busy || taken}>{busy ? "Saving…" : "Continue"}</button>
      </form>

      <p className="mp-footnote">Questions? <Email /></p>
    </main>
  );
}

// The list is drawn twice so the strip can loop; screen readers get the first copy only.
function Benefits({ items }: { items: string[] }) {
  const list = (hidden: boolean) => (
    <ul aria-labelledby={hidden ? undefined : "benefits-title"} aria-hidden={hidden || undefined}>
      {items.map((item, i) => <li key={i}><Icon name="check" size={12} strokeWidth={2.6} />{item}</li>)}
    </ul>
  );
  return (
    <div className="mp-benefits">
      <p id="benefits-title" className="mp-benefits-title">Your membership includes</p>
      <div className="mp-marquee">
        <div className="mp-marquee-track">{list(false)}{list(true)}</div>
      </div>
    </div>
  );
}

function SelectBox({ id, value, options, onChange, label }: { id: string; value: string; options: string[]; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="m-select-wrap">
      <select id={id} className="m-select" value={value} onChange={(e) => onChange(e.target.value)} required aria-label={label}>
        <option value="" disabled>Choose one</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <Icon name="chevron" />
    </div>
  );
}

function QuestionField({ question: q, year, value, other, onChange, onOther }: {
  question: Question; year: string; value: string | string[] | undefined; other: string;
  onChange: (value: string | string[]) => void; onOther: (value: string) => void;
}) {
  const id = `q-${q.id}`;
  const required = q.required || !!q.builtin;
  const label = (
    <span className="m-label">
      {q.type === "checkboxes" || q.type === "multiple" ? <span id={`${id}-label`}>{q.label}</span> : <label htmlFor={id}>{q.label}</label>}
      {!required && <span className="m-label-note">Optional</span>}
    </span>
  );
  const text = typeof value === "string" ? value : "";

  if (q.type === "short") {
    return (
      <div className="m-field">
        {label}
        <input id={id} className="m-input" value={text} onChange={(e) => onChange(e.target.value)} required={required} maxLength={q.builtin === "name" ? 100 : 200} autoComplete={q.builtin === "name" ? "name" : "off"} />
      </div>
    );
  }
  if (q.type === "long") {
    return (
      <div className="m-field">
        {label}
        <textarea id={id} className="m-textarea" rows={3} value={text} onChange={(e) => onChange(e.target.value)} required={required} maxLength={2000} placeholder={q.builtin ? undefined : "Anything you'd like us to know"} />
      </div>
    );
  }
  const options = questionOptions(q, year);
  if (q.type === "dropdown") {
    const otherAllowed = q.builtin === "classYear" || q.builtin === "dorm";
    return (
      <div className="m-field">
        {label}
        <SelectBox
          id={id} value={text} options={options}
          onChange={(v) => {
            onChange(v);
            if (v === "Other") window.requestAnimationFrame(() => document.getElementById(`${id}-other`)?.focus());
          }}
        />
        {otherAllowed && text === "Other" && (
          <input
            id={`${id}-other`} className="m-input is-other" value={other} onChange={(e) => onOther(e.target.value)} required maxLength={60}
            aria-label={q.builtin === "dorm" ? "Dorm or building" : "Your class year"}
            placeholder={q.builtin === "dorm" ? "Dorm or building name" : "Your year, for example 2031 or postdoc"}
          />
        )}
      </div>
    );
  }
  const picked = Array.isArray(value) ? value : [];
  return (
    <div className="m-field" role="group" aria-labelledby={`${id}-label`}>
      {label}
      <div className="mp-choices">
        {options.map((option) => (
          <label key={option} className="mp-choice">
            {q.type === "checkboxes" ? (
              <input type="checkbox" checked={picked.includes(option)} onChange={(e) => onChange(e.target.checked ? [...picked, option] : picked.filter((p) => p !== option))} />
            ) : (
              <input type="radio" name={id} checked={text === option} onChange={() => onChange(option)} required={required} />
            )}
            <span>{option}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// Paying

function PriceHeading({ year, member }: { year: PublicYear; member: MemberView }) {
  const discount = year.prices.new - member.price;
  return (
    <div className="mp-pay-head">
      <h1 className="mp-pay-title">
        Pay {money(member.price)}
        {member.type === "returning" && discount > 0 && <> <s className="m-strike">{money(year.prices.new)}</s></>}
      </h1>
      <p className="mp-pay-who">
        {member.name}
        {member.type === "returning" && discount > 0 && <span className="m-pill is-green">Returning member, {money(discount)} off</span>}
      </p>
      {year.form.benefits.length > 0 && <Benefits items={year.form.benefits} />}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button" className="m-copy" aria-label={copied ? "Copied" : `Copy ${label}`}
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
    </button>
  );
}

function PayScreen({ year, member, venmo, onBack, onReported }: {
  year: PublicYear; member: MemberView; venmo: VenmoInfo | null; onBack: (() => void) | null; onReported: (view: MemberView) => void;
}) {
  const methods = (["venmo", "zelle", "cash"] as const).filter((m) => m === "venmo" || (m === "zelle" ? !!year.zelle : year.cashAllowed));
  const [method, setMethod] = useState<PaymentMethod>(methods.includes(member.method) ? member.method : "venmo");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const note = venmoNote(year.year, member.kerb);
  const amount = `$${member.price.toFixed(2)}`;

  async function report() {
    setBusy(true);
    setError("");
    const result = await reportPayment(method).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(false);
    if (result.ok) onReported(result.value);
    else setError(result.error);
  }

  return (
    <main className="m-root mp-pay">
      <div className="mp-pay-inner">
        <div className={`mp-pay-grid${method === "venmo" && venmo ? " has-qr" : ""}`}>
          <div className="mp-pay-main">
            {onBack && (
              <button type="button" className="m-back" onClick={onBack}>
                <Icon name="back" />
                Back
              </button>
            )}
            <PriceHeading year={year} member={member} />
            {methods.length > 1 && (
              <div role="tablist" aria-label="Payment method" className="m-segments">
                {methods.map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={m === method} onClick={() => setMethod(m)}>
                    {m === "cash" ? "Cash" : METHOD_NAMES[m]}
                  </button>
                ))}
              </div>
            )}
            <div className="mp-details" role="tabpanel">
              <div className="m-rows">
                {method === "venmo" && <div className="m-row"><span>To</span><span className="m-row-value">@{year.venmo}</span></div>}
                {method === "zelle" && <div className="m-row"><span>To</span><span className="m-row-value">{year.zelle}<CopyButton text={year.zelle} label="Zelle recipient" /></span></div>}
                <div className="m-row"><span>Amount</span><span className="m-row-value">{amount}</span></div>
                {method === "venmo" && <div className="m-row"><span>Note</span><span className="m-row-value mp-note-value">{note}</span></div>}
                {method === "zelle" && <div className="m-row"><span>Memo</span><span className="m-row-value mp-note-value">{note}<CopyButton text={note} label="memo" /></span></div>}
              </div>
              {method === "venmo" && <p className="mp-note">Everything is filled in. Keep the note as it is, so we can confirm your payment right away.</p>}
              {method === "zelle" && <p className="mp-note">Send it with Zelle in your bank app. The memo makes it easier to confirm.</p>}
            </div>
            <div className="mp-actions">
              {error && <p className="m-error" role="alert">{error}</p>}
              {method === "venmo" && (
                <>
                  <a className="m-btn is-block mp-open-venmo" href={venmo?.url || `https://venmo.com/${encodeURIComponent(year.venmo)}`}>Open Venmo</a>
                  <button type="button" className="m-btn is-outline is-block mp-paid-venmo" onClick={report} disabled={busy}>{busy ? "Checking…" : "I've paid"}</button>
                </>
              )}
              {method === "zelle" && <button type="button" className="m-btn is-block" onClick={report} disabled={busy}>{busy ? "Saving…" : "I've paid"}</button>}
              {method === "cash" && <button type="button" className="m-btn is-block" onClick={report} disabled={busy}>{busy ? "Saving…" : "I'll pay at an event"}</button>}
            </div>
          </div>
          {/* Stays mounted so the form can slide to the center while the QR code folds away (desktop only). */}
          {venmo && (
            <div className={`mp-qr-slot${method === "venmo" ? " is-shown" : ""}`} aria-hidden={method !== "venmo" || undefined}>
              <aside className="mp-qr">
                <div className="mp-qr-code" dangerouslySetInnerHTML={{ __html: venmo.qr }} />
                <div>
                  <p className="mp-qr-title">Scan with your phone camera</p>
                  <p className="mp-qr-text">Venmo opens with the amount and note already filled in.</p>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

// After paying

function StatusScreen({ year, member, wallet, onChange, onPayAgain }: {
  year: PublicYear; member: MemberView; wallet: WalletInfo; onChange: (view: MemberView) => void; onPayAgain: () => void;
}) {
  const [polls, setPolls] = useState(0);
  const [, startTransition] = useTransition();
  const watching = member.status === "unpaid" && member.method === "venmo" && member.reported && polls < POLL_TIMES;

  useEffect(() => {
    if (!watching) return;
    const timer = window.setTimeout(async () => {
      const result = await refreshStatus().catch(() => null);
      startTransition(() => {
        if (result?.ok) onChange(result.value);
        setPolls((n) => (result?.ok ? n + 1 : POLL_TIMES));
      });
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [watching, polls, onChange]);

  const price = money(member.price);
  const paid = member.status === "paid";
  let message: React.ReactNode;
  if (paid) message = <>Your {price} {METHOD_NAMES[member.paidVia || member.method]} payment came through.<br />See you at the next event.</>;
  else if (member.method === "cash") message = `Bring ${price} in cash to any CSC event. An exec member marks you paid when they check you in.`;
  else if (member.method === "zelle") message = `An exec member will confirm your ${price} Zelle payment within a few days. Nothing else to do.`;
  else if (watching) message = `Checking for your ${price} Venmo payment. This page updates by itself.`;
  else message = `We haven't seen your ${price} Venmo payment yet. An exec member will confirm it within a few days.`;

  const { calendarUrl, instagram } = year.form;
  return (
    <main className="m-root mp-center">
      <div className="mp-center-body">
        <WaitingPanda key={paid ? "paid" : "signed-up"} jumpOnly />
        <h1 className="mp-title">{paid ? "You're a member!" : "You're signed up!"}</h1>
        <p className="mp-muted" aria-live="polite">{message}</p>
        <div className="mp-status-actions">
          {year.wallet && <WalletButtons wallet={wallet} />}
          {calendarUrl && <a className="m-btn is-outline is-block" href={calendarUrl} target="_blank" rel="noreferrer">Add the CSC calendar</a>}
          {paid && instagram && <a className="mp-soft-link" href={`https://instagram.com/${encodeURIComponent(instagram)}`} target="_blank" rel="noreferrer">Follow @{instagram}</a>}
          {!paid && <button type="button" className="mp-soft-link" onClick={onPayAgain}>Pay another way</button>}
        </div>
      </div>
      {!paid && member.method !== "cash" && !watching && <p className="mp-footnote">Still pending after 3 days? Email <Email /></p>}
      {(paid || member.method === "cash" || watching) && <p className="mp-footnote">Questions? Email <Email /></p>}
    </main>
  );
}
