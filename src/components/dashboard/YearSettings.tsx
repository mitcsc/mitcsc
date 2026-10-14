"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { updateSettings, type SettingsPatch } from "@/app/dashboard/actions";
import type { YearConfig } from "@/lib/membership/types";
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
export default function YearSettings({ config, nextYear }: { config: YearConfig; nextYear: string | null }) {
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
