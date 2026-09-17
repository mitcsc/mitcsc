"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AdminSetup from "@/components/voting/AdminSetup";
import type { AdminAction, VotingPhase, VotingState } from "@/lib/voting/types";
import "./admin.css";

const rounds: { phase: VotingPhase; label: string; description: string; next: VotingPhase; action: string }[] = [
  {phase: "waiting", label: "Ready to begin", description: "Start initial ratings when everyone is ready.", next: "initial", action: "Start initial ratings"},
  {phase: "initial", label: "Initial ratings open", description: "Voters record their first impressions. Start discussion once everyone has saved.", next: "deliberation", action: "Start discussion"},
  {phase: "deliberation", label: "Discussion", description: "Ratings are paused while you discuss this candidate.", next: "revision", action: "Open revisions"},
  {phase: "revision", label: "Revisions open", description: "Voters can change their ratings. Open submissions when everyone is ready.", next: "final", action: "Open final submissions"},
  {phase: "final", label: "Final submissions open", description: "Voters can submit their final ballots. Close voting once everyone has submitted.", next: "locked", action: "Close voting for this candidate"},
];
const steps = ["Initial ratings", "Discussion", "Revisions", "Final submission"];

async function responseData(response: Response) {
  const data = await response.json().catch(() => ({error: "The server returned an unexpected response. Please try again."}));
  if (!response.ok) throw new Error(data.error || "Unable to complete this request.");
  return data;
}

