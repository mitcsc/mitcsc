"use client";
import VotingNotice from "./VotingNotice";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useTooltip } from "@/components/ui/useTooltip";
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

// The host's live controls. A delib is fully set up when it is created, so there is no setup step here.
export default function AdminRoom({initialState, onExit, onStateChange, showVoters = false, onResults}: {onResults?: () => void; showVoters?: boolean; initialState: VotingState; onExit: () => void; onStateChange?: (state: VotingState) => void}) {
  const [presence, setPresence] = useState<Record<string, "online" | "away" | "offline" | "unknown">>({});
  useEffect(() => {
    if (!showVoters) return;
    const controller = new AbortController();
    let running = false;
    const refreshPresence = async () => {
      if (running || document.hidden || controller.signal.aborted) return;
      running = true;
      try {
        const response = await fetch("/api/voting/presence", {cache:"no-store", signal:controller.signal});
        const data = await responseData(response);
        if (!controller.signal.aborted) setPresence(data.presence || {});
      } catch { if (!controller.signal.aborted) setPresence({}); }
      finally { running = false; }
    };
    void refreshPresence();
    const timer = window.setInterval(()=>void refreshPresence(),2000);
    document.addEventListener("visibilitychange",refreshPresence);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange",refreshPresence); };
  }, [showVoters, initialState.sessionId]);
  const [showRemoved, setShowRemoved] = useState(false);
  const removedTip = useTooltip(showRemoved ? "Hide removed voters" : "Show removed voters");
  const admitTip = useTooltip("Select waiting or removed voters. Admission is available before a round or during initial ratings.");
  const [selectedVoters, setSelectedVoters] = useState<string[]>([]);
  const [serverState, setState] = useState<VotingState | null>(initialState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const candidates = [...(serverState?.candidates || [])].sort((a, b) => a.order - b.order);
  const selected = candidates.find(c => c.id === selectedId) || serverState?.currentCandidate || candidates[0] || null;
  const viewingLive = selected?.id === serverState?.currentCandidate?.id;
  const selectedState = serverState?.candidateStates?.find(c => c.candidateId === selected?.id);
  const state = serverState && selected && !viewingLive ? {...serverState, currentCandidate: selected, phase: selectedState?.phase || (selected.completed ? "locked" as const : "waiting" as const), ballotVersion: selectedState?.ballotVersion || "", submittedCount: selectedState?.submittedCount || 0, participants: selectedState?.participants || []} : serverState;
  const liveIdle = serverState?.phase === "waiting" || serverState?.phase === "locked";
  const [busy, setBusy] = useState(false);
  const pollInFlight = useRef(false);
  const pollAfter = useRef(0);
  const pollFailures = useRef(0);
  const mutating = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const applyState = useCallback((next: VotingState) => {
    setState(next);
    onStateChange?.(next);
  }, [onStateChange]);
  const refresh = useCallback(async () => {
    if (pollInFlight.current || mutating.current || document.hidden || Date.now() < pollAfter.current) return;
    pollInFlight.current = true;
    const revision = generation.current;
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch("/api/voting/state", {cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)])});
      if (revision !== generation.current) return;
      if (response.status === 401) { onExit(); return; }
      const next: VotingState = await responseData(response);
      pollFailures.current = 0; pollAfter.current = 0;
      if (!next.isAdmin) { onExit(); return; }
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
    const timer = window.setInterval(() => {void refresh();}, initialState.pollIntervalMs || 8000);
    const visible = () => {if (!document.hidden) void refresh();};
    document.addEventListener("visibilitychange", visible);
    return () => {window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); controller.current?.abort();};
  }, [refresh, initialState.pollIntervalMs]);
  const act = async (action: AdminAction) => {
    if (mutating.current) return false;
    mutating.current = true; generation.current++; setBusy(true); setError("");
    try {
      const next: VotingState = await responseData(await fetch("/api/voting/admin", {signal: AbortSignal.timeout(65000), method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({...action, ...(action.action === "setPhase" ? {expected: {candidateId: serverState?.currentCandidate?.id || "", version: serverState?.ballotVersion || "", phase: serverState?.phase}} : {})})}));
      applyState(next);
      if (action.action === "setPhase") {
        const upcoming = action.phase === "locked" ? candidates.find(candidate => candidate.id !== next.currentCandidate?.id && next.candidates?.some(updated => updated.id === candidate.id && !updated.completed)) : undefined;
        setSelectedId(upcoming?.id || next.currentCandidate?.id || null);
      }
      return true;
    } catch (e) {setError(e instanceof Error ? e.message : "The change could not be saved."); return false;}
    finally {mutating.current = false; setBusy(false);}
  };
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
  const roster = serverState?.voters || [];
  const visibleVoters = [...roster.filter(v => !v.removed), ...(showRemoved ? roster.filter(v => v.removed) : [])];
  const rosterSelection = visibleVoters.filter(v => selectedVoters.includes(v.id));
  const canAdmit = !busy && !!rosterSelection.length && ["waiting", "initial"].includes(serverState?.phase || "") && rosterSelection.every(v => !v.banned && (v.removed || !v.eligible));
  const canKick = !busy && !!rosterSelection.length && rosterSelection.every(v => !v.removed);
  const canBan = !busy && !!rosterSelection.length && rosterSelection.every(v => !v.banned);
  return <div className={`voting-admin ${state?.isAdmin ? "voting-console voting-live-page" : ""}`}>
    {removedTip.tooltip}{admitTip.tooltip}
    {serverState && showVoters && <div id="admin-voter-roster" className="voting-roster">
      <div className="voting-roster-heading"><h2>Voters{rosterSelection.length ? ` (${rosterSelection.length} selected)` : ` (${visibleVoters.length})`}</h2><div className="voting-roster-actions">
        <button className="voting-roster-visibility" aria-label="Show removed voters" aria-pressed={showRemoved} {...removedTip.triggerProps} onClick={() => {setShowRemoved(!showRemoved); setSelectedVoters([]);}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>{!showRemoved && <path d="m3 3 18 18"/>}</svg>
        </button>
      </div></div>
      <div className="voting-roster-actions voting-roster-moderation">
        <button className="voting-roster-admit" disabled={!canAdmit} {...admitTip.triggerProps} onClick={async () => {if (await act({action: "admitVoters", voterIds: rosterSelection.map(v => v.id)})) setSelectedVoters([]);}}>Admit</button>
        <button className="voting-roster-kick" disabled={!canKick} onClick={async () => {if (await act({action: "removeVoters", voterIds: rosterSelection.map(v => v.id)})) setSelectedVoters([]);}}>Kick{rosterSelection.length ? ` (${rosterSelection.length})` : ""}</button>
        <button className="voting-roster-kick" disabled={!canBan} onClick={async () => {if (await act({action: "banVoters", voterIds: rosterSelection.map(v => v.id)})) setSelectedVoters([]);}}>Ban</button>
      </div>
      <section aria-label="Voters" className="voting-roster-list">
        {!visibleVoters.length && <p>{roster.length ? "No active voters." : "No voters have joined yet."}</p>}
        {visibleVoters.map((v, index) => <Fragment key={v.id}>{v.removed && (index === 0 || !visibleVoters[index - 1].removed) && <h3 className="voting-roster-group-heading">Removed</h3>}<div className={`voting-roster-row${v.banned ? " is-banned" : ""}`} key={v.id}><label className="voting-roster-select"><input type="checkbox" aria-label={`Select ${v.name}`} disabled={busy || !!v.banned} checked={selectedVoters.includes(v.id)} onChange={event => setSelectedVoters(ids => event.target.checked ? [...ids, v.id] : ids.filter(id => id !== v.id))}/><span className="voting-roster-person"><span title={v.name}>{v.name}</span>{!v.removed && v.eligible ? <small className={`voting-presence is-${presence[v.id] || "unknown"}`} aria-label={`Presence: ${presence[v.id] || "unknown"}`}>{presence[v.id] === "online" ? "Online" : presence[v.id] === "away" ? "Away" : presence[v.id] === "offline" ? "Offline" : "Unknown"}</small> : <small className={v.removed ? "is-removed" : "is-waiting"}>{v.banned ? "Banned" : v.removed ? "Kicked" : "Awaiting admission"}</small>}</span></label></div></Fragment>)}
      </section>
      <p className="voting-roster-note">Kick keeps votes. Ban blocks rejoining and excludes votes.</p>
    </div>}
    <VotingNotice message={error}/>
    <VotingNotice message={connectionError ? `${connectionError} Retrying automatically.` : ""}/>
    {loading ? <section className="voting-admin-card"><p role="status">Connecting to your election…</p></section> : !state?.isAdmin ? null : <>
      {!state.active && <div className="voting-admin-notice">This delib has ended.</div>}
      <div className="voting-admin-controls">
        <section className="voting-admin-candidates" aria-label="Candidate selection">
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
            <div className="voting-round-status" aria-live="polite"><h3 className="voting-sr-only">{state.phase === "locked" ? "Voting closed" : round?.label}</h3><p>{state.phase === "locked" ? "This candidate is complete." : round?.description}</p></div>
            {(state.phase === "locked") && <p className="voting-submission-count"><strong>{state.submittedCount}</strong> final {state.submittedCount === 1 ? "ballot" : "ballots"} submitted</p>}
            {["initial", "revision", "final"].includes(state.phase) && state.participants && <div className="voting-waiting-on" aria-live="polite">
              {(() => {
                const voters = state.phase === "initial" ? state.participants : state.participants.filter(voter => voter.initialSubmitted);
                const waiting = voters.filter(voter => state.phase === "initial" ? !voter.initialSubmitted : !voter.submitted);
                return voters.length === 0 ? <p>{state.phase === "initial" ? "No voters have joined yet." : "No initial ratings were submitted."}</p> : <><div className="voting-response-progress"><span><strong>{voters.length - waiting.length}</strong> / {voters.length} submitted</span><span>{state.phase === "initial" ? "Initial ratings" : "Final votes"}</span></div><progress aria-label="Submitted votes" value={voters.length - waiting.length} max={voters.length}/>{waiting.length === 0 ? <p>Everyone has submitted.</p> : <><p>Waiting on {waiting.length}</p><ul>{waiting.map(voter => <li key={voter.id}>{voter.name}</li>)}</ul></>}</>;
              })()}
            </div>}

            <div className="voting-round-actions">
            {round && <button className="voting-admin-primary voting-round-next" disabled={busy || (!viewingLive && !liveIdle) || !state.active || (round.next === "initial" && state.currentCandidate.completed) || !state.criteria.length} onClick={() => changePhase(round.next)}>{busy ? "Updating…" : round.action}</button>}
            {state.phase === "locked" && candidates.length > 0 && candidates.every(c => c.completed) && onResults && <button className="voting-admin-primary voting-round-next" onClick={onResults} disabled={busy}>Continue to results →</button>}
            {state.phase === "locked" && <button className="voting-admin-primary voting-round-next voting-reopen-action" disabled={busy || !liveIdle} onClick={() => reopenCandidate(state.currentCandidate!.id)}>{busy ? "Reopening…" : "Reopen final submission"}</button>}
            {!viewingLive && !liveIdle && <p className="voting-admin-muted">Another candidate is live. Close that round before opening this one.</p>}
            {state.phase === "locked" && !nextCandidate && <p className="voting-admin-muted">All candidates are complete.</p>}
            </div>
          </>}
        </section>
      </div>
    </>}
  </div>;
}
