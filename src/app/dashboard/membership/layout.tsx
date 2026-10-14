import { SaveStatusProvider, SubNav } from "@/components/dashboard/Shell";
import { currentYear } from "@/lib/membership/store";

const TABS = [
  { href: "/dashboard/membership", label: "Members" },
  { href: "/dashboard/membership/form", label: "Form editor" },
  { href: "/dashboard/membership/settings", label: "Settings" },
];

// The right side of the sub-tabs shows the save status and the school year. Signups open or closed lives on Settings.
export default async function MembershipLayout({ children }: { children: React.ReactNode }) {
  const config = await currentYear();
  return (
    <SaveStatusProvider>
      <SubNav label="Membership" tabs={TABS}>
        {config && <span className="d-year">{config.year}</span>}
      </SubNav>
      {children}
    </SaveStatusProvider>
  );
}
