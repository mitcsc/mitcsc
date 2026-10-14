"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { importFormSignups, importPastMembers, removePastMembers, updateSettings, type SettingsPatch } from "@/app/dashboard/actions";
import { CLUB_DRIVE_FOLDER, formatStamp } from "@/lib/membership/config";
import type { PastSheet, YearConfig } from "@/lib/membership/types";
import DrivePicker from "./DrivePicker";
import { shortEmail } from "./format";
import { Switch } from "./MembersView";
import { useSave } from "./Shell";

export function Setting({ title, note, children, center = false }: { title: string; note: string; children: React.ReactNode; center?: boolean }) {
  return (
    <section className="d-setting">
      <div className="d-setting-head">
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      <div className={`d-setting-body${center ? " is-center" : ""}`}>{children}</div>
    </section>
  );
}

// Every field saves on its own: switches and checkboxes right away, text when the field loses focus.
export default function YearSettings({ config, nextYear, connected, past }: {
  config: YearConfig; nextYear: string | null; connected: boolean; past: Past;
}) {
  const router = useRouter();
  const save = useSave();
  const [values, setValues] = useState({
    signupsOpen: config.signupsOpen,
    closesOn: config.closesOn || "",
    walletExpiresOn: config.walletExpiresOn,
    priceNew: String(config.prices.new),
    priceReturning: String(config.prices.returning),
    venmo: `@${config.venmo}`,
    zelle: config.zelle,
    cashAllowed: config.cashAllowed,
  });
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function commit(patch: SettingsPatch) {
    const result = await save(() => updateSettings(patch));
    if (result.ok) router.refresh();
  }
  const prices = () => {
    const next = { new: Number(values.priceNew), returning: Number(values.priceReturning) };
    if (next.new !== config.prices.new || next.returning !== config.prices.returning) commit({ prices: next });
  };

  return (
    <main className="d-settings">
      <Setting title="Signups" note="Open or close the signup page, and choose when this year's cards stop working.">
        <div className="d-toggle-row">
          <div>
            <span className="d-toggle-title">Accepting signups</span>
            <span className="d-toggle-note">{values.signupsOpen ? "The signup page is open at csc.mit.edu/join." : "The signup page says signups are closed."}</span>
          </div>
          <Switch checked={values.signupsOpen} label="Accepting signups" onChange={(open) => { set("signupsOpen", open); commit({ signupsOpen: open }); }} />
        </div>
        <div className="d-field-row">
          <label className="d-field">
            <span className="m-label">Close signups on <span className="m-label-note">Optional</span></span>
            <input type="date" className="m-input is-compact" value={values.closesOn} onChange={(e) => set("closesOn", e.target.value)} onBlur={() => values.closesOn !== (config.closesOn || "") && commit({ closesOn: values.closesOn || null })} />
            <span className="d-field-note">The page closes on its own that night.</span>
          </label>
          <label className="d-field">
            <span className="m-label">Wallet cards expire on</span>
            <input type="date" className="m-input is-compact" value={values.walletExpiresOn} required onChange={(e) => set("walletExpiresOn", e.target.value)} onBlur={() => values.walletExpiresOn && values.walletExpiresOn !== config.walletExpiresOn && commit({ walletExpiresOn: values.walletExpiresOn })} />
            <span className="d-field-note">Cards turn grey in Wallet after this date.</span>
          </label>
        </div>
      </Setting>

      <Setting title="Prices" note="New prices apply to new signups only.">
        <div className="d-field-row is-tight">
          <label className="d-field">
            <span className="m-label">New member</span>
            <MoneyInput value={values.priceNew} onChange={(v) => set("priceNew", v)} onBlur={prices} />
          </label>
          <label className="d-field">
            <span className="m-label">Returning member</span>
            <MoneyInput value={values.priceReturning} onChange={(v) => set("priceReturning", v)} onBlur={prices} />
          </label>
        </div>
        <p className="d-field-note is-large">Returning means the person paid in any past year.</p>
      </Setting>

      <PastMembers past={past} connected={connected} />

      <Setting title="Payment" note="Venmo is checked automatically. Zelle and cash are marked by hand.">
        <div className="d-field-row">
          <label className="d-field">
            <span className="m-label">Venmo</span>
            <input className="m-input is-compact" value={values.venmo} onChange={(e) => set("venmo", e.target.value)} onBlur={() => values.venmo.replace(/^@/, "") !== config.venmo && commit({ venmo: values.venmo })} />
          </label>
          <label className="d-field">
            <span className="m-label">Zelle <span className="m-label-note">Optional</span></span>
            <input className="m-input is-compact" value={values.zelle} placeholder="Phone number or email" onChange={(e) => set("zelle", e.target.value)} onBlur={() => values.zelle !== config.zelle && commit({ zelle: values.zelle })} />
          </label>
        </div>
        <label className="d-check">
          <input type="checkbox" checked={values.cashAllowed} onChange={(e) => { set("cashAllowed", e.target.checked); commit({ cashAllowed: e.target.checked }); }} />
          Allow cash at events
        </label>
      </Setting>

      <FormImport year={config.year} connected={connected} />

      {nextYear && (
        <Setting title="New school year" note="Creates a new sheet and copies these settings." center>
          <Link className="m-btn is-medium" href="/dashboard/membership/new-year">Start {nextYear}</Link>
        </Setting>
      )}
    </main>
  );
}

export function MoneyInput({ value, onChange, onBlur, label }: { value: string; onChange: (v: string) => void; onBlur?: () => void; label?: string }) {
  return (
    <span className="d-money">
      <span aria-hidden="true">$</span>
      <input className="m-input is-compact" inputMode="decimal" value={value} aria-label={label} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} onBlur={onBlur} />
    </span>
  );
}

