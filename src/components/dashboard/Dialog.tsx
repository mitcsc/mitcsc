"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/membership/icons";

// Matches the d-dialog-out animation in dashboard.css.
const CLOSE_MS = 160;

// A modal on the native <dialog>, so focus trapping and Escape come from the browser.
// Children can be a function that gets close(then?): it plays the exit animation, then runs then (or onClose).
export default function Dialog({ title, onClose, children, wide = false }: {
  title: string; onClose: () => void; wide?: boolean;
  children: React.ReactNode | ((close: (then?: () => void) => void) => React.ReactNode);
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const [leaving, setLeaving] = useState(false);
  // No close() on cleanup: it fires the close event, and unmounting ends the modal anyway.
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  function close(then: () => void = onClose) {
    if (closing.current) return;
    closing.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return then();
    setLeaving(true);
    window.setTimeout(then, CLOSE_MS);
  }

  return (
    <dialog
      ref={ref}
      className={`d-dialog${wide ? " is-wide" : ""}${leaving ? " is-closing" : ""}`}
      aria-labelledby="dialog-title"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClose={() => { if (!closing.current) onClose(); }}
      onClick={(event) => { if (event.target === ref.current) close(); }}
    >
      <div className="d-dialog-body">
        <div className="d-dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className="m-copy" aria-label="Close" onClick={() => close()}><Icon name="close" /></button>
        </div>
        {typeof children === "function" ? children(close) : children}
      </div>
    </dialog>
  );
}
