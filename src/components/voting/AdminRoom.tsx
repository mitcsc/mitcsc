"use client";


import { useCallback, useEffect, useRef, useState } from "react";
import AdminSetup from "@/components/voting/AdminSetup";
import type { AdminAction, VotingPhase, VotingState } from "@/lib/voting/types";

const rounds: { phase: VotingPhase; label: string; description: string; next: VotingPhase; action: string }[] = [
  {phase: "waiting", label: "Ready to begin", description: "Voters see a waiting screen until you start.", next: "initial", action: "Start initial ratings"},
  {phase: "initial", label: "Initial ratings open", description: "Voters rate this candidate and save before discussion.", next: "deliberation", action: "Start discussion"},
  {phase: "deliberation", label: "Discussion", description: "Voters are discussing this candidate.", next: "revision", action: "Open voting"},
  {phase: "revision", label: "Voting open", description: "Voters can revise their ratings and submit when ready.", next: "locked", action: "Close voting for this candidate"},
  {phase: "final", label: "Voting open", description: "Voters can revise their ratings and submit when ready.", next: "locked", action: "Close voting for this candidate"},
];
const steps = ["Initial ratings", "Discussion", "Submit"];

async function responseData(response: Response) {
  const data = await response.json().catch(() => ({error: "The server returned an unexpected response. Please try again."}));
  if (!response.ok) throw new Error(data.error || "Unable to complete this request.");
  return data;
}

