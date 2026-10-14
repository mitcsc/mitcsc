"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Server renders this browser tab has already shown. Back and Forward reuse a page's old render,
// so seeing a render again means its data may be old.
const shown = new Set<number>();

// Keeps a page's server data current: reloads it when Back or Forward brings back an old render,
// when the tab becomes visible again, and every `everyMs` while visible.
export function useLiveData(renderedAt: number, everyMs?: number) {
  const router = useRouter();

  useEffect(() => {
    if (shown.has(renderedAt)) router.refresh();
    else shown.add(renderedAt);
  }, [renderedAt, router]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", refresh);
    const timer = everyMs ? window.setInterval(refresh, everyMs) : undefined;
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [everyMs, router]);
}

// For server-rendered pages without a client component of their own.
export default function LiveData({ renderedAt }: { renderedAt: number }) {
  useLiveData(renderedAt);
  return null;
}
