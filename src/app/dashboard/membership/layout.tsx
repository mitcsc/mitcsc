import { SaveStatusProvider, SubNav } from "@/components/dashboard/Shell";
import { signupsAreOpen } from "@/lib/membership/config";
import { currentYear } from "@/lib/membership/store";

const TABS = [
  { href: "/dashboard/membership", label: "Members" },
  { href: "/dashboard/membership/form", label: "Form editor" },
  { href: "/dashboard/membership/settings", label: "Settings" },
];

export default async function MembershipLayout({ children }: { children: React.ReactNode }) {
  const config = await currentYear();
  return (
    <SaveStatusProvider>
      <SubNav tabs={TABS}>
        {config && (
          <>
            <span className="d-year">{config.year}</span>
            <span className="m-tag">{signupsAreOpen(config) ? "Signups open" : "Signups closed"}</span>
          </>
        )}
      </SubNav>
      {children}
    </SaveStatusProvider>
  );
}
