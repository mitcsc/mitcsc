import { SubNav } from "@/components/dashboard/Shell";
import { CHECK_IN_TABS } from "@/components/dashboard/nav";

export default function CheckInLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav label="Check-In" tabs={CHECK_IN_TABS} />
      {children}
    </>
  );
}
