"use client";

import { usePathname } from "next/navigation";

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/vote" || pathname.startsWith("/vote/")) return null;
  return children;
}
