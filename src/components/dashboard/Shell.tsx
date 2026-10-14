"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Icon } from "@/components/membership/icons";
import { SECTIONS, sectionActive, tabActive, type NavTab } from "./nav";

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="d-main-nav">
      {SECTIONS.map((section) => (
        <Link key={section.href} href={section.href} aria-current={sectionActive(pathname, section) ? "page" : undefined}>{section.label}</Link>
      ))}
    </nav>
  );
}

// Phones: one button names the current page and opens a menu of every page.
export function MobileNav({ email }: { email: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  // Following a link closes the menu.
  if (open && openedAt !== pathname) setOpen(false);
  const section = SECTIONS.find((s) => sectionActive(pathname, s));
  const tab = section?.tabs?.find((t) => tabActive(pathname, t));

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  return (
    <div className="d-mobile-nav">
      <button
        type="button" className="d-mobile-nav-btn" aria-expanded={open} aria-controls="d-mobile-menu"
        onClick={() => { setOpenedAt(pathname); setOpen(!open); }}
      >
        <span className="d-mobile-nav-label">
          {section?.label || "Dashboard"}
          {tab && tab !== section?.tabs?.[0] && <span className="d-mobile-nav-sub">{tab.label}</span>}
        </span>
        <Icon name="chevron" size={18} className="d-mobile-nav-icon" />
      </button>
      {open && <div className="d-mobile-backdrop" onClick={() => setOpen(false)} />}
      <nav id="d-mobile-menu" aria-label="Dashboard" className={`d-mobile-menu${open ? " is-open" : ""}`} inert={!open}>
        {/* Each section links to its first tab. Its other tabs sit indented below it. */}
        {SECTIONS.map((s) => {
          const [first, ...rest] = s.tabs || [];
          const current = first ? tabActive(pathname, first) : sectionActive(pathname, s);
          return (
            <div key={s.href} className="d-mobile-group">
              <Link href={s.href} className="d-mobile-top" aria-current={current ? "page" : undefined}>{s.label}</Link>
              {rest.length > 0 && (
                <div className="d-mobile-subs">
                  {rest.map((t) => <Link key={t.href} href={t.href} className="d-mobile-sub" aria-current={tabActive(pathname, t) ? "page" : undefined}>{t.label}</Link>)}
                </div>
              )}
            </div>
          );
        })}
        <div className="d-mobile-account">
          <span>{email}</span>
          <form action="/api/auth/signout" method="post">
            <button type="submit" className="d-mobile-signout"><Icon name="signout" size={16} />Sign out</button>
          </form>
        </div>
      </nav>
    </div>
  );
}

// The autosave status, for the header on phones. Desktop shows it in the sub-tab row.
export function SaveStatus() {
  const status = useContext(SaveContext).status;
  if (status.state === "saving") return <span className="d-save">Saving…</span>;
  if (status.state === "saved") return <span className="d-save"><Icon name="check" size={12} strokeWidth={2.4} />Saved</span>;
  if (status.state === "error") return <span className="d-save is-error" role="alert">{status.message}</span>;
  return null;
}

// Sub-tabs under a main tab, with the save status on the right. A nested tab stays selected on its sub-pages.
export function SubNav({ label, tabs, children }: { label: string; tabs: NavTab[]; children?: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="d-subnav">
      <nav aria-label={label} className="d-sub-tabs">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} aria-current={tabActive(pathname, tab) ? "page" : undefined}>{tab.label}</Link>
        ))}
      </nav>
      <span className="d-subnav-meta">
        <SaveStatus />
        {children}
      </span>
    </div>
  );
}

// Shown in place of the dashboard when nobody is signed in.
export function SignIn() {
  const pathname = usePathname();
  const problem = useSearchParams().get("problem");
  return (
    <main className="m-root d-gate">
      <div className="d-gate-body">
        <Image src="/img/logo/logo-with-panda.png" alt="CSC at MIT" width={88} height={88} className="d-gate-logo" priority />
        {problem && <p className="m-error" role="alert">{problem}</p>}
        <a className="m-btn is-light is-block" href={`/api/auth/google/start?next=${encodeURIComponent(pathname)}`}>Continue with Google</a>
      </div>
    </main>
  );
}

// Messages from the Google sign-in callback, passed as ?problem=.
export function ProblemBanner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const problem = params.get("problem");
  if (!problem) return null;
  return (
    <div className="d-banner" role="alert">
      <span>{problem}</span>
      <button type="button" className="m-copy" aria-label="Dismiss" onClick={() => router.replace(pathname)}><Icon name="close" /></button>
    </div>
  );
}

// Autosave status shared by the settings and form editor pages, and shown in the header on phones.

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };

const SaveContext = createContext<{ status: SaveState; setStatus: (s: SaveState) => void }>({ status: { state: "idle" }, setStatus: () => {} });

export function SaveStatusProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<SaveState>({ state: "idle" });
  const [statusPath, setStatusPath] = useState(pathname);
  // A save status belongs to the page that saved.
  if (statusPath !== pathname) {
    setStatusPath(pathname);
    setStatus({ state: "idle" });
  }
  return <SaveContext.Provider value={{ status, setStatus }}>{children}</SaveContext.Provider>;
}

export function useSave() {
  const { setStatus } = useContext(SaveContext);
  return useCallback(async <T,>(work: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>) => {
    setStatus({ state: "saving" });
    const result = await work().catch(() => ({ ok: false as const, error: "Could not save. Check your connection." }));
    setStatus(result.ok ? { state: "saved" } : { state: "error", message: result.error });
    return result;
  }, [setStatus]);
}
