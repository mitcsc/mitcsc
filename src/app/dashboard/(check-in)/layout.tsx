import { SubNav } from "@/components/dashboard/Shell";

const TABS = [
  { href: "/dashboard/check-in", label: "Check in" },
  { href: "/dashboard/events", label: "Events", nested: true },
];

export default function CheckInLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SubNav label="Check-in" tabs={TABS} />
      {children}
    </>
  );
}
