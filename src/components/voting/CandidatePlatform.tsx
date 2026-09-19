"use client";
import { useRef } from "react";
import type { Candidate } from "@/lib/voting/types";
export default function CandidatePlatform({candidate}: {candidate: Candidate}) {
  const dialog = useRef<HTMLDialogElement>(null);
  if (!candidate.context.trim()) return null;
  return <div className="candidate-platform-control">
    <button type="button" className="candidate-platform-trigger" aria-haspopup="dialog" onClick={()=>dialog.current?.showModal()}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg><span>View platform</span></button>
    <dialog ref={dialog} className="candidate-platform-dialog" aria-label={`${candidate.name} — platform`} onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close();}}>
      <header><div><span>Platform</span><h2>{candidate.name}</h2></div><button type="button" autoFocus aria-label="Close platform" onClick={()=>dialog.current?.close()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
      <div className="candidate-platform-content">{candidate.context}</div>
    </dialog>
  </div>;
}
