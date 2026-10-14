import { instrumentSans } from "@/components/membership/font";

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return <div className={`m-font ${instrumentSans.variable}`}>{children}</div>;
}
