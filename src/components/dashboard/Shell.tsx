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
        {/* Every page is a link of the same size. A section with tabs shows its name as a small
            label above them, so the label never reads as one more page. Other sections follow
            after a divider. */}
        {menuColumns().map((column, i) => (
          <div key={i} className="d-mobile-column">
            {column.map((group) => (
              <div key={group.href} role="group" aria-label={group.label} className="d-mobile-group">
                <span className="d-mobile-label" aria-hidden="true">{group.label}</span>
                {group.links.map((link) => <Link key={link.href} href={link.href} className="d-mobile-link" aria-current={link.current(pathname) ? "page" : undefined}>{link.label}</Link>)}
              </div>
            ))}
          </div>
        ))}
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

type MenuLink = { href: string; label: string; current: (pathname: string) => boolean };

// The phone menu: one group per section with tabs, and a "More" group for each run of sections without tabs.
function menuGroups() {
  const groups: { href: string; label: string; links: MenuLink[]; more?: boolean }[] = [];
  for (const section of SECTIONS) {
    if (section.tabs) {
      groups.push({ href: section.href, label: section.label, links: section.tabs.map((t) => ({ href: t.href, label: t.label, current: (p) => tabActive(p, t) })) });
      continue;
    }
    const link = { href: section.href, label: section.label, current: (p: string) => sectionActive(p, section) };
    const last = groups.at(-1);
    if (last?.more) last.links.push(link);
    else groups.push({ href: section.href, label: "More", links: [link], more: true });
  }
  return groups;
}

// The phone menu's two columns: the groups in order, split where the columns come out closest in height.
// A group's height is about one row for its label plus one per link.
function menuColumns() {
  const groups = menuGroups();
  const rows = groups.map((g) => g.links.length + 1);
  const total = rows.reduce((a, b) => a + b, 0);
  let split = 1;
  let left = rows[0];
  for (let i = 1, sum = rows[0]; i < groups.length - 1; i++) {
    sum += rows[i];
    if (Math.abs(total - 2 * sum) < Math.abs(total - 2 * left)) { split = i + 1; left = sum; }
  }
  return [groups.slice(0, split), groups.slice(split)];
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
