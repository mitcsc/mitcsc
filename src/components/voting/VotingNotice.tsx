"use client";

import { useEffect, useId, useRef } from "react";
import { Toaster, toast } from "sonner";

// The ballot's submit button sits at the bottom of the page, so toasts go on top, just under the dashboard header.
export function VotingToaster() {
  return <Toaster position="top-center" theme="dark" visibleToasts={3} offset={{top: 76}} mobileOffset={{top: 72}}/>;
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
