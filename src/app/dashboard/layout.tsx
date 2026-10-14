import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { MainNav, MobileNav, ProblemBanner, SaveStatus, SaveStatusProvider, SignIn } from "@/components/dashboard/Shell";
import { SECTIONS } from "@/components/dashboard/nav";
import { hasExecAccess, signedInEmail } from "@/lib/membership/exec-auth";
import { canSendEmail, clubConnection, clubEmail } from "@/lib/membership/google/oauth";
import { instrumentSans } from "@/components/membership/font";
import { Icon } from "@/components/membership/icons";
import { HoverTips } from "@/components/ui/useTooltip";
import "@/components/membership/ui.css";
import "./dashboard.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CSC Dashboard",
  robots: { index: false, follow: false },
};

// Every exec sees this, so whoever knows the club account's password can fix it.
async function ConnectionBanner() {
  const connection = await clubConnection().catch(() => null);
  if (!connection || canSendEmail(connection)) return null;
  const text = connection.brokenAt
    ? `The club Google account needs reconnecting. Venmo checks, sheet updates, and card emails are paused until someone reconnects as ${clubEmail()}.`
    : `Reconnect the club Google account to turn on card emails. Sign in as ${clubEmail()} and allow every permission.`;
  return (
    <div className="d-banner" role="status">
      <span>{text}</span>
      <form action="/api/auth/google/connect" method="get">
        <input type="hidden" name="next" value="/dashboard/settings" />
        <button type="submit" className="d-banner-action">Reconnect</button>
      </form>
    </div>
  );
}

function SignOut({ label, icon }: { label: string; icon?: boolean }) {
  return (
    <form action="/api/auth/signout" method="post">
      {icon
        ? <button type="submit" className="d-signout is-icon" aria-label={label} data-tip={label}><Icon name="signout" size={18} /></button>
        : <button type="submit" className="d-signout">{label}</button>}
    </form>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`m-font ${instrumentSans.variable}`}>
      <DashboardContent>{children}</DashboardContent>
    </div>
  );
}

async function DashboardContent({ children }: { children: React.ReactNode }) {
  const email = await signedInEmail();
  if (!email) {
    return (
      <Suspense>
        <SignIn />
      </Suspense>
    );
  }
  if (!(await hasExecAccess(email))) {
    return (
      <main className="m-root d-gate">
        <div className="d-gate-body">
          <h1 className="d-gate-title">No access</h1>
          <p className="d-muted">{email} can’t use this dashboard.</p>
          <SignOut label="Use another account" />
        </div>
      </main>
    );
  }
  return (
    <SaveStatusProvider>
      <div className="m-root d-shell">
        <header className="d-header">
          {/* Links to the first section itself. Going through /dashboard would show the menu with no section for a moment before the redirect. */}
          <Link className="d-brand" href={SECTIONS[0].href} aria-label="Dashboard home"><Image src="/img/logo/logo-with-panda.png" alt="" width={28} height={28} priority /></Link>
          <MainNav />
          <span className="d-header-save"><SaveStatus /></span>
          <MobileNav email={email} />
          <span className="d-account">
            <span className="d-account-email">{email}</span>
            <SignOut label="Sign out" icon />
          </span>
        </header>
        <ConnectionBanner />
        <Suspense>
          <ProblemBanner />
        </Suspense>
        {children}
        <HoverTips />
      </div>
    </SaveStatusProvider>
  );
}