function rowList(rows: number[]) {
  const shown = rows.slice(0, 8).join(", ");
  return rows.length > 8 ? `${shown}, and ${rows.length - 8} more` : shown;
}

// Members who joined on the old Google Form this year, so they can get their Wallet card.
function FormImport({ year, connected }: { year: string; connected: boolean }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function importSheet(sheetId: string, name: string) {
    setPicking(false);
    setBusy(true);
    setMessage(null);
    const result = await importFormSignups(sheetId).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: result.error, error: true });
      return;
    }
    const { added, existing, unreadable } = result.value;
    const parts = added
      ? [`Added ${added === 1 ? "1 member" : `${added} members`} from “${name}” as paid.`, ...(existing ? [`${existing === 1 ? "1 was" : `${existing} were`} already signed up.`] : [])]
      : [`Everyone on “${name}” was already signed up.`];
    if (unreadable.length) parts.push(`Couldn’t read the kerb on ${unreadable.length === 1 ? "row" : "rows"} ${rowList(unreadable)}.`);
    setMessage({ text: parts.join(" "), error: false });
    router.refresh();
  }

  return (
    <Setting title="Google Form signups" note={`Adds people who joined on the old Google Form for ${year}, so they can get their Wallet card.`}>
      <div className="d-inline-actions">
        <button type="button" className="d-chip-btn" onClick={() => setPicking(true)} disabled={!connected || busy}>
          {busy ? "Reading the sheet…" : "Import from the form’s sheet"}
        </button>
        {!connected && <span className="d-field-note">Connect the club Google account first.</span>}
      </div>
      <p className="d-field-note">Reads the name, Kerberos, year, and dorm columns on the first tab, and marks everyone paid. Running it again skips people already added. The sheet must be in the “{CLUB_DRIVE_FOLDER}” folder.</p>
      {message && <p className={message.error ? "m-error" : "d-success"} role="status">{message.text}</p>}
      {picking && (
        <DrivePicker title="Pick the Google Form’s response sheet" pick="sheet" onClose={() => setPicking(false)} onPick={(choice) => importSheet(choice.id, choice.path.at(-1) || "the sheet")} />
      )}
    </Setting>
  );
}

// Old membership sheets whose kerbs get the returning price. Payments on this site count on their own.
type Past = { earlier: number; thisYear: number; sheets: PastSheet[] };

function PastMembers({ past, connected }: { past: Past; connected: boolean }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function importSheet(sheetId: string, name: string) {
    setPicking(false);
    setBusy("import");
    setMessage(null);
    const result = await importPastMembers(sheetId).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(null);
    setMessage(result.ok ? { text: `Read ${result.value.found} kerbs from “${name}”.`, error: false } : { text: result.error, error: true });
    router.refresh();
  }

  async function remove(sheet: PastSheet) {
    const people = sheet.count === 1 ? "1 person" : `${sheet.count} people`;
    if (!window.confirm(`Remove “${sheet.name}”? Its ${people} lose the returning price, unless they’re on another sheet or paid on this site.`)) return;
    setBusy(sheet.id);
    setMessage(null);
    const result = await removePastMembers(sheet.id).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again." }));
    setBusy(null);
    if (!result.ok) setMessage({ text: result.error, error: true });
    router.refresh();
  }

  return (
    <Setting title="Past members" note="People who paid in an earlier year get the returning price. Payments on this site count by themselves, so only years before it need a sheet.">
      <p className="d-field-note is-large">
        {past.earlier === 1 ? "1 person from an earlier year gets" : `${past.earlier} people from earlier years get`} the returning price.
        {past.thisYear > 0 && ` This year’s ${past.thisYear === 1 ? "new paid member gets" : `${past.thisYear} new paid members get`} it starting next year.`}
      </p>
      {past.sheets.length > 0 && (
        <ul className="d-sheet-list">
          {past.sheets.map((sheet) => (
            <li key={sheet.id}>
              <span className="d-sheet-main">
                {sheet.id === "earlier"
                  ? <span className="d-sheet-name">{sheet.name}</span>
                  : <a className="d-sheet-name" href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheet.id)}/edit`} target="_blank" rel="noreferrer">{sheet.name}</a>}
                <span className="d-sheet-meta">
                  {sheet.count === 1 ? "1 kerb" : `${sheet.count} kerbs`}
                  {" · "}
                  {sheet.importedAt ? `Imported ${formatStamp(sheet.importedAt)}${sheet.importedBy ? ` by ${shortEmail(sheet.importedBy)}` : ""}` : "Imported before sheets were listed"}
                </span>
              </span>
              <button type="button" className="d-text-btn" onClick={() => remove(sheet)} disabled={busy !== null}>
                {busy === sheet.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="d-inline-actions">
        <button type="button" className="d-chip-btn" onClick={() => setPicking(true)} disabled={!connected || busy !== null}>
          {busy === "import" ? "Reading the sheet…" : "Import an old sheet"}
        </button>
        {!connected && <span className="d-field-note">Connect the club Google account first.</span>}
      </div>
      <p className="d-field-note">Reads the Kerberos or email column on the sheet’s first tab. Importing a sheet again updates it. The sheet must be in the “{CLUB_DRIVE_FOLDER}” folder.</p>
      {message && <p className={message.error ? "m-error" : "d-success"} role="status">{message.text}</p>}
      {picking && (
        <DrivePicker title="Pick an old membership sheet" pick="sheet" onClose={() => setPicking(false)} onPick={(choice) => importSheet(choice.id, choice.path.at(-1) || "the sheet")} />
      )}
    </Setting>
  );
}
