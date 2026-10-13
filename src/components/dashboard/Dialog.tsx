"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/membership/icons";

// A modal on the native <dialog>, so focus trapping and Escape come from the browser.
export default function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  // No close() on cleanup: it fires the close event, and unmounting ends the modal anyway.
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`d-dialog${wide ? " is-wide" : ""}`}
      aria-labelledby="dialog-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === ref.current) onClose(); }}
    >
      <div className="d-dialog-body">
        <div className="d-dialog-head">
          <h2 id="dialog-title">{title}</h2>
          <button type="button" className="m-copy" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
