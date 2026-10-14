import { SubNav } from "@/components/dashboard/Shell";
import { DELIB_TABS } from "@/components/dashboard/nav";
import "./voting.css";
import "./mockup.css";
import "./join.css";
import "./voter.css";
import "./admin.css";
import "./delibs.css";

export default function DelibsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav label="Delibs" tabs={DELIB_TABS} />
      {children}
    </>
  );
}
