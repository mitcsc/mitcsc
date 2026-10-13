import type { Metadata } from "next";
import { Suspense } from "react";
import { MainNav, ProblemBanner, SignIn } from "@/components/dashboard/Shell";
import { hasExecAccess, signedInEmail } from "@/lib/membership/exec-auth";
import "@/components/membership/ui.css";
import "./dashboard.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "CSC Dashboard",
  robots: { index: false, follow: false },
};

function SignOut({ label }: { label: string }) {
  return (
    <form action="/api/auth/signout" method="post">
      <button type="submit" className="d-signout">{label}</button>
    </form>
  );
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
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
    <div className="m-root d-shell">
      <header className="d-header">
        <span className="d-brand"><span className="d-brand-dot" aria-hidden="true" />CSC Dashboard</span>
        <MainNav />
        <span className="d-account">
          <span className="d-account-email">{email}</span>
          <SignOut label="Sign out" />
        </span>
      </header>
      <Suspense>
        <ProblemBanner />
      </Suspense>
      {children}
    </div>
  );
}
