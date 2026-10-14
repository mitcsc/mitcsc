"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useState } from "react";
import { Icon } from "@/components/membership/icons";

const MAIN_TABS = [
  { href: "/dashboard/membership", label: "Membership" },
  { href: "/dashboard/events", label: "Events" },
  { href: "/dashboard/settings", label: "Settings" },
];

function active(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard" className="d-main-nav">
      {MAIN_TABS.map((tab) => (
        <Link key={tab.href} href={tab.href} aria-current={active(pathname, tab.href) ? "page" : undefined}>{tab.label}</Link>
      ))}
    </nav>
  );
}

// Sub-tabs under Membership, with the save status on the right.
export function SubNav({ tabs, children }: { tabs: { href: string; label: string }[]; children?: React.ReactNode }) {
  const pathname = usePathname();
  const status = useContext(SaveContext).status;
  return (
    <div className="d-subnav">
      <nav aria-label="Membership" className="d-sub-tabs">
        {tabs.map((tab) => (
          <Link key={tab.href} href={tab.href} aria-current={pathname === tab.href ? "page" : undefined}>{tab.label}</Link>
        ))}
      </nav>
      <span className="d-subnav-meta">
        {status.state === "saving" && <span className="d-save">Saving…</span>}
        {status.state === "saved" && <span className="d-save"><Icon name="check" size={12} strokeWidth={2.4} />Saved</span>}
        {status.state === "error" && <span className="d-save is-error" role="alert">{status.message}</span>}
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

// Autosave status shared by the settings and form editor pages.

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };

const SaveContext = createContext<{ status: SaveState; setStatus: (s: SaveState) => void }>({ status: { state: "idle" }, setStatus: () => {} });

export function SaveStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SaveState>({ state: "idle" });
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
