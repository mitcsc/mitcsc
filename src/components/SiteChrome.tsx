"use client";

import { usePathname } from "next/navigation";

// These routes are full-screen apps with their own header.
const BARE_ROUTES = ["/vote", "/membership", "/dashboard"];

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (BARE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) return null;
  return children;
}
