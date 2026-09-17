import type { Metadata } from "next";
import "./voting.css";
import "./mockup.css";

export const metadata: Metadata = {
  title: "Deliberations | MIT CSC",
  description: "Private CSC executive deliberations.",
  robots: { index: false, follow: false },
};

export default function DeliberationsLayout({ children }: { children: React.ReactNode }) {
  return <main className="voting-root">{children}</main>;
}
