"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { Toaster, toast } from "sonner";

// Sonner switches to its full-width phone layout at this width.
const PHONE = "(max-width: 600px)";
const watchPhone = (change: () => void) => { const query = matchMedia(PHONE); query.addEventListener("change", change); return () => query.removeEventListener("change", change); };

export function VotingToaster() {
  // On phones the ballot's submit button sits at the bottom of the page, so toasts go on top.
  const phone = useSyncExternalStore(watchPhone, () => matchMedia(PHONE).matches, () => false);
  return <Toaster position={phone ? "top-center" : "bottom-right"} theme="dark" visibleToasts={3} offset={20} mobileOffset={16}/>;
}

export default function VotingNotice({message, tone = "error", actionLabel, onAction, persistent = true}: {
  message: string; tone?: "error" | "info"; actionLabel?: string; onAction?: () => void; persistent?: boolean;
}) {
  const id = useId();
  const callback = useRef(onAction);
  useEffect(() => { callback.current = onAction; }, [onAction]);
  useEffect(() => {
    if (!message) { toast.dismiss(id); return; }
    toast.custom(() => <div className={`voting-notice is-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span className="voting-notice-icon" aria-hidden="true">{tone === "error" ? "!" : "i"}</span>
      <div><p>{message}</p>{actionLabel && <button onClick={() => callback.current?.()}>{actionLabel}</button>}</div>
      {!persistent && <button className="voting-notice-close" aria-label="Dismiss notification" onClick={() => toast.dismiss(id)}>×</button>}
    </div>, {id, duration: persistent ? Infinity : 5000, dismissible: !persistent});
  }, [id, message, tone, actionLabel, persistent]);
  useEffect(() => () => { toast.dismiss(id); }, [id]);
  return null;
}