export default function AdminRoom({initialState, onExit}: {initialState: VotingState; onExit: (state?: VotingState) => void}) {
  const [serverState, setState] = useState<VotingState | null>(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedId(null);
    try {
      const saved = JSON.parse(localStorage.getItem(`voting-order:${serverState?.sessionId}`) || "[]");
      setDisplayOrder(Array.isArray(saved) ? saved.filter(id => typeof id === "string") : []);
    } catch { setDisplayOrder([]); }
  }, [serverState?.sessionId]);
  const candidates = [...(serverState?.candidates || [])].sort((a, b) => {
    const ai = displayOrder.indexOf(a.id), bi = displayOrder.indexOf(b.id);
    return (ai < 0 ? displayOrder.length + a.order : ai) - (bi < 0 ? displayOrder.length + b.order : bi);
  });
  const started = !!serverState?.ballotVersion || candidates.some(c => c.completed) || (!!serverState && serverState.phase !== "waiting");
  const selected = candidates.find(c => c.id === selectedId) || serverState?.currentCandidate || candidates[0] || null;
  const viewingLive = selected?.id === serverState?.currentCandidate?.id;
  const selectedState = serverState?.candidateStates?.find(c => c.candidateId === selected?.id);
  const state = serverState && selected && !viewingLive ? {...serverState, currentCandidate: selected, phase: selectedState?.phase || (selected.completed ? "locked" as const : "waiting" as const), ballotVersion: selectedState?.ballotVersion || "", submittedCount: selectedState?.submittedCount || 0, participants: selectedState?.participants || []} : serverState;
  const liveIdle = serverState?.phase === "waiting" || serverState?.phase === "locked";
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"setup" | "live">("setup");
  const [setupRevision, setSetupRevision] = useState(0);
  const pollInFlight = useRef(false);
  const pollAfter = useRef(0);
  const pollFailures = useRef(0);
  const mutating = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const applyState = useCallback((next: VotingState) => {
    setState(next);
  }, []);
  const refresh = useCallback(async () => {
    if (pollInFlight.current || mutating.current || document.hidden || Date.now() < pollAfter.current) return;
    pollInFlight.current = true;
    const revision = generation.current;
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/voting/state", {cache: "no-store", signal: abort.signal});
      if (revision !== generation.current) return;
      if (response.status === 401) { onExit(); return; }
      const next: VotingState = await responseData(response);
      pollFailures.current = 0; pollAfter.current = 0;
      if (!next.isAdmin) { onExit(next); return; }
      if (revision === generation.current) {applyState(next); setConnectionError("");}
    } catch (e) {
      if (!abort.signal.aborted && revision === generation.current) {
        pollAfter.current = Date.now() + Math.min(60_000, 4000 * 2 ** ++pollFailures.current) + Math.random() * 2000;
        setConnectionError(e instanceof Error ? e.message : "Connection lost. Retrying automatically.");
      }
    } finally {pollInFlight.current = false; setLoading(false);}
  }, [applyState, onExit]);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {void refresh();}, 8000);
    const visible = () => {if (!document.hidden) void refresh();};
    document.addEventListener("visibilitychange", visible);
    return () => {window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); controller.current?.abort();};
  }, [refresh]);
  const act = async (action: AdminAction) => {
    if (mutating.current) return false;
    mutating.current = true; generation.current++; setBusy(true); setError("");
    try {
      const next: VotingState = await responseData(await fetch("/api/voting/admin", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(action)}));
      applyState(next);
      if (action.action === "setPhase") {
        const upcoming = action.phase === "locked" ? candidates.find(candidate => candidate.id !== next.currentCandidate?.id && next.candidates?.some(updated => updated.id === candidate.id && !updated.completed)) : undefined;
        setSelectedId(upcoming?.id || next.currentCandidate?.id || null);
      }
      if (action.action === "initialize") setTab("setup");
      if (action.action === "initialize") setSetupRevision(x => x + 1);
      return true;
    } catch (e) {setError(e instanceof Error ? e.message : "The change could not be saved."); return false;}
    finally {mutating.current = false; setBusy(false);}
  };
  const editable = state?.initialized && !started && state.phase === "waiting";
  const showPreview = started || tab === "live";
  const changePhase = (phase: VotingPhase) => {
    void act({action: "setPhase", phase, ...(phase === "initial" && state?.currentCandidate ? {candidateId: state.currentCandidate.id} : {})});
  };
  const selectCandidate = (id: string) => { setSelectedId(id); };
  const reopenCandidate = (id: string) => {
    if (!liveIdle) return;
    void act({action: "setPhase", phase: "final", candidateId: id});
  };
  const round = rounds.find(r => r.phase === state?.phase);
  const stepIndex = state?.phase === "final" ? 2 : ["initial", "deliberation", "revision", "locked"].indexOf(state?.phase || "");
  const nextCandidate = candidates.find(c => !c.completed && c.id !== state?.currentCandidate?.id);
  return <div className={`voting-admin ${state?.isAdmin && state.initialized ? `voting-console ${showPreview ? "voting-live-page" : ""}` : ""}`}>

    {error && <div className="voting-admin-alert" role="alert">{error}</div>}
    {connectionError && <div className="voting-admin-alert" role="alert">{connectionError} Retrying automatically.</div>}
    {loading ? <section className="voting-admin-card"><p role="status">Connecting to your election…</p></section> : !state?.isAdmin ? null : <>
      {!state.active && <div className="voting-admin-notice">Voting is closed. Set a password in Settings to open the session.</div>}
      {!state.initialized ? <section className="voting-admin-card"><h2>Set up this election</h2><p>Add candidates and criteria to begin.</p><button className="voting-admin-primary" disabled={busy} onClick={() => void act({action: "initialize"})}>{busy ? "Setting up…" : "Set up election"}</button></section> : <>
        <div className="voting-admin-controls" hidden={!showPreview}>
          <section className="voting-admin-candidates" aria-label="Candidate selection">
            {editable && <div className="voting-preview-back"><button onClick={() => setTab("setup")}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14"/></svg><span>Back to setup</span></button></div>}
            <ol className="voting-candidate-list">{candidates.map(c => <li key={c.id}>
              <button className={c.id === state.currentCandidate?.id ? "is-selected" : ""} aria-current={c.id === state.currentCandidate?.id ? "true" : undefined} aria-label={`View ${c.name}`} disabled={busy} onClick={() => selectCandidate(c.id)}>
                <span className={`voting-candidate-dot ${c.completed ? "is-done" : c.id === serverState?.currentCandidate?.id ? "is-now" : ""}`} aria-hidden="true"/><span><strong>{c.name}</strong><small>{c.id === serverState?.currentCandidate?.id && !liveIdle ? "Live" : c.completed ? "Complete" : ""}</small></span>
              </button>
            </li>)}</ol>


          </section>
          <section className="voting-round-controls" aria-label="Round controls">
            {!state.currentCandidate ? <div className="voting-round-empty"><h2>Choose a candidate to begin</h2><p>Select a name from the candidate list.</p></div> : <>
              <p className="voting-current-label">{viewingLive && !liveIdle ? "Current candidate" : state.currentCandidate.completed ? "Completed candidate" : "Up next"}</p><h2 className="voting-current-name">{state.currentCandidate.name}</h2>
              <ol className="voting-round-steps" aria-label="Voting rounds">{steps.map((label, index) => <li key={label} aria-current={stepIndex === index ? "step" : undefined} className={stepIndex === index ? "is-current" : stepIndex > index ? "is-complete" : ""}><span className="voting-stage-marker" aria-hidden="true">{stepIndex > index ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 8 3 3 7-7"/></svg> : index + 1}</span><span className="voting-stage-label">{label}</span><span className="voting-sr-only">{stepIndex > index ? ": Completed" : stepIndex === index ? ": In progress" : ": Upcoming"}</span></li>)}</ol>
              <div className="voting-round-status" aria-live="polite"><h3 className="voting-sr-only">{state.phase === "locked" ? "Voting closed" : round?.label}</h3><p>{state.exportPending ? "Votes saved. Export to Sheets before continuing." : state.phase === "locked" ? "This candidate is complete." : round?.description}</p></div>
              {(state.phase === "locked") && <p className="voting-submission-count"><strong>{state.submittedCount}</strong> final ballots submitted</p>}
              {["initial", "revision", "final"].includes(state.phase) && state.participants && <div className="voting-waiting-on" aria-live="polite">
                {(() => {
                  const voters = state.phase === "initial" ? state.participants : state.participants.filter(voter => voter.initialSubmitted);
                  const waiting = voters.filter(voter => state.phase === "initial" ? !voter.initialSubmitted : !voter.submitted);
                  return voters.length === 0 ? <p>{state.phase === "initial" ? "No voters have joined yet." : "No initial ratings were submitted."}</p> : <><div className="voting-response-progress"><span><strong>{voters.length - waiting.length}</strong> / {voters.length} submitted</span><span>{state.phase === "initial" ? "Initial ratings" : "Final votes"}</span></div><progress aria-label="Submitted votes" value={voters.length - waiting.length} max={voters.length}/>{waiting.length === 0 ? <p>Everyone has submitted.</p> : <><p>Waiting on {waiting.length}</p><ul>{waiting.map(voter => <li key={voter.id}>{voter.name}</li>)}</ul></>}</>;
                })()}
              </div>}

              {round && <button className="voting-admin-primary voting-round-next" disabled={busy || (!viewingLive && !liveIdle) || !state.active || (round.next === "initial" && state.currentCandidate.completed) || !state.criteria.length} onClick={() => changePhase(round.next)}>{busy ? "Updating…" : round.action}</button>}
              {state.exportPending && <button className="voting-admin-primary voting-round-next" disabled={busy} onClick={() => void act({action: "setPhase", phase: "locked"})}>{busy ? "Exporting…" : "Retry export to Sheets"}</button>}
              {state.phase === "locked" && !state.exportPending && <button className="voting-admin-primary voting-round-next voting-reopen-action" disabled={busy || !liveIdle} onClick={() => reopenCandidate(state.currentCandidate!.id)}>{busy ? "Reopening…" : "Reopen final submission"}</button>}
              {!viewingLive && !liveIdle && <p className="voting-admin-muted">Another candidate is live. Close that round before opening this one.</p>}
              {state.phase === "locked" && !state.exportPending && !nextCandidate && <p className="voting-admin-muted">All candidates are complete.</p>}
            </>}
          </section>
        </div>
        <div hidden={showPreview} className="voting-setup-tab">{editable ? <AdminSetup key={`${state.sessionId}-${setupRevision}`} candidates={candidates} criteria={state.criteria} busy={busy} joinedCount={serverState?.participants?.length || 0} onContinue={() => setTab("live")} onSave={async (nextCandidates, criteria) => {
          const originalOrder = new Map((serverState?.candidates || []).map(c => [c.id, c.order]));
          const canonical = [...nextCandidates].sort((a, b) => (originalOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (originalOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER)).map((c, order) => ({...c, order}));
          if (!await act({action: "saveSetup", candidates: canonical, criteria})) return false;
          const order = nextCandidates.map(c => c.id);
          setDisplayOrder(order);
          try { localStorage.setItem(`voting-order:${state.sessionId}`, JSON.stringify(order)); } catch { /* Keep the order for this visit. */ }
          setSelectedId(order[0] || null);
          return true;
        }}/> : <section className="voting-admin-card"><h2>Criteria</h2><p className="voting-admin-muted">Setup is locked once voting begins.</p><div className="voting-admin-read-criteria">{state.criteria.map(c => <div key={c.id}><strong>{c.label}</strong><span>{c.min}–{c.max} · {c.required ? "Required" : "Optional"}</span><p>{c.description}</p></div>)}</div></section>}</div>
      </>}
    </>}
  </div>;
}
