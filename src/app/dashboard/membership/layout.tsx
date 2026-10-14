import { SubNav } from "@/components/dashboard/Shell";
import { MEMBERSHIP_TABS } from "@/components/dashboard/nav";

// The right side of the sub-tabs shows the save status.
export default function MembershipLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav label="Membership" tabs={MEMBERSHIP_TABS} />
      {children}
    </>
  );
}
