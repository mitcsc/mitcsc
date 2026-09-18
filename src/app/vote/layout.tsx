import type { Metadata } from "next";
import "./voting.css";
import "./mockup.css";
import "./join.css";

export const metadata: Metadata = {
  title: "Voting | MIT CSC",
  description: "Private CSC executive voting.",
  robots: { index: false, follow: false },
};

export default function DeliberationsLayout({ children }: { children: React.ReactNode }) {
  return <main className="voting-root">{children}</main>;
}
