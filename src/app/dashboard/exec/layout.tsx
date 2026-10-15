import { SubNav } from "@/components/dashboard/Shell";
import { EXEC_TABS } from "@/components/dashboard/nav";

export default function ExecLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav label="Exec" tabs={EXEC_TABS} />
      {children}
    </>
  );
}
