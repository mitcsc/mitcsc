import { SubNav } from "@/components/dashboard/Shell";
import { WEBSITE_TABS } from "@/components/dashboard/nav";

export default function WebsiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav label="Website" tabs={WEBSITE_TABS} />
      {children}
    </>
  );
}