export default function DeliberationsAdminPage() {
  const [state, setState] = useState<VotingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupRevision, setSetupRevision] = useState(0);
  const pollInFlight = useRef(false);
  const mutating = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const applyState = useCallback((next: VotingState) => {
    setState(next);
  }, []);
  const refresh = useCallback(async () => {
    if (pollInFlight.current || mutating.current || document.hidden) return;
    pollInFlight.current = true;
    const revision = generation.current;
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/voting/state", {cache: "no-store", signal: abort.signal});
      if (revision !== generation.current) return;
      if (response.status === 401) { setState(null); return; }
      const next: VotingState = await responseData(response);
      if (revision === generation.current) {applyState(next); setConnectionError("");}
    } catch (e) {
      if (!abort.signal.aborted && revision === generation.current) setConnectionError(e instanceof Error ? e.message : "Connection lost. Retrying automatically.");
    } finally {pollInFlight.current = false; setLoading(false);}
  }, [applyState]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {void refresh();}, 4000);
    const visible = () => {if (!document.hidden) void refresh();};
    document.addEventListener("visibilitychange", visible);
    return () => {window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); controller.current?.abort();};
  }, [refresh]);
  const act = async (action: AdminAction) => {
    if (mutating.current) return false;
    mutating.current = true; generation.current++; setBusy(true); setError(""); setNotice("");
    try {
      const next: VotingState = await responseData(await fetch("/api/voting/admin", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(action)}));
      applyState(next);
      if (action.action === "initialize" || action.action === "shuffle") setSetupRevision(x => x + 1);
      if (action.action === "shuffle") setNotice("Remaining candidate order shuffled and saved to Sheets.");
      return true;
    } catch (e) {setError(e instanceof Error ? e.message : "The change could not be saved."); return false;}
    finally {mutating.current = false; setBusy(false);}
  };
  const join = async (event: FormEvent) => {
    event.preventDefault(); if (mutating.current) return;
    mutating.current = true; generation.current++; setBusy(true); setError("");
    try {
      await responseData(await fetch("/api/voting/join", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({role: "voter", password, name: name.trim()})}));
      setPassword(""); applyState(await responseData(await fetch("/api/voting/state", {cache: "no-store"})));
    } catch (e) {setError(e instanceof Error ? e.message : "Unable to sign in.");}
    finally {mutating.current = false; setBusy(false);}
  };
  const candidates = [...(state?.candidates || [])].sort((a, b) => a.order - b.order);
  const started = !!state?.ballotVersion || candidates.some(c => c.completed) || (!!state && state.phase !== "waiting");
  const editable = state?.initialized && !started && state.phase === "waiting";
  const changePhase = (phase: VotingPhase) => {
    if (phase === "locked" && !window.confirm(`Close ${state?.currentCandidate?.name}? ${state?.submittedCount ?? 0} final ballots are saved. Initial drafts remain only in voters’ browsers, so confirm everyone has submitted. You can reopen final submissions later to collect missing ballots.`)) return;
    void act({action: "setPhase", phase});
  };
  const selectCandidate = (id: string) => {
    if (state?.phase !== "waiting" && state?.phase !== "locked") return;
    void act({action: "setPhase", phase: "waiting", candidateId: id});
  };
  const reopenCandidate = (id: string) => {
    if (state?.phase !== "waiting" && state?.phase !== "locked") return;
    if (!window.confirm("Reopen final submissions for this candidate? Existing ballots and the original ballot version stay unchanged. Voters with a pending local ballot can submit it.")) return;
    void act({action: "setPhase", phase: "final", candidateId: id});
  };
  const round = rounds.find(r => r.phase === state?.phase);
  const stepIndex = ["initial", "deliberation", "revision", "final", "locked"].indexOf(state?.phase || "");
  const canChoose = state?.phase === "waiting" || state?.phase === "locked";
  const nextCandidate = candidates.find(c => !c.completed && c.id !== state?.currentCandidate?.id);
  return <div className="voting-admin">
    {error && <div className="voting-admin-alert" role="alert">{error}</div>}
    {connectionError && <div className="voting-admin-alert" role="alert">{connectionError} Retrying automatically.</div>}
    {notice && <div className="voting-admin-notice" role="status">{notice}</div>}
    {loading ? <section className="voting-admin-card"><p role="status">Connecting to your election…</p></section> : !state?.isAdmin ? <section className="voting-admin-card voting-admin-login">{state && <h2>Admin already assigned</h2>}{state ? <><p>Someone else has already joined as admin. You’re signed in and can participate on the voting page.</p><Link href="/vote">Go to voting →</Link><p className="voting-admin-muted">The admin should keep using the same browser for this session.</p></> : <><form onSubmit={join}><label>Your name<input value={name} onChange={e => setName(e.target.value)} maxLength={100} autoComplete="name" required/></label><label>Session password<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required/></label><button className="voting-admin-primary" disabled={busy || !password || !name.trim()}>{busy ? "Checking…" : "Join session"}</button></form></>}</section> : <>
      {!state.active && <div className="voting-admin-notice">Voting is closed. Set a password in Settings to open the session.</div>}
      {!state.initialized ? <section className="voting-admin-card"><h2>Set up this election</h2><p>Create the voting tabs in your election spreadsheet.</p><button className="voting-admin-primary" disabled={busy} onClick={() => void act({action: "initialize"})}>{busy ? "Setting up…" : "Set up election"}</button></section> : <>
        <div className="voting-admin-controls">
          <section className="voting-admin-candidates" aria-label="Candidate selection">
            <div className="voting-admin-heading"><h2>Candidates</h2><button disabled={busy || candidates.filter(c => !c.completed && c.id !== state.currentCandidate?.id).length < 2} onClick={() => {if (window.confirm("Shuffle the remaining candidates? Save any setup edits first.")) void act({action: "shuffle"});}}>Shuffle order</button></div>
            <ol className="voting-candidate-list">{candidates.map((c, index) => <li key={c.id}>
              <button className={c.id === state.currentCandidate?.id ? "is-selected" : ""} aria-current={c.id === state.currentCandidate?.id ? "true" : undefined} aria-label={c.completed ? `Reopen submissions for ${c.name}` : `Choose ${c.name}`} disabled={busy || !canChoose || (!c.completed && c.id === state.currentCandidate?.id)} onClick={() => c.completed ? reopenCandidate(c.id) : selectCandidate(c.id)}>
                <span className="voting-candidate-index">{c.completed ? "✓" : index + 1}</span><span><strong>{c.name}</strong><small>{c.completed ? "Closed · reopen submissions" : c.id === state.currentCandidate?.id ? "Current candidate" : "Not started"}</small></span>{c.id === state.currentCandidate?.id && <span className="voting-candidate-marker" aria-hidden="true">●</span>}
              </button>
            </li>)}</ol>
            {!candidates.length ? <p className="voting-admin-muted">Add candidates below.</p> : !canChoose && <p className="voting-admin-muted">Close voting before changing candidates.</p>}
          </section>
          <section className="voting-round-controls" aria-label="Round controls">
            {!state.currentCandidate ? <div className="voting-round-empty"><h2>Choose a candidate to begin</h2><p>Select a name from the candidate list.</p></div> : <>
              <h2 className="voting-current-name">{state.currentCandidate.name}</h2>
              <ol className="voting-round-steps" aria-label="Voting rounds">{steps.map((label, index) => <li key={label} aria-current={stepIndex === index ? "step" : undefined} className={stepIndex === index ? "is-current" : stepIndex > index ? "is-complete" : ""}><span>{stepIndex > index ? "✓" : index + 1}</span>{label}</li>)}</ol>
              <div className="voting-round-status" aria-live="polite"><h3>{state.phase === "locked" ? "Voting closed" : round?.label}</h3><p>{state.phase === "locked" ? "This candidate is complete." : round?.description}</p></div>
              {(state.phase === "final" || state.phase === "locked") && <p className="voting-submission-count"><strong>{state.submittedCount}</strong> final ballots submitted</p>}
              {round && <button className="voting-admin-primary voting-round-next" disabled={busy || !state.active || (round.next === "initial" && state.currentCandidate.completed) || !state.criteria.length} onClick={() => changePhase(round.next)}>{busy ? "Updating…" : round.action}<span aria-hidden="true">→</span></button>}
              {state.phase === "locked" && nextCandidate && <button className="voting-admin-primary voting-round-next" disabled={busy} onClick={() => selectCandidate(nextCandidate.id)}>Next candidate: {nextCandidate.name}<span aria-hidden="true">→</span></button>}
              {state.phase === "locked" && !nextCandidate && <p className="voting-admin-muted">All candidates are complete.</p>}
            </>}
          </section>
        </div>
        {editable ? <AdminSetup key={`${state.sessionId}-${setupRevision}`} candidates={candidates} criteria={state.criteria} busy={busy} onSave={(nextCandidates, criteria) => act({action: "saveSetup", candidates: nextCandidates, criteria})}/> : <section className="voting-admin-card"><h2>Rating criteria</h2><p className="voting-admin-muted">Setup is locked once voting begins.</p><div className="voting-admin-read-criteria">{state.criteria.map(c => <div key={c.id}><strong>{c.label}</strong><span>{c.min}–{c.max} · {c.required ? "Required" : "Optional"}</span><p>{c.description}</p></div>)}</div></section>}
      </>}
    </>}
  </div>;
}
