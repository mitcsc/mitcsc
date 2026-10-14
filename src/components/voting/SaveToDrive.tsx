"use client";
import { useEffect, useRef } from "react";

type Gapi = { savetodrive: { render: (container: HTMLElement, params: Record<string, string>) => void } };
let platform: Promise<Gapi> | null = null;

// Google's script for the button. It needs no API key and no Cloud setup.
function loadPlatform() {
  platform ||= new Promise<Gapi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/platform.js";
    script.async = true;
    script.onload = () => {
      const gapi = (window as unknown as { gapi?: Gapi & { load: (name: string, done: () => void) => void } }).gapi;
      if (!gapi) return reject(new Error("Google's script did not load."));
      gapi.load("savetodrive", () => resolve(gapi));
    };
    script.onerror = () => { platform = null; reject(new Error("Google's script did not load.")); };
    document.head.append(script);
  });
  return platform;
}

// Google's "Save to Drive" button. It saves the file at `src` to the signed-in Google account's My Drive.
export default function SaveToDrive({ src, filename }: { src: string; filename: string }) {
  const container = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let cancelled = false;
    loadPlatform().then(gapi => {
      const el = container.current;
      if (cancelled || !el) return;
      el.replaceChildren();
      gapi.savetodrive.render(el, { src: new URL(src, location.href).href, filename, sitename: "MIT CSC" });
    }).catch(() => { /* The CSV download still works. */ });
    return () => { cancelled = true; };
  }, [src, filename]);
  return <span ref={container} className="save-to-drive"/>;
}
